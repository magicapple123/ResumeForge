# SPDX-License-Identifier: Apache-2.0
"""进度记录关联**外部简历**（T6）：标题快照冻结、互斥契约、软删后仍可读。

外部简历是用户在别处生成的原件（PDF / docx / txt），存在 ``external_resume``，与内部
简历（``resume_record``）**不同表、id 空间独立**。进度记录因此要能同时表达两种来源，
但同一时刻只能说"用的是哪一份"。

钉六件事：

1. **创建即冻结**：``external_resume_id`` 从无到有时把 ``resume_title`` 冻结成
   ``external_resume.name``（内部/外部共用同一列快照）；
2. **换 id 刷新快照**，**重复保存不刷新**（改备注、推进状态不该改"当时投的是哪一版"）；
3. **清空关联不清标题**：``external_resume_id`` 置 NULL，``resume_title`` 保留；
4. **互斥**：``resume_id`` 与 ``external_resume_id`` 同时非空 → 422（不是静默挑一个）；
5. **外部软删后标题仍可读**：软删只写 ``deleted_at``，不触发外键；
6. **不冻结投递快照**：外部简历没有结构化 ``content``，原件即证据——``resume_delivery_record``
   里不该多出这个 track 的行。内部简历那条路径必须照旧冻结（对照组）。
"""

from __future__ import annotations

import pytest
from app.models.resume_delivery import ResumeDeliveryRecord

VALID = {
    "company": "示例科技",
    "title": "后端开发实习生",
    "status": "applied",
    "applied_at": "2026-09-18",
}


def _upload_external(client, name: str, *, filename: str = "resume.txt") -> int:
    """上传一份外部简历，返回它的 id（内容随便，只要不是空文件）。"""
    response = client.post(
        "/api/external-resumes",
        files={"file": (filename, f"外部简历正文 {name}".encode(), "text/plain")},
        data={"name": name},
    )
    assert response.status_code == 201, response.text
    return int(response.json()["id"])


def _internal_resume(db_session, title: str = "内部简历 A") -> int:
    """造一份内部简历（只要 id 与 title 可用；本文件不关心结构化正文）。"""
    from app.models.resume import ResumeRecord

    row = ResumeRecord(title=title, content={})
    db_session.add(row)
    db_session.commit()
    return int(row.id)


def _delivery_count(db_session, track_id: int) -> int:
    return (
        db_session.query(ResumeDeliveryRecord)
        .filter(ResumeDeliveryRecord.track_id == track_id)
        .count()
    )


# ===== 1. 创建即冻结 =====


def test_creating_with_an_external_resume_freezes_the_title_snapshot(client):
    external_id = _upload_external(client, "外部简历 A")

    created = client.post("/api/tracker", json={**VALID, "external_resume_id": external_id})
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["external_resume_id"] == external_id
    # 标题快照取 external_resume.name（内部/外部共用同一列）。
    assert body["resume_title"] == "外部简历 A"
    assert body["resume_id"] is None

    # 列表与详情都要带回关联：漏一处就是"保存后关联消失"。
    track_id = body["id"]
    detail = client.get(f"/api/tracker/{track_id}").json()
    assert detail["external_resume_id"] == external_id
    assert detail["resume_title"] == "外部简历 A"
    page = client.get("/api/tracker/page").json()
    assert [item["external_resume_id"] for item in page["items"]] == [external_id]


# ===== 2. 换 id 刷新 / 重复保存不刷新 =====


def test_changing_the_external_id_refreshes_the_snapshot(client):
    first = _upload_external(client, "外部简历 第一版")
    second = _upload_external(client, "外部简历 第二版")
    track_id = client.post("/api/tracker", json={**VALID, "external_resume_id": first}).json()["id"]

    updated = client.put(f"/api/tracker/{track_id}", json={**VALID, "external_resume_id": second})
    assert updated.status_code == 200, updated.text
    assert updated.json()["external_resume_id"] == second
    assert updated.json()["resume_title"] == "外部简历 第二版"


def test_saving_the_same_external_id_again_keeps_the_frozen_snapshot(client, db_session):
    """快照只在 id 变化时刷：外部简历改名后重复保存进度，不该改写历史快照。"""
    from app.models.external_resume import ExternalResume

    external_id = _upload_external(client, "外部简历 原名")
    track_id = client.post(
        "/api/tracker", json={**VALID, "external_resume_id": external_id}
    ).json()["id"]

    # 用户事后给外部简历改名（真实操作：列表页「改名」）。
    row = db_session.get(ExternalResume, external_id)
    assert row is not None
    row.name = "外部简历 改过的名字"
    db_session.commit()

    again = client.put(
        f"/api/tracker/{track_id}", json={**VALID, "external_resume_id": external_id}
    )
    assert again.status_code == 200, again.text
    assert again.json()["resume_title"] == "外部简历 原名", "重复保存不该刷新标题快照"


# ===== 3. 清空关联不清标题 =====


def test_clearing_the_link_keeps_the_title_snapshot(client):
    external_id = _upload_external(client, "外部简历 A")
    track_id = client.post(
        "/api/tracker", json={**VALID, "external_resume_id": external_id}
    ).json()["id"]

    cleared = client.put(f"/api/tracker/{track_id}", json={**VALID, "external_resume_id": None})
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["external_resume_id"] is None
    # 关联没了，但"当时投的是哪一版"是既成事实，不能跟着清空。
    assert cleared.json()["resume_title"] == "外部简历 A"


# ===== 4. 互斥契约 =====


def test_internal_and_external_links_together_are_rejected(client, db_session):
    internal_id = _internal_resume(db_session)
    external_id = _upload_external(client, "外部简历 A")

    response = client.post(
        "/api/tracker",
        json={**VALID, "resume_id": internal_id, "external_resume_id": external_id},
    )
    assert response.status_code == 422
    assert "只能关联一份" in response.text


def test_the_exclusive_validator_also_guards_updates(client, db_session):
    """PUT 也是整套契约：先建一条外部关联，再改成"两个都传"必须被挡住。"""
    internal_id = _internal_resume(db_session)
    external_id = _upload_external(client, "外部简历 A")
    track_id = client.post(
        "/api/tracker", json={**VALID, "external_resume_id": external_id}
    ).json()["id"]

    response = client.put(
        f"/api/tracker/{track_id}",
        json={**VALID, "resume_id": internal_id, "external_resume_id": external_id},
    )
    assert response.status_code == 422
    # 被拒之后库里那条记录一个字都不该变。
    detail = client.get(f"/api/tracker/{track_id}").json()
    assert detail["external_resume_id"] == external_id
    assert detail["resume_id"] is None


@pytest.mark.parametrize("payload", [{"resume_id": 0}, {"external_resume_id": 0}])
def test_resume_ids_must_be_positive(client, payload):
    assert client.post("/api/tracker", json={**VALID, **payload}).status_code == 422


# ===== 5. 外部软删后标题仍可读 =====


def test_soft_deleted_external_resume_keeps_the_snapshot_readable(client):
    external_id = _upload_external(client, "外部简历 A")
    track_id = client.post(
        "/api/tracker", json={**VALID, "external_resume_id": external_id}
    ).json()["id"]

    assert client.delete(f"/api/external-resumes/{external_id}").status_code == 204

    # 软删只写 deleted_at，不触发外键：关联照旧在，标题快照也照旧可读。
    detail = client.get(f"/api/tracker/{track_id}").json()
    assert detail["external_resume_id"] == external_id
    assert detail["resume_title"] == "外部简历 A"


# ===== 6. 不冻结投递快照 =====


def test_external_link_does_not_freeze_a_delivery_snapshot(client, db_session):
    """外部简历没有结构化 content：原件即证据，这里**不该**出现投递快照。"""
    external_id = _upload_external(client, "外部简历 A")
    track_id = client.post(
        "/api/tracker", json={**VALID, "external_resume_id": external_id}
    ).json()["id"]

    assert _delivery_count(db_session, track_id) == 0


def test_internal_link_still_freezes_a_delivery_snapshot(client, db_session):
    """对照组：内部分支的行为一个字都不许变（同一条路径的两个分支）。"""
    internal_id = _internal_resume(db_session)
    track_id = client.post("/api/tracker", json={**VALID, "resume_id": internal_id}).json()["id"]

    assert _delivery_count(db_session, track_id) == 1


# ===== 识别合并不带入外部关联 =====


def test_recognized_import_does_not_carry_the_external_link(client):
    """合并走 ``_merge_into``（只改通知带来的字段）：手选的外部关联不该被导入抹掉。"""
    external_id = _upload_external(client, "外部简历 A")
    track_id = client.post(
        "/api/tracker", json={**VALID, "external_resume_id": external_id}
    ).json()["id"]

    applied = client.post(
        "/api/tracker/apply",
        json={
            "items": [{"company": "示例科技", "title": "后端开发实习生", "status": "interview"}],
            "source": "recognized",
        },
    )
    assert applied.status_code == 200, applied.text
    assert applied.json()["updated"] == 1

    detail = client.get(f"/api/tracker/{track_id}").json()
    assert detail["status"] == "interview"
    assert detail["external_resume_id"] == external_id
    assert detail["resume_title"] == "外部简历 A"
