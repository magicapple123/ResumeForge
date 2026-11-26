# SPDX-License-Identifier: Apache-2.0
"""收藏页的简历收藏接口（T31）：`GET /api/favorites` 一次返回内部 + 外部两种 kind。

钉四件事（对应 T31 的四条验收）：

1. **两种 kind 同时返回**，且每行带 `kind` + 复合 `ref`（不靠 id 段猜）；
2. **排序是合并后的收藏时间倒序**——不是"内部一批 + 外部一批"（否则用户新收藏的
   外部简历会掉到第二页）；
3. **取消收藏后立刻少一条**（列表以 `favorite=1` 为口径，写完即消失）；
4. **取消收藏不改写 `updated_at`**（T15/R2 口径，外部简历同样成立）：收藏是标记
   不是编辑，`updated_at` 带 `onupdate`，一次 ORM 赋值就会重演"点星星跳行"。
"""

from datetime import datetime

from app.models.external_resume import ExternalResume
from app.models.resume import ResumeRecord
from app.models.user_file import UserFile

#: 造数据用的固定旧时刻：任何"被刷新成现在"的写入都会让它变掉，断言因此不会飘。
_OLD = datetime(2024, 1, 1, 8, 0, 0)


def _internal(
    db_session,
    *,
    title: str,
    favorite: bool,
    favorited_at: datetime | None = None,
    job_title: str = "",
    company: str = "",
) -> ResumeRecord:
    record = ResumeRecord(
        title=title,
        job_title=job_title,
        company=company,
        content={"name": "测试用户"},
        favorite=favorite,
        favorited_at=favorited_at,
        created_at=_OLD,
        updated_at=_OLD,
    )
    db_session.add(record)
    db_session.commit()
    db_session.refresh(record)
    return record


def _user_file(db_session, *, name: str, mime: str) -> UserFile:
    """原件登记行：外部简历的 `mime` 从这里带出（格式徽标的数据源）。"""
    row = UserFile(
        sha256=(name.encode("utf-8").hex() + "0" * 64)[:64],
        disk_name=f"{name}.bin",
        original_name=name,
        mime=mime,
        source_type="external_resume",
    )
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return row


def _external(
    db_session,
    *,
    name: str,
    favorite: bool,
    favorited_at: datetime | None = None,
    mime: str = "application/pdf",
    text: str = "正文",
) -> ExternalResume:
    file_row = _user_file(db_session, name=name, mime=mime)
    record = ExternalResume(
        file_id=file_row.id,
        original_file_id=file_row.id,
        name=name,
        text=text,
        text_chars=len(text),
        favorite=favorite,
        favorited_at=favorited_at,
        created_at=_OLD,
        updated_at=_OLD,
    )
    db_session.add(record)
    db_session.commit()
    db_session.refresh(record)
    return record


def test_favorites_returns_both_kinds_with_explicit_kind_and_ref(client, db_session):
    """两种 kind 一次给全；`kind` / `ref` 显式，位置不靠 id 大小猜。"""
    internal = _internal(
        db_session,
        title="后端岗位简历",
        favorite=True,
        favorited_at=datetime(2026, 11, 20, 10, 0, 0),
        job_title="后端开发",
        company="枢云",
    )
    external = _external(
        db_session,
        name="别处生成的那版.pdf",
        favorite=True,
        favorited_at=datetime(2026, 11, 21, 10, 0, 0),
    )
    # 未收藏的行一条都不该出现（收藏页口径）。
    _internal(db_session, title="没收藏的简历", favorite=False)
    _external(db_session, name="也没收藏.pdf", favorite=False)

    response = client.get("/api/favorites")

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 2
    kinds = {item["kind"] for item in body["items"]}
    assert kinds == {"internal", "external"}
    by_kind = {item["kind"]: item for item in body["items"]}
    assert by_kind["internal"]["id"] == internal.id
    assert by_kind["internal"]["ref"] == f"internal:{internal.id}"
    assert by_kind["internal"]["title"] == "后端岗位简历"
    assert by_kind["internal"]["company"] == "枢云"
    assert by_kind["internal"]["mime"] == ""
    assert by_kind["external"]["id"] == external.id
    assert by_kind["external"]["ref"] == f"external:{external.id}"
    assert by_kind["external"]["title"] == "别处生成的那版.pdf"
    assert by_kind["external"]["mime"] == "application/pdf"
    assert by_kind["external"]["text_chars"] == 2
    assert by_kind["external"]["has_text"] is True


def test_favorites_sorts_by_favorited_at_across_both_kinds(client, db_session):
    """合并排序：外部新收藏的排第一，内部早收藏的排后面（不是分块拼）。"""
    _internal(
        db_session,
        title="早收藏的内部简历",
        favorite=True,
        favorited_at=datetime(2026, 11, 1, 9, 0, 0),
    )
    newest = _external(
        db_session,
        name="最新收藏.pdf",
        favorite=True,
        favorited_at=datetime(2026, 11, 25, 9, 0, 0),
    )
    middle = _internal(
        db_session,
        title="中间收藏的内部简历",
        favorite=True,
        favorited_at=datetime(2026, 11, 10, 9, 0, 0),
    )

    items = client.get("/api/favorites").json()["items"]

    assert [item["title"] for item in items] == [
        "最新收藏.pdf",
        "中间收藏的内部简历",
        "早收藏的内部简历",
    ]
    assert items[0]["id"] == newest.id
    assert items[1]["id"] == middle.id
    assert [item["kind"] for item in items] == ["external", "internal", "internal"]


def test_favorites_pages_after_merging_both_kinds(client, db_session):
    """分页切片在合并之后：第 2 页拿到的是合并序列的后半段（不是空页）。"""
    for index in range(3):
        _internal(
            db_session,
            title=f"内部-{index}",
            favorite=True,
            favorited_at=datetime(2026, 11, 1 + index, 9, 0, 0),
        )
    for index in range(2):
        _external(
            db_session,
            name=f"外部-{index}.pdf",
            favorite=True,
            favorited_at=datetime(2026, 11, 10 + index, 9, 0, 0),
        )

    first = client.get("/api/favorites", params={"page": 1, "page_size": 3}).json()
    second = client.get("/api/favorites", params={"page": 2, "page_size": 3}).json()

    assert first["total"] == 5 and second["total"] == 5
    assert len(first["items"]) == 3 and len(second["items"]) == 2
    # 两页拼起来正好是整个合并序列，且无重复。
    refs = [item["ref"] for item in first["items"] + second["items"]]
    assert len(set(refs)) == 5


def test_favorites_kind_filter_limits_to_one_table(client, db_session):
    """`kind=external` 只回外部行（收藏页将来做分段筛选时用它）。"""
    _internal(db_session, title="内部简历", favorite=True, favorited_at=_OLD)
    external = _external(db_session, name="外部简历.pdf", favorite=True, favorited_at=_OLD)

    body = client.get("/api/favorites", params={"kind": "external"}).json()

    assert body["total"] == 1
    assert body["items"][0]["kind"] == "external"
    assert body["items"][0]["id"] == external.id


def test_unfavoriting_external_resume_removes_row_without_touching_updated_at(client, db_session):
    """取消收藏：列表立刻少一条，且 `external_resume.updated_at` 原样不动（R2）。"""
    external = _external(db_session, name="要取消的.pdf", favorite=True, favorited_at=_OLD)
    keeper = _internal(db_session, title="留着的内部简历", favorite=True, favorited_at=_OLD)
    assert client.get("/api/favorites").json()["total"] == 2
    before = client.get(f"/api/external-resumes/{external.id}").json()["updated_at"]

    response = client.patch(
        f"/api/external-resumes/{external.id}/favorite", json={"favorite": False}
    )

    assert response.status_code == 200
    assert response.json()["favorite"] is False
    assert response.json()["favorited_at"] is None
    # 收藏不是编辑：写入不得刷新「最近更新」（否则列表排序会把这一行顶到最前）。
    assert response.json()["updated_at"] == before
    after = client.get("/api/favorites").json()
    assert after["total"] == 1
    assert [item["ref"] for item in after["items"]] == [f"internal:{keeper.id}"]


def test_unfavoriting_internal_resume_removes_row_without_touching_updated_at(client, db_session):
    """内部简历同一口径：与 T15 的写入口逐字一致，取消收藏后不再出现在收藏页。"""
    internal = _internal(db_session, title="要取消的内部简历", favorite=True, favorited_at=_OLD)
    assert client.get("/api/favorites").json()["total"] == 1
    before = client.get(f"/api/resumes/{internal.id}").json()["updated_at"]

    response = client.patch(f"/api/resumes/{internal.id}/favorite", json={"favorite": False})

    assert response.status_code == 200
    assert response.json()["favorite"] is False
    # 收藏不是编辑：`updated_at` 必须还是造数据时那个旧时刻（被刷新就会变成"现在"）。
    assert client.get(f"/api/resumes/{internal.id}").json()["updated_at"] == before
    assert client.get("/api/favorites").json()["total"] == 0


def test_favorites_keyword_matches_file_name_and_job_title(client, db_session):
    """关键词同时命中两种 kind（外部看文件名，内部看标题）。"""
    _internal(db_session, title="后端岗位简历", favorite=True, favorited_at=_OLD)
    external = _external(db_session, name="甲方要的版本.pdf", favorite=True, favorited_at=_OLD)
    _external(db_session, name="别的岗位.pdf", favorite=True, favorited_at=_OLD)

    body = client.get("/api/favorites", params={"keyword": "甲方"}).json()

    assert body["total"] == 1
    assert body["items"][0]["ref"] == f"external:{external.id}"
