# SPDX-License-Identifier: Apache-2.0
"""W02：简历内容/版式的版本号与冲突语义（``revision`` + 条件写）。

一条规则的四个面，缺一面就等于没做：

1. **读得到**——详情与列表都带 ``revision``，前端才拿得到"我基于哪一版"。
2. **匹配才写**——条件写命中才推进一版；不命中回 409 + 业务码，库内一个字节不动。
3. **旧客户端不被抛下**——旧形状 ``PUT /{id}`` 照旧 200，但它**仍然推进**版本，
   于是新客户端的下一次条件写必然 409：用户看见"别处改过"，而不是被静默覆盖。
4. **不是所有写都推进**——改名/备注/收藏/软删/恢复不是文档内容；若它们也推进，
   别的窗口只改个标题就会让内容保存 409，那是假冲突。

文件命名说明：``tests/test_resume_revision.py`` 已被"AI 修订服务"占用（
``services/resume/resume_revision.py`` 的单元 + API 用例），本文件按被测模块命名，
避免覆盖既有用例。
"""

from __future__ import annotations

import json

from app.models.resume import ResumeRecord
from app.schemas.setting import LLMConfig

CONTENT = {"name": "张示例", "summary": "原始总结"}


def _create(client, *, content: dict | None = None, draft: bool = False) -> int:
    response = client.post(
        "/api/resumes/manual",
        json={"job_id": None, "content": content or CONTENT, "draft": draft},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _row(db_session, record_id: int) -> ResumeRecord:
    """另一个会话里读库（与 ``client`` 的会话相互独立）。"""
    db_session.expire_all()
    record = db_session.get(ResumeRecord, record_id)
    assert record is not None
    return record


def _save(client, record_id: int, *, content: dict, expected: int | None):
    payload: dict = {"content": content}
    if expected is not None:
        payload["expected_revision"] = expected
    return client.put(f"/api/resumes/{record_id}/content", json=payload)


def test_detail_returns_revision(client, db_session):
    """新记录从 0 开始；列表也要带这个字段（列表页做乐观更新要用）。"""
    record_id = _create(client)

    detail = client.get(f"/api/resumes/{record_id}")
    assert detail.status_code == 200
    assert detail.json()["revision"] == 0

    listed = client.get("/api/resumes").json()["items"]
    assert [item["id"] for item in listed] == [record_id]
    assert listed[0]["revision"] == 0


def test_conditional_save_bumps_revision(client, db_session):
    record_id = _create(client)

    response = _save(
        client, record_id, content={"name": "张示例", "summary": "改过的总结"}, expected=0
    )
    assert response.status_code == 200, response.text
    assert response.json()["revision"] == 1
    assert response.json()["content"]["summary"] == "改过的总结"
    # 库里也真的变了（不是只改了响应）。
    assert _row(db_session, record_id).content["summary"] == "改过的总结"
    assert _row(db_session, record_id).revision == 1


def test_stale_expected_revision_returns_409_with_business_code(client, db_session):
    record_id = _create(client)
    assert (
        _save(
            client, record_id, content={"name": "张示例", "summary": "窗口甲的版本"}, expected=0
        ).status_code
        == 200
    )

    # 窗口乙还拿着 revision=0 的那份内容（他不知道甲已经存过）。
    response = _save(
        client, record_id, content={"name": "张示例", "summary": "窗口乙的版本"}, expected=0
    )
    assert response.status_code == 409, response.text
    body = response.json()
    assert body["code"] == "resume_revision_conflict"
    assert body["detail"] == "这份简历已被其他窗口修改"
    # 当前值要告诉前端：它拿这个值才能"比较"或"用最新的"。
    assert body["revision"] == 1

    # 冲突请求一个字节都不许写：正文仍是窗口甲那份。
    row = _row(db_session, record_id)
    assert row.content["summary"] == "窗口甲的版本"
    assert row.revision == 1


def test_legacy_put_still_works_and_bumps_revision(client, db_session):
    """旧形状 body（裸 ``ResumeContent``）→ 200 且推进一版。"""
    record_id = _create(client)

    response = client.put(
        f"/api/resumes/{record_id}", json={"name": "张示例", "summary": "旧客户端写的"}
    )
    assert response.status_code == 200, response.text
    assert response.json()["revision"] == 1
    assert _row(db_session, record_id).content["summary"] == "旧客户端写的"


def test_legacy_put_then_conditional_save_conflicts(client, db_session):
    """**本轮最关键的一条语义**：旧客户端写完，新客户端的下一次条件写必须 409。

    如果旧端点不推进 ``revision``，两条写路径就会悄悄错位——新客户端拿着一个
    看起来"还匹配"的版本号，把旧客户端刚写的内容静默覆盖掉，冲突永远不出现。
    """
    record_id = _create(client)
    assert client.get(f"/api/resumes/{record_id}").json()["revision"] == 0

    # 旧客户端（不知道版本号）覆盖写入。
    legacy = client.put(
        f"/api/resumes/{record_id}", json={"name": "张示例", "summary": "旧客户端覆盖"}
    )
    assert legacy.status_code == 200
    assert legacy.json()["revision"] == 1

    # 新客户端仍拿着打开时的 revision=0 → 必须被拦住，而不是覆盖。
    response = _save(
        client, record_id, content={"name": "张示例", "summary": "新客户端"}, expected=0
    )
    assert response.status_code == 409, response.text
    assert response.json()["revision"] == 1
    assert _row(db_session, record_id).content["summary"] == "旧客户端覆盖"


def test_identical_content_save_does_not_bump(client, db_session):
    """重复点保存不该把别的窗口打成冲突：内容没变就不推进版本，也不写库。"""
    record_id = _create(client)

    first = _save(client, record_id, content=CONTENT, expected=0)
    assert first.status_code == 200, first.text
    assert first.json()["revision"] == 0

    second = _save(client, record_id, content=CONTENT, expected=0)
    assert second.status_code == 200, second.text
    assert second.json()["revision"] == 0
    assert _row(db_session, record_id).revision == 0


def test_layout_patch_bumps_revision_and_respects_expected(client, db_session):
    record_id = _create(client)

    # 不带 expected_revision：无条件写 + 推进（旧行为）。
    first = client.patch(
        f"/api/resumes/{record_id}/layout",
        json={"template": "classic", "page_limit": 2, "font_scale": "small"},
    )
    assert first.status_code == 200, first.text
    assert first.json()["revision"] == 1
    assert first.json()["page_limit"] == 2

    # 带匹配的版本：继续推进。
    second = client.patch(
        f"/api/resumes/{record_id}/layout",
        json={
            "template": "classic",
            "page_limit": 1,
            "font_scale": "standard",
            "expected_revision": 1,
        },
    )
    assert second.status_code == 200, second.text
    assert second.json()["revision"] == 2

    # 过期版本：409，且版式保持第一次的结果（不写库）。
    stale = client.patch(
        f"/api/resumes/{record_id}/layout",
        json={
            "template": "classic",
            "page_limit": 3,
            "font_scale": "large",
            "expected_revision": 1,
        },
    )
    assert stale.status_code == 409, stale.text
    assert stale.json()["code"] == "resume_revision_conflict"
    row = _row(db_session, record_id)
    assert row.page_limit == 1
    assert row.revision == 2


def test_ai_revise_with_stale_base_revision_does_not_write(client, db_session, monkeypatch):
    """AI 修订回来时这一版已经不在 → 409，模型结果丢弃，且**不清** fact_annotations。

    时间线是真实的：用户打开制作台时是 revision 0，模型在跑；期间别处（这里用旧形状
    PUT 模拟）保存了一版，库里变成 1；模型结果带着 ``base_revision=0`` 回来，条件写
    不命中——它既不能覆盖别人刚写的正文，也不能把那份正文的来源标注清成空。
    """
    config = LLMConfig(
        base_url="https://api.example.com/v1",
        api_key="integration-secret",
        model="integration-model",
    )
    assert client.put("/api/settings/llm", json=config.model_dump()).status_code == 200

    record_id = _create(client)
    # 别处先保存一版：revision 0 → 1。
    assert (
        client.put(
            f"/api/resumes/{record_id}", json={"name": "张示例", "summary": "别处保存的正文"}
        ).status_code
        == 200
    )

    # 再给记录塞一条来源标注与一条旧告警：冲突时它们必须原样留着。
    from app.database import SessionLocal

    db = SessionLocal()
    try:
        record = db.get(ResumeRecord, record_id)
        record.fact_annotations = [
            {"path": "summary", "status": "grounded", "source": "profile.summary"}
        ]
        record.warnings = ["旧的告警"]
        db.commit()
    finally:
        db.close()

    class FakeProvider:
        async def chat(self, _messages, *, thinking: bool = True):
            return json.dumps(
                {
                    "summary": "模型修订后的总结",
                    "experience": [
                        {"company": "示例公司", "role": "工程师", "description": ["原有要点"]}
                    ],
                },
                ensure_ascii=False,
            )

    monkeypatch.setattr("app.api.resumes.create_provider", lambda _config: FakeProvider())
    response = client.post(
        f"/api/resumes/{record_id}/revise",
        json={"instructions": "把总结改得更精炼", "base_revision": 0},
    )
    assert response.status_code == 409, response.text
    assert response.json()["code"] == "resume_revision_conflict"
    assert response.json()["revision"] == 1

    row = _row(db_session, record_id)
    assert row.content["summary"] == "别处保存的正文"  # 模型结果没落库
    assert row.warnings == ["旧的告警"]
    assert row.fact_annotations and row.fact_annotations[0]["status"] == "grounded"
    assert row.revision == 1


def test_ai_revise_with_matching_base_revision_bumps_it(client, db_session, monkeypatch):
    """反向守卫：版本匹配时 AI 修订照旧落库，并推进一版（别把正常路径也拦掉）。"""
    config = LLMConfig(
        base_url="https://api.example.com/v1",
        api_key="integration-secret",
        model="integration-model",
    )
    assert client.put("/api/settings/llm", json=config.model_dump()).status_code == 200
    record_id = _create(client)

    class FakeProvider:
        async def chat(self, _messages, *, thinking: bool = True):
            return json.dumps({"summary": "修订后的总结"}, ensure_ascii=False)

    monkeypatch.setattr("app.api.resumes.create_provider", lambda _config: FakeProvider())
    response = client.post(
        f"/api/resumes/{record_id}/revise",
        json={"instructions": "改一下总结", "base_revision": 0},
    )
    assert response.status_code == 200, response.text
    assert response.json()["content"]["summary"] == "修订后的总结"
    assert response.json()["revision"] == 1
    assert _row(db_session, record_id).revision == 1


def test_rename_note_favorite_trash_restore_do_not_bump(client, db_session):
    """改名/备注/收藏/软删/恢复都不是文档内容，不得推进版本（否则是假冲突）。"""
    record_id = _create(client)

    assert client.patch(f"/api/resumes/{record_id}", json={"title": "改个名"}).status_code == 200
    assert client.patch(f"/api/resumes/{record_id}/note", json={"note": "备注"}).status_code == 200
    assert (
        client.patch(f"/api/resumes/{record_id}/favorite", json={"favorite": True}).status_code
        == 200
    )
    assert _row(db_session, record_id).revision == 0

    assert client.delete(f"/api/resumes/{record_id}").status_code == 204
    assert _row(db_session, record_id).revision == 0

    assert client.post(f"/api/trash/resume/{record_id}/restore").status_code == 204
    row = _row(db_session, record_id)
    assert row.deleted_at is None
    assert row.revision == 0


def test_content_save_promotes_draft_with_revision_one(client, db_session):
    """草稿转正与 revision+1 落在同一条 UPDATE 里（同一次保存，不拆两笔）。"""
    record_id = _create(client, content={"name": "张示例", "summary": "草稿正文"}, draft=True)
    row = _row(db_session, record_id)
    assert row.draft is True
    assert row.revision == 0

    response = _save(
        client, record_id, content={"name": "张示例", "summary": "改过一句"}, expected=0
    )
    assert response.status_code == 200, response.text
    assert response.json()["draft"] is False
    assert response.json()["revision"] == 1

    row = _row(db_session, record_id)
    assert row.draft is False
    assert row.revision == 1


def test_draft_promotion_writes_even_when_content_is_unchanged(client, db_session):
    """内容没变但仍是草稿：转正本身就是状态变更，必须真的写一次（推进一版）。"""
    record_id = _create(client, content={"name": "张示例", "summary": "草稿正文"}, draft=True)

    response = _save(
        client, record_id, content={"name": "张示例", "summary": "草稿正文"}, expected=0
    )
    assert response.status_code == 200, response.text
    assert response.json()["draft"] is False
    assert response.json()["revision"] == 1
    assert _row(db_session, record_id).draft is False


def test_conditional_write_reports_a_missing_row_as_not_found(db_session):
    """条件写撞上"这一行已被删"：返回 ``None``（路由转 404），不能抛 ``RevisionConflict(0)``。

    这是 QA 抓到的真实竞态：路由先读到记录，写库前另一处把它删了，``rowcount == 0``
    被无条件当成"版本过期"。旧端点 ``PUT /{id}`` 不接 ``RevisionConflict``，于是"保存
    一份刚被删掉的简历"会变成 500。行不存在与版本过期必须是两个结果。
    """
    from app.services.resume.document_save import _conditional_update

    record = ResumeRecord(title="即将被删", content={})
    db_session.add(record)
    db_session.commit()
    record_id = record.id
    db_session.delete(record)
    db_session.commit()

    outcome = _conditional_update(
        db_session,
        record_id=record_id,
        values={"title": "不该写进去"},
        expected_revision=None,
    )
    assert outcome is None
