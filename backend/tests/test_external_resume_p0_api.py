# SPDX-License-Identifier: Apache-2.0
"""外部简历 P0 四项（T28）：收藏 / 备注 / 重命名 / 导出原件。

验收判据来自 `ResumeForge-交付提示词-2026-11-26.md` 第 140 行 + CONTRACT 第 3 节：

1. **收藏不刷新 `updated_at`**：`external_resume.updated_at` 带 `onupdate=utcnow`，一次
   ORM 赋值收藏就会把它刷成"刚刚"；按「最近更新」排序时那一行随即跳到最前面（R2），
   用户会以为"收藏错了行"。这里既钉"时间戳逐字相等"，也钉"排序结果里位置不变"——
   后者才是用户看得见的那一半。
2. **备注**：详情与列表都能读到，空串 = 清空（界面据此不渲染备注行）。
3. **重命名**：空名 / 纯空格 / 超长一律 422；成功后列表里的文件名立刻是新值。
4. **导出原件**：`?download=true` 只改 `Content-Disposition`，**文件名与字节原样**；
   带 `revision_id` 时导出的是那一版（历史版本行的「导出」用它）。

反证（手工跑过）：把 `external_resume_actions.set_favorite` 改回
`row.favorite = favorite` 的 ORM 赋值，`test_favorite_does_not_touch_updated_at` 与
`test_favorite_keeps_the_row_in_place_when_sorted_by_recent_update` 同时变红；
复原后复绿——两条用例不是同一件事的两份写法，前者钉时间戳、后者钉顺序。
"""

from __future__ import annotations

from datetime import datetime, timedelta

from app.models.external_resume import ExternalResume
from sqlalchemy import update

_BODY = b"Zhang San\nPython backend engineer with 5 years\n"


def upload(client, name: str = "resume.txt", content: bytes = _BODY) -> dict:
    response = client.post(
        "/api/external-resumes",
        files={"file": (name, content, "text/plain")},
    )
    assert response.status_code == 201, response.text
    return response.json()


def favorite(client, resume_id: int, value: bool) -> dict:
    response = client.patch(f"/api/external-resumes/{resume_id}/favorite", json={"favorite": value})
    assert response.status_code == 200, response.text
    return response.json()


def note(client, resume_id: int, value: str) -> dict:
    response = client.patch(f"/api/external-resumes/{resume_id}/note", json={"note": value})
    assert response.status_code == 200, response.text
    return response.json()


def listed(client, **params) -> list[dict]:
    body = client.get("/api/external-resumes", params=params).json()
    assert body["total"] == len(body["items"])
    return body["items"]


def test_favorite_writes_the_timestamp_without_touching_updated_at(client):
    """收藏写 `favorited_at`，**不**动 `updated_at`；取消则把时间清回 null。"""
    row = upload(client)
    before = row["updated_at"]

    body = favorite(client, row["id"], True)
    assert body["favorite"] is True
    assert body["favorited_at"] is not None
    # 逐字相等：收藏是标记不是编辑，时间戳不该动（R2）。
    assert body["updated_at"] == before

    body = favorite(client, row["id"], False)
    assert body["favorite"] is False
    assert body["favorited_at"] is None
    assert body["updated_at"] == before


def test_favorite_is_idempotent_and_keeps_the_first_timestamp(client):
    """重复收藏不刷新收藏时间（与内部简历同一份判据 `resolve_favorite`）。"""
    row = upload(client)
    first = favorite(client, row["id"], True)["favorited_at"]
    second = favorite(client, row["id"], True)["favorited_at"]
    assert first == second


def test_favorite_keeps_the_row_in_place_when_sorted_by_recent_update(client, db_session):
    """按「最近更新」排序时收藏一行，那一行的位置不变（用户看得见的那一半）。

    用例先把三行的 `updated_at` 拉开成固定的先后（否则同一秒上传的三行顺序取决于
    微秒，断言会抖），再收藏**中间**那一行：顺序若变了，说明收藏刷新了时间戳。
    """
    rows = [upload(client, f"resume-{index}.txt") for index in range(3)]
    base = datetime(2026, 1, 1, 9, 0, 0)
    for offset, row in enumerate(rows):
        db_session.execute(
            update(ExternalResume)
            .where(ExternalResume.id == row["id"])
            .values(updated_at=base + timedelta(hours=offset))
        )
    db_session.commit()

    # 最近更新在前：第 3 份 → 第 2 份 → 第 1 份。
    order = [item["id"] for item in listed(client, sort="updated_at", order="desc")]
    assert order == [rows[2]["id"], rows[1]["id"], rows[0]["id"]]

    favorite(client, rows[1]["id"], True)

    after = [item["id"] for item in listed(client, sort="updated_at", order="desc")]
    assert after == order
    assert [item["favorite"] for item in listed(client, sort="updated_at", order="desc")] == [
        False,
        True,
        False,
    ]


def test_favorite_shows_up_in_list_and_detail(client):
    """收藏状态在列表与详情两处都回显（列表行与详情都要能切换）。"""
    row = upload(client)
    favorite(client, row["id"], True)

    assert listed(client)[0]["favorite"] is True
    assert client.get(f"/api/external-resumes/{row['id']}").json()["favorite"] is True


def test_note_is_readable_in_detail_and_list_and_can_be_cleared(client):
    """备注在详情与列表都可见；空串 = 清空（界面据此不画空行）。"""
    row = upload(client)
    assert row["note"] == ""

    saved = note(client, row["id"], "  给甲方的那版  ")
    # 首尾空白去掉：纯空格的备注等于没写。
    assert saved["note"] == "给甲方的那版"
    assert client.get(f"/api/external-resumes/{row['id']}").json()["note"] == "给甲方的那版"
    assert listed(client)[0]["note"] == "给甲方的那版"

    cleared = note(client, row["id"], "   ")
    assert cleared["note"] == ""
    assert listed(client)[0]["note"] == ""


def test_note_rejects_over_long_text(client):
    """超过上限给 422（schema 挡一次，服务层再挡一次）。"""
    row = upload(client)
    response = client.patch(f"/api/external-resumes/{row['id']}/note", json={"note": "字" * 2001})
    assert response.status_code == 422


def test_note_does_not_bump_a_deleted_row(client):
    """已软删的行当不存在（与其它端点同一口径，不写半条）。"""
    row = upload(client)
    assert client.delete(f"/api/external-resumes/{row['id']}").status_code == 204
    response = client.patch(f"/api/external-resumes/{row['id']}/note", json={"note": "x"})
    assert response.status_code == 404


def test_rename_rejects_blank_and_over_long(client):
    """空名 / 纯空格 / 超长都是 422——重命名弹窗的校验与服务端一致。"""
    row = upload(client)
    blank = client.patch(f"/api/external-resumes/{row['id']}", json={"name": ""})
    assert blank.status_code == 422
    spaces = client.patch(f"/api/external-resumes/{row['id']}", json={"name": "   "})
    assert spaces.status_code == 422
    too_long = client.patch(f"/api/external-resumes/{row['id']}", json={"name": "a" * 257})
    assert too_long.status_code == 422


def test_rename_changes_the_name_in_the_list_right_away(client):
    """重命名成功后列表里的文件名立刻是新的（详情抽屉靠 `onChanged` 刷新列表）。"""
    row = upload(client, "old-name.txt")
    response = client.patch(f"/api/external-resumes/{row['id']}", json={"name": "新名字.txt"})
    assert response.status_code == 200, response.text
    assert response.json()["name"] == "新名字.txt"
    assert listed(client)[0]["name"] == "新名字.txt"


def test_export_original_downloads_same_bytes_and_keeps_the_extension(client):
    """`?download=true`：attachment + 原始文件名 + 字节逐字相同。"""
    row = upload(client, "张 三 简历.txt", _BODY)

    response = client.get(f"/api/external-resumes/{row['id']}/file", params={"download": "true"})

    assert response.status_code == 200
    disposition = response.headers["content-disposition"]
    assert disposition.startswith("attachment")
    # Content-Disposition 对非 ASCII 文件名用 RFC 5987 的 filename*= 形态（httpx 解出原值）。
    assert "简历" in disposition or "filename*=utf-8''" in disposition.lower()
    assert ".txt" in disposition.lower()
    assert response.content == _BODY

    # 不带参数时仍是 inline（预览链路不能被"导出"改坏）。
    inline = client.get(f"/api/external-resumes/{row['id']}/file")
    assert inline.headers["content-disposition"].startswith("inline")


def test_export_a_history_revision_downloads_that_version(client):
    """历史版本行导出的是**那一版**的字节（不是当前版本）。"""
    row = upload(client, "editable.txt", b"first version line\n")
    blocks = client.get(f"/api/external-resumes/{row['id']}/blocks").json()["blocks"]
    edited = client.post(
        f"/api/external-resumes/{row['id']}/edit",
        json={"block_id": blocks[0]["block_id"], "text": "second version line"},
    )
    assert edited.status_code == 200, edited.text
    revisions = client.get(f"/api/external-resumes/{row['id']}/revisions").json()["items"]
    assert len(revisions) >= 2, revisions
    oldest = revisions[-1]

    response = client.get(
        f"/api/external-resumes/{row['id']}/file",
        params={"revision_id": oldest["id"], "download": "true"},
    )

    assert response.status_code == 200
    assert response.headers["content-disposition"].startswith("attachment")
    assert b"first version line" in response.content
