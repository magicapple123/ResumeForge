# SPDX-License-Identifier: Apache-2.0
"""A5（0061）：生成上下文快照随命名版本 / 岗位变体继承。

快照是 server-owned 只读元数据：版本要冻结它、恢复要写回它、派生变体继承它，
但选择性同步**不得**改它；旧记录 context_snapshot=NULL 时所有路径行为不变，
且不按当前场景回填（历史记录 NULL = 未记录）。

为什么单独成文件：tests/test_document_versions.py 已到 500 行测试预算（行数守卫），
这组用例与"版本/变体业务行为"是两件事——一组守上下文数据的流向，一组守版本语义。
共用脚手架（建简历/建版本/存正文）从 test_document_versions 导入，不复制一份。
"""

from __future__ import annotations

from test_document_versions import (
    _content,
    _create_resume,
    _create_version,
    _resume,
    _save_content,
)

# ===== A5：生成上下文快照随版本/变体继承（0061）=====
# 快照是 server-owned 只读元数据：版本要冻结它、恢复要写回它、派生变体继承它，
# 但同步/翻译**不得**改它；旧记录 NULL 时所有路径行为不变，且不按当前场景回填。

_SNAPSHOT = {
    "schema_version": 1,
    "scenario_origin": "preset",
    "scenario_id": None,
    "preset_key": "general",
    "scenario_revision": None,
    "catalog_version": "1",
    "display_name": "通用",
    "resolved_dimensions": {"purpose": "general"},
    "approved_guidance": [],
    "disclosure": {"include_employment_status": False},
    "resolver_version": "1",
    "prompt_fragment_version": "1",
    "context_sha256": "a" * 64,
    "captured_at": "2026-10-25T00:00:00+00:00",
}
_OTHER_SNAPSHOT = {**_SNAPSHOT, "display_name": "科研学术", "context_sha256": "b" * 64}


def _set_record_context(db_session, resume_id: int, snapshot: dict | None) -> None:
    """直接写库模拟"生成时冻结了上下文"（API 不提供手改入口，快照由服务端写入）。"""
    from app.models.resume import ResumeRecord

    record = db_session.get(ResumeRecord, resume_id)
    record.context_snapshot = dict(snapshot) if snapshot is not None else None
    db_session.commit()


def test_version_freezes_the_generation_context_snapshot(client, db_session):
    resume_id = _create_resume(client)
    _set_record_context(db_session, resume_id, _SNAPSHOT)
    version = _create_version(client, resume_id, "带场景版本")
    assert version["context_snapshot"] == _SNAPSHOT

    # 之后当前记录的上下文被换掉：历史版本是不可变快照，不回写、不按当前场景回填。
    _set_record_context(db_session, resume_id, _OTHER_SNAPSHOT)
    detail = client.get(f"/api/resumes/{resume_id}/versions/{version['id']}").json()
    assert detail["context_snapshot"] == _SNAPSHOT


def test_restore_writes_the_context_snapshot_back_to_the_current_record(client, db_session):
    from app.models.resume import ResumeRecord

    resume_id = _create_resume(client)
    _set_record_context(db_session, resume_id, _SNAPSHOT)
    version = _create_version(client, resume_id, "回滚点")
    # 当前记录变成"未记录上下文"，恢复后应回到版本当时的上下文。
    _set_record_context(db_session, resume_id, None)

    restored = client.post(
        f"/api/resumes/{resume_id}/versions/{version['id']}/restore",
        json={"expected_revision": _resume(client, resume_id)["revision"]},
    )
    assert restored.status_code == 200, restored.text
    assert restored.json()["version"]["context_snapshot"] == _SNAPSHOT
    db_session.expire_all()
    assert db_session.get(ResumeRecord, resume_id).context_snapshot == _SNAPSHOT
    # 历史版本不动（仍是它自己那份快照）。
    original = client.get(f"/api/resumes/{resume_id}/versions/{version['id']}").json()
    assert original["context_snapshot"] == _SNAPSHOT


def test_variant_inherits_context_snapshot_from_version_or_record(client, db_session):
    resume_id = _create_resume(client)
    _set_record_context(db_session, resume_id, _SNAPSHOT)
    version = _create_version(client, resume_id, "v1")

    from_version = client.post(
        f"/api/resumes/{resume_id}/variants",
        json={"name": "从版本派生", "base_version_id": version["id"]},
    ).json()
    assert from_version["context_snapshot"] == _SNAPSHOT

    # 记录换成另一份上下文 → 不带 base_version_id 的变体继承记录当前那份。
    _set_record_context(db_session, resume_id, _OTHER_SNAPSHOT)
    from_record = client.post(
        f"/api/resumes/{resume_id}/variants", json={"name": "从当前派生"}
    ).json()
    assert from_record["context_snapshot"] == _OTHER_SNAPSHOT

    # 先派生的变体不随后续记录变化（变体是独立表达对象）。
    detail = client.get(f"/api/resumes/{resume_id}/variants/{from_version['id']}").json()
    assert detail["context_snapshot"] == _SNAPSHOT


def test_selective_sync_does_not_touch_variant_context_snapshot(client, db_session):
    resume_id = _create_resume(client)
    _set_record_context(db_session, resume_id, _SNAPSHOT)
    first = _create_version(client, resume_id, "v1")
    variant = client.post(
        f"/api/resumes/{resume_id}/variants",
        json={"name": "变体", "base_version_id": first["id"]},
    ).json()

    # 来源内容与当前记录都换了上下文，但同步只写勾选路径。
    _set_record_context(db_session, resume_id, _OTHER_SNAPSHOT)
    _save_content(client, resume_id, _content("版本 B", "B"))
    second = _create_version(client, resume_id, "v2")
    response = client.post(
        f"/api/resumes/{resume_id}/variants/sync",
        json={
            "source_version_id": second["id"],
            "variant_ids": [variant["id"]],
            "paths": ["summary"],
        },
    )
    assert response.status_code == 200, response.text
    detail = client.get(f"/api/resumes/{resume_id}/variants/{variant['id']}").json()
    assert detail["content"]["summary"] == "版本 B"
    assert detail["context_snapshot"] == _SNAPSHOT


def test_legacy_records_without_context_snapshot_stay_null(client, db_session):
    """旧记录 context_snapshot=NULL：版本/变体/恢复全程保持 None，不按当前场景回填。"""
    from app.models.resume import ResumeRecord

    resume_id = _create_resume(client)
    version = _create_version(client, resume_id, "旧版本")
    assert version["context_snapshot"] is None
    variant = client.post(
        f"/api/resumes/{resume_id}/variants",
        json={"name": "旧变体", "base_version_id": version["id"]},
    ).json()
    assert variant["context_snapshot"] is None

    restored = client.post(
        f"/api/resumes/{resume_id}/versions/{version['id']}/restore",
        json={"expected_revision": _resume(client, resume_id)["revision"]},
    )
    assert restored.status_code == 200, restored.text
    db_session.expire_all()
    assert db_session.get(ResumeRecord, resume_id).context_snapshot is None

