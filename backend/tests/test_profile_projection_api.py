# SPDX-License-Identifier: Apache-2.0
"""GET /api/profile/current/projection 端点验收（F2-A 的 §6 端点 + 照片 resolver 接线）。

投影算法本身由 paper_projection 及其 owner 的测试覆盖；本文件只钉**端点的职责**：
"解析当前组 → 读消费快照 → 交给 build_projection"，外加两件端点特有的事：
- 响应里不得出现 collapsed（消费 DTO 无折叠态，投影不重新引入）；
- 照片资源 id 经 profile_photos 解析成 data URL，解析不了留空 + photo_unresolved
  warning，但仍返回 200（坏一张照片不阻塞整份投影）。

与 test_profile_scope_boundaries 同属 F2-A 读取边界验收；拆成独立文件是为了守住
"每测试文件 ≤350 行"（scope 边界文件已到 350 行）。
"""

from __future__ import annotations

import base64

from app.models.profile import ProfilePhoto, UserProfile
from app.services.profile import group_store
from tests.document_test_support import field_value, header_value, values

PROJECTION_API = "/api/profile/current/projection"
ENTRIES_API = "/api/profile/sections/{section_key}/entries"
_PNG_DATA_URL = (
    "data:image/png;base64," + base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"0" * 16).decode()
)


def _projection(client) -> dict:
    response = client.get(PROJECTION_API)
    assert response.status_code == 200, response.text
    return response.json()


def _create_entry(client, section_key: str, values: dict) -> dict:
    response = client.post(ENTRIES_API.format(section_key=section_key), json={"values": values})
    assert response.status_code == 201, response.text
    return response.json()


def test_projection_returns_scope_content_candidates_and_stable_token(client):
    """§6：响应 = scope + 纸面内容 + 候选 + 来源布局 + 警告 + 稳定 snapshot_token。"""
    _create_entry(
        client,
        "basic_info",
        {"basic_info.name": "张三", "basic_info.phone": "13800000000"},
    )
    _create_entry(client, "projects", {"projects.name": "项目A", "projects.description": "描述A"})

    first = _projection(client)
    assert first["scope"]["group_name"] == "默认组"
    assert first["scope"]["is_default"] is True
    assert first["scope"]["participating_keys"][0] == "basic_info"
    assert header_value(first["content"], "name") == "张三"
    assert field_value(first["content"], "name", section="projects") == "项目A"
    assert [item["section_key"] for item in first["source_layout"]][:2] == [
        "basic_info",
        "educations",
    ]
    project_candidate = next(
        candidate for candidate in first["candidates"] if candidate["section_key"] == "projects"
    )
    assert project_candidate["title"] == "项目A"
    assert project_candidate["section_name"] == "项目经历"
    assert first["snapshot_token"]
    # 投影响应不得出现 collapsed（§6：工作区读取才是编辑 DTO）
    assert "collapsed" not in str(first)

    second = _projection(client)
    assert second["snapshot_token"] == first["snapshot_token"]  # 同数据必须确定性
    # v2 的 entry/item id 由服务端在每次转换时生成，不参与内容比较；比"内容值"同一口径。
    assert values(second["content"]) == values(first["content"])


def test_projection_scope_follows_current_group(client, db_session):
    """§6：投影只含当前组参与的大字段（换成 2 项组后其他分区整键不出现）。"""
    group = group_store.create_group(db_session, "应届生")
    group_store.set_group_members(
        db_session,
        group.group_id,
        ["basic_info", "projects"],
        expected_revision=group.revision,
    )
    state = group_store.read_state(db_session)
    group_store.switch_current_group(db_session, group.group_id, expected_revision=state.revision)

    body = _projection(client)
    assert body["scope"]["participating_keys"] == ["basic_info", "projects"]
    assert [item["section_key"] for item in body["source_layout"]] == [
        "basic_info",
        "projects",
    ]


def test_projection_resolves_photo_resource_id_and_warns_when_unresolved(client, db_session):
    """照片资源引用：能经 profile_photos 解析则落到 content.photo，解析不了留空 + warning。"""
    profile = UserProfile()
    db_session.add(profile)
    db_session.flush()
    photo = ProfilePhoto(profile_id=profile.id, name="证件照", image=_PNG_DATA_URL, is_primary=True)
    db_session.add(photo)
    db_session.commit()

    _create_entry(
        client,
        "basic_info",
        {"basic_info.name": "张三", "basic_info.photo": f"profile_photo:{photo.id}"},
    )
    assert header_value(_projection(client)["content"], "photo") == _PNG_DATA_URL

    # 指向不存在的照片：纸面留空 + photo_unresolved，但整份投影响应仍可返回。
    _create_entry(client, "basic_info", {"basic_info.photo": "profile_photo:999999"})
    body = _projection(client)
    assert header_value(body["content"], "photo") == ""
    assert any(warning["code"] == "photo_unresolved" for warning in body["warnings"])
