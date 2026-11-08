# SPDX-License-Identifier: Apache-2.0
"""求职偏好 HTTP 端点（契约 D 节）：GET/POST/PATCH/DELETE/undo + 「只在这次对话」。

用真实应用 client（backend-core 已把 job_preferences.router 登记进 ROUTERS），
所以这里验的是真实注册路径与真实 /api/trash 恢复端点，不另建 FastAPI 壳。
"""

from __future__ import annotations

from app.models.assistant import AssistantWriteProposal
from app.models.job_preference import PREF_SOURCE_USER_EDITED
from app.runtime import dataset_scope
from app.services import job_preference_service as service
from app.services.assistant_tools import get_tool, proposal_store
from app.services.assistant_tools.authorization import WritePreview
from app.services.assistant_tools.policy import ToolExecutionContext

_PREFIX = "/api/job-preferences"


def _ctx() -> ToolExecutionContext:
    return ToolExecutionContext(
        dataset_id=dataset_scope.current_dataset_id(),
        dataset_generation=dataset_scope.current_generation(),
        web_search=False,
        fetch_pages=0,
        relaxed=False,
        writable=False,
    )


def _create_proposal(client, db_session, tool_name: str, arguments: dict):
    tool = get_tool(tool_name)
    assert tool is not None
    preview = (
        tool.preview(db_session, arguments)
        if tool.preview is not None
        else WritePreview(target="测试", scope="无")
    )
    return proposal_store.create(_ctx(), tool_name, arguments, preview, db=db_session)


def _post_pref(client, kind: str, value, note: str = ""):
    return client.post(_PREFIX, json={"kind": kind, "value": value, "note": note})


def _active_rows(db_session):
    return service.list_active_preferences(db_session)


# ===== 读 / 写 =====


def test_get_returns_empty_items_and_full_catalog(client):
    response = client.get(_PREFIX)
    assert response.status_code == 200
    body = response.json()
    assert body["items"] == []
    assert len(body["catalog"]) == 12
    catalog = {item["kind"]: item for item in body["catalog"]}
    assert catalog["work_mode"]["value_kind"] == "scalar"
    assert catalog["work_mode"]["options"] == [
        {"value": "onsite", "label": "现场"},
        {"value": "hybrid", "label": "混合"},
        {"value": "remote", "label": "远程"},
    ]
    assert catalog["target_city"]["value_kind"] == "list"
    assert catalog["session_note"]["label"] == "仅本次对话"


def test_post_creates_user_edited_preference(client, db_session):
    response = _post_pref(client, "target_city", ["杭州", "上海"], note="用户原话")
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["kind"] == "target_city"
    assert body["label"] == "城市"
    assert body["value_kind"] == "list"
    assert body["value"] == ["杭州", "上海"]
    assert body["source"] == PREF_SOURCE_USER_EDITED
    assert body["source_proposal_id"] is None
    assert body["note"] == "用户原话"
    assert body["state"] == "active"
    assert body["has_previous"] is False
    assert client.get(_PREFIX).json()["items"][0]["pref_id"] == body["pref_id"]


def test_post_same_value_is_noop_and_keeps_pref_id(client):
    first = _post_pref(client, "target_city", ["杭州", "上海"]).json()
    # 语序不同但值集合相同：幂等键按集合算，不产生新版本。
    again = _post_pref(client, "target_city", ["上海", "杭州"]).json()
    assert again["pref_id"] == first["pref_id"]
    assert again["updated_at"] == first["updated_at"]
    assert len(client.get(_PREFIX).json()["items"]) == 1


def test_post_invalid_kind_or_value_is_422(client):
    bad_kind = _post_pref(client, "hobby", ["钓鱼"])
    assert bad_kind.status_code == 422
    assert bad_kind.json()["detail"]["code"] == "invalid_input"
    bad_value = _post_pref(client, "target_city", ["杭州1"])
    assert bad_value.status_code == 422
    assert bad_value.json()["detail"]["code"] == "invalid_input"


def test_post_new_value_supersedes_old(client):
    old = _post_pref(client, "target_city", ["杭州"]).json()
    new = _post_pref(client, "target_city", ["北京"]).json()
    items = client.get(_PREFIX).json()["items"]
    assert [item["pref_id"] for item in items] == [new["pref_id"]]
    assert items[0]["has_previous"] is True
    assert old["pref_id"] != new["pref_id"]


def test_patch_updates_value_and_404_for_unknown(client, db_session):
    created = _post_pref(client, "target_city", ["杭州"]).json()
    response = client.patch(f"{_PREFIX}/{created['pref_id']}", json={"value": ["北京", "上海"]})
    assert response.status_code == 200, response.text
    updated = response.json()
    assert updated["value"] == ["北京", "上海"]
    assert updated["label"] == "城市"
    # 编辑 = 旧版本 superseded + 新版本 active，所以返回的 pref_id 是**新的**；
    # 旧 pref_id 从此不是当前版本（再用它操作是 404）。
    assert updated["pref_id"] != created["pref_id"]
    assert updated["has_previous"] is True
    stale = client.patch(f"{_PREFIX}/{created['pref_id']}", json={"value": ["广州"]})
    assert stale.status_code == 404
    missing = client.patch(f"{_PREFIX}/not-a-real-pref", json={"value": ["北京"]})
    assert missing.status_code == 404
    assert missing.json()["detail"]["code"] == "not_found"
    invalid = client.patch(f"{_PREFIX}/{updated['pref_id']}", json={"value": {"bogus": 1}})
    assert invalid.status_code == 422
    assert invalid.json()["detail"]["code"] == "invalid_input"


# ===== 删除 / 恢复 / 撤销 =====


def test_delete_returns_trash_row_id_and_restore_roundtrip(client):
    created = _post_pref(client, "target_city", ["杭州"]).json()
    deleted = client.delete(f"{_PREFIX}/{created['pref_id']}")
    assert deleted.status_code == 200
    body = deleted.json()
    assert body == {"pref_id": created["pref_id"], "id": body["id"], "deleted": True}
    assert isinstance(body["id"], int)
    assert client.get(_PREFIX).json()["items"] == []
    restored = client.post(f"/api/trash/job_preference/{body['id']}/restore")
    assert restored.status_code == 204, restored.text
    items = client.get(_PREFIX).json()["items"]
    assert [item["pref_id"] for item in items] == [created["pref_id"]]


def test_restore_conflicts_with_new_active_row_returns_409(client):
    created = _post_pref(client, "target_city", ["杭州"]).json()
    row_id = client.delete(f"{_PREFIX}/{created['pref_id']}").json()["id"]
    _post_pref(client, "target_city", ["北京"])
    conflict = client.post(f"/api/trash/job_preference/{row_id}/restore")
    assert conflict.status_code == 409
    assert conflict.json()["code"] == "trash_restore_conflict"
    assert conflict.json()["detail"]


def test_undo_restores_previous_version_and_409_codes(client):
    first = _post_pref(client, "target_city", ["杭州"]).json()
    second = _post_pref(client, "target_city", ["北京"]).json()
    undone = client.post(f"{_PREFIX}/{second['pref_id']}/undo")
    assert undone.status_code == 200, undone.text
    assert undone.json()["pref_id"] == first["pref_id"]
    assert undone.json()["value"] == ["杭州"]
    # 再撤销 second（已是 undone 版本）→ not_current。
    not_current = client.post(f"{_PREFIX}/{second['pref_id']}/undo")
    assert not_current.status_code == 409
    assert not_current.json()["code"] == "not_current"
    # 撤销恢复回来的 first：没有更早的 superseded 版本 → no_previous（前端空态）。
    no_previous = client.post(f"{_PREFIX}/{first['pref_id']}/undo")
    assert no_previous.status_code == 409
    assert no_previous.json()["code"] == "no_previous"


# ===== 「只在这次对话」 =====


def test_session_endpoint_writes_session_note_and_executes_proposal(client, db_session):
    proposal = _create_proposal(
        client,
        db_session,
        "create_job_preference",
        {"kind": "target_city", "value": ["杭州"]},
    )
    response = client.post(f"{_PREFIX}/proposals/{proposal.proposal_id}/session")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["pref"]["kind"] == "session_note"
    assert body["pref"]["source"] == PREF_SOURCE_USER_EDITED
    assert body["pref"]["source_proposal_id"] == proposal.proposal_id
    assert "城市：杭州" in body["pref"]["value"]
    assert body["proposal_status"] == "executed"
    # 提案置 executed（同一事务条件更新），长期偏好表里没有 target_city。
    db_session.expire_all()
    stored = (
        db_session.query(AssistantWriteProposal)
        .filter(AssistantWriteProposal.proposal_id == proposal.proposal_id)
        .one()
    )
    assert stored.status == "executed"
    kinds = [item["kind"] for item in client.get(_PREFIX).json()["items"]]
    assert kinds == ["session_note"]
    # 重复点击：提案已在终态 → 409 proposal_not_pending，不再产生第二行。
    again = client.post(f"{_PREFIX}/proposals/{proposal.proposal_id}/session")
    assert again.status_code == 409
    assert again.json()["code"] == "proposal_not_pending"


def test_session_endpoint_404_and_unsupported_tool(client, db_session):
    missing = client.post(f"{_PREFIX}/proposals/deadbeef/session")
    assert missing.status_code == 404
    proposal = _create_proposal(
        client, db_session, "create_reminder", {"title": "复盘", "remind_at": "2026-12-01T10:00:00"}
    )
    unsupported = client.post(f"{_PREFIX}/proposals/{proposal.proposal_id}/session")
    assert unsupported.status_code == 409
    assert unsupported.json()["code"] == "unsupported_tool"


def test_session_note_never_appears_in_prompt_block(client, db_session):
    from app.services.job_preference_prompt import render_preference_block

    proposal = _create_proposal(
        client, db_session, "create_job_preference", {"kind": "target_city", "value": ["杭州"]}
    )
    client.post(f"{_PREFIX}/proposals/{proposal.proposal_id}/session")
    assert render_preference_block(db_session) == ""
