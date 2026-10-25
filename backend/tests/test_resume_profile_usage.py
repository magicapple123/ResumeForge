# SPDX-License-Identifier: Apache-2.0
"""R-33 简历「本次使用」只读追溯 API 验收（详情字段 + 独立端点 + 过时判定）。

覆盖：
- 简历详情内嵌 profile_usage 快照（组名/参与清单/顺序/两枚修订/创建时间）；
- 独立 GET /api/resumes/{id}/profile-usage 形状与 freshness；
- 旧简历（无快照）→ profile_usage=null 且 changed=false，不报错；
- 三种过时原因：资料变了（content_changed）、组变了（group_changed）、定义/顺序变了
  （definition_changed）；
- 组被删除 → 快照照常返回并标注 group_deleted=true（历史仍可读）；
- 404 与只读（多次调用不改简历/快照/工作区，也不新增第二行快照）。
"""

from __future__ import annotations

from app.models.profile_usage_snapshot import ProfileUsageSnapshot

PROJECTION_API = "/api/profile/current/projection"
WORKSPACE_API = "/api/profile/workspace"
MANUAL_API = "/api/resumes/manual"
GROUPS_API = "/api/profile/groups"
CURRENT_GROUP_API = "/api/profile/current-group"
SECTIONS_API = "/api/profile/sections"
ENTRIES_API = "/api/profile/sections/{section_key}/entries"


def _content(**overrides) -> dict:
    base = {"name": "张三", "summary": "后端工程师"}
    base.update(overrides)
    return base


def _projection(client) -> dict:
    response = client.get(PROJECTION_API)
    assert response.status_code == 200, response.text
    return response.json()


def _profile_context(projection: dict) -> dict:
    """按前端实际会发的内容构造（source_layout → layout 展示字段）。"""
    return {
        "snapshot_token": projection["snapshot_token"],
        "participating_keys": projection["scope"]["participating_keys"],
        "layout": [
            {
                "section_key": item["section_key"],
                "section_name": item["section_name"],
                "entry_count": item["entry_count"],
            }
            for item in projection["source_layout"]
        ],
    }


def _create(client, *, with_snapshot: bool = True) -> tuple[int, dict]:
    """新建一份手写简历；带 profile_context 时同事务写创建态快照（R-33 写入方）。"""
    projection = _projection(client)
    payload: dict = {"title": "R33 追溯测试", "content": _content()}
    if with_snapshot:
        payload["profile_context"] = _profile_context(projection)
    response = client.post(MANUAL_API, json=payload)
    assert response.status_code == 201, response.text
    return response.json()["id"], projection


def _usage(client, resume_id: int) -> dict:
    response = client.get(f"/api/resumes/{resume_id}/profile-usage")
    assert response.status_code == 200, response.text
    return response.json()


def _detail(client, resume_id: int) -> dict:
    response = client.get(f"/api/resumes/{resume_id}")
    assert response.status_code == 200, response.text
    return response.json()


def _snapshot_rows(db_session) -> list[ProfileUsageSnapshot]:
    db_session.rollback()
    return db_session.query(ProfileUsageSnapshot).all()


def _row_state(row: ProfileUsageSnapshot) -> dict:
    return {
        "group_name": row.group_name,
        "group_id": row.group_id,
        "participating": row.participating,
        "section_order": row.section_order,
        "definition_revision": row.definition_revision,
        "data_revision": row.data_revision,
        "layout": row.layout,
        "resume_id": row.resume_id,
        "task_id": row.task_id,
        "created_at": row.created_at,
    }


def _switch_to_new_group(client, *, name: str, keys: list[str]) -> dict:
    """建组 → 设参与清单 → 切为当前组；返回设完参与清单后的组行（含最新 revision）。"""
    created = client.post(GROUPS_API, json={"name": name})
    assert created.status_code == 201, created.text
    group = created.json()
    members = client.put(
        f"{GROUPS_API}/{group['group_id']}/members",
        json={"section_keys": keys, "expected_revision": group["revision"]},
    )
    assert members.status_code == 200, members.text
    workspace = client.get(WORKSPACE_API).json()
    switched = client.put(
        CURRENT_GROUP_API,
        json={
            "group_id": group["group_id"],
            "expected_revision": workspace["workspace_revision"],
        },
    )
    assert switched.status_code == 200, switched.text
    return members.json()


def test_detail_exposes_creation_snapshot(client) -> None:
    """简历详情带 R-33 快照：组名/参与清单/顺序/两枚修订/创建时间 + group_deleted=False。"""
    resume_id, projection = _create(client)
    usage = _detail(client, resume_id)["profile_usage"]
    assert usage is not None
    scope = projection["scope"]
    assert usage["group_name"] == "默认组" == scope["group_name"]
    assert usage["group_id"] == scope["group_id"]
    assert [item["key"] for item in usage["participating"]] == scope["participating_keys"]
    assert [item["name"] for item in usage["participating"]][0] == "基本信息"
    assert usage["section_order"] == scope["participating_keys"]
    assert usage["definition_revision"] == scope["workspace_revision"]
    assert usage["data_revision"] == 0  # 新建时资料里没有条目
    assert usage["group_deleted"] is False
    assert usage["created_at"]
    # 独立端点与详情字段同源（同一份快照、同一口径）
    body = _usage(client, resume_id)
    assert body["profile_usage"]["group_name"] == usage["group_name"]
    assert body["profile_usage"]["participating"] == usage["participating"]


def test_resume_without_snapshot_returns_null_and_not_stale(client) -> None:
    """旧简历/未带来源信息的手写简历：字段为 null，独立端点如实返回「无快照」。"""
    resume_id, _ = _create(client, with_snapshot=False)
    assert _detail(client, resume_id)["profile_usage"] is None
    body = _usage(client, resume_id)
    assert body == {"profile_usage": None, "freshness": {"changed": False, "reasons": []}}


def test_fresh_snapshot_is_not_marked_stale(client) -> None:
    """刚创建、资料/组都没动过 → changed=false（不误报「需要重新生成」）。"""
    resume_id, _ = _create(client)
    freshness = _usage(client, resume_id)["freshness"]
    assert freshness == {"changed": False, "reasons": []}


def test_profile_content_change_marks_content_changed(client) -> None:
    """快照之后新参加了条目 → content_changed；快照本身仍不可变（R-34）。"""
    resume_id, _ = _create(client)
    added = client.post(
        ENTRIES_API.format(section_key="projects"),
        json={"values": {"projects.name": "快照之后的新项目"}},
    )
    assert added.status_code == 201, added.text
    freshness = _usage(client, resume_id)["freshness"]
    assert freshness["changed"] is True
    assert "content_changed" in freshness["reasons"]
    assert "group_changed" not in freshness["reasons"]
    # 快照是"当时"的事实：data_revision 仍是 0，不随资料变化回写。
    assert _detail(client, resume_id)["profile_usage"]["data_revision"] == 0


def test_definition_change_marks_definition_changed(client) -> None:
    """给参与分区加自定义字段（定义变更）→ definition_changed；快照修订号不回写。"""
    resume_id, _ = _create(client)
    before = _detail(client, resume_id)["profile_usage"]["definition_revision"]
    field = client.post(
        f"{SECTIONS_API}/projects/fields",
        json={"label": "导师姓名", "field_type": "single_line"},
    )
    assert field.status_code == 201, field.text
    usage = _usage(client, resume_id)
    assert usage["freshness"]["changed"] is True
    assert "definition_changed" in usage["freshness"]["reasons"]
    assert "content_changed" not in usage["freshness"]["reasons"]
    # 组与参与清单没变：不应误报 group_changed
    assert "group_changed" not in usage["freshness"]["reasons"]
    # 快照是"当时"的定义修订号：定义变了也不回写。
    assert usage["profile_usage"]["definition_revision"] == before


def test_switching_group_marks_group_changed(client) -> None:
    """快照之后切到另一个组 → group_changed；详情仍显示快照里的旧组名。"""
    resume_id, projection = _create(client)
    _switch_to_new_group(client, name="社招", keys=["projects"])
    usage = _usage(client, resume_id)
    assert usage["freshness"]["changed"] is True
    assert "group_changed" in usage["freshness"]["reasons"]
    snapshot = usage["profile_usage"]
    assert snapshot["group_name"] == "默认组"
    assert snapshot["group_id"] == projection["scope"]["group_id"]
    assert snapshot["group_deleted"] is False


def test_deleted_group_keeps_snapshot_and_marks_deleted(client, db_session) -> None:
    """组被删除后历史仍可读：快照照常返回，group_deleted=true（R-33 验收口径）。"""
    group = _switch_to_new_group(client, name="应届生", keys=["educations", "projects"])
    resume_id, _ = _create(client)
    snapshot = _detail(client, resume_id)["profile_usage"]
    assert snapshot["group_name"] == "应届生"
    assert [item["key"] for item in snapshot["participating"]] == [
        "basic_info",
        "educations",
        "projects",
    ]
    assert snapshot["group_deleted"] is False

    deleted = client.request(
        "DELETE",
        f"{GROUPS_API}/{group['group_id']}",
        json={"expected_revision": group["revision"]},
    )
    assert deleted.status_code == 200, deleted.text

    after = _detail(client, resume_id)["profile_usage"]
    assert after["group_name"] == "应届生"  # 组名快照仍可读，不按当前组回填
    assert after["group_deleted"] is True
    usage = _usage(client, resume_id)
    assert "group_changed" in usage["freshness"]["reasons"]
    # 快照行还在（逻辑引用，不随父行删除）
    assert len(_snapshot_rows(db_session)) == 1


def test_profile_usage_404_for_missing_and_deleted_resume(client) -> None:
    assert client.get("/api/resumes/999999/profile-usage").status_code == 404
    resume_id, _ = _create(client)
    assert client.delete(f"/api/resumes/{resume_id}").status_code == 204
    assert client.get(f"/api/resumes/{resume_id}/profile-usage").status_code == 404
    assert client.get(f"/api/resumes/{resume_id}").status_code == 404


def test_profile_usage_is_read_only(client, db_session) -> None:
    """多次读取不改简历/快照/工作区，也不新增第二行快照。"""
    resume_id, _ = _create(client)
    rows = _snapshot_rows(db_session)
    assert len(rows) == 1
    before_snapshot = _row_state(rows[0])
    before_detail = _detail(client, resume_id)
    before_state = client.get(WORKSPACE_API).json()["workspace_revision"]

    for _ in range(3):
        _usage(client, resume_id)
        _detail(client, resume_id)

    after_detail = _detail(client, resume_id)
    assert after_detail["revision"] == before_detail["revision"]
    assert after_detail["content"] == before_detail["content"]
    assert after_detail["profile_usage"] == before_detail["profile_usage"]
    assert client.get(WORKSPACE_API).json()["workspace_revision"] == before_state
    rows_after = _snapshot_rows(db_session)
    assert len(rows_after) == 1
    assert _row_state(rows_after[0]) == before_snapshot


def test_editing_resume_content_does_not_mark_profile_stale(client) -> None:
    """过时判定只看资料/组定义：改简历正文不应提示「资料已更新」。"""
    resume_id, _ = _create(client)
    saved = client.put(f"/api/resumes/{resume_id}", json=_content(name="李四"))
    assert saved.status_code == 200, saved.text
    assert _usage(client, resume_id)["freshness"] == {"changed": False, "reasons": []}
