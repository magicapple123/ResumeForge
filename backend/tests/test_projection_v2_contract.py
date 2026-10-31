# SPDX-License-Identifier: Apache-2.0
"""投影响应/手写创建的 v2 契约（frontend-core 实机问题的后端侧钉住）。

1. GET /api/profile/current/projection：content 是 v2；候选同时带 v2 `document_path`
   (`{section}.{entry_id}`) 与 `document_entry`（该条目的 v2 entry JSON，可直接拼新简历），
   旧的 v1 `paper_content_path` 保留但弃用；`legacy_content` 是本批过渡的 v1 视图。
2. POST /api/resumes/manual：接收 v2 文档时，额外顶层键（如岗位模式拼接的 `job_intent`）
   按「未知键丢弃不 422」处理，落库仍是 v2。
"""

from __future__ import annotations

from app.schemas.profile_projection import ConsumedEntry
from app.services.profile.paper_projection import build_projection
from tests.test_profile_group_projection import (
    _custom_field,
    _custom_section,
    _entry,
    _profile,
    _section,
)


def _projection_with_custom_section():
    custom = _custom_section(
        "abc12345",
        "开源贡献",
        (
            _custom_field("custom:abc12345.contribution", "贡献说明", "multi_line"),
            _custom_field("custom:abc12345.repo", "仓库链接", "single_line"),
        ),
        ConsumedEntry("custom-entry-1", 0, {"custom:abc12345.contribution": "维护内部组件库"}),
    )
    return build_projection(
        _profile(
            _section("projects", _entry("proj-1", "projects", name="检索平台", role="负责人")),
            custom,
        )
    )


def test_projection_candidates_carry_resolvable_v2_entry() -> None:
    out = _projection_with_custom_section()
    assert out.content["version"] == 2
    sections = {section["key"]: section for section in out.content["sections"]}
    for candidate in out.candidates:
        if not candidate.document_entry:
            continue
        assert "." in candidate.document_path
        section_key, entry_id = candidate.document_path.split(".", 1)
        # document_path 的第二段是纸面 v2 entry id（不等于资料 entry_id）
        located = next(
            entry for entry in sections[section_key]["entries"] if entry["id"] == entry_id
        )
        assert located == candidate.document_entry
    projects_candidate = next(c for c in out.candidates if c.section_key == "projects")
    assert projects_candidate.document_path.startswith("projects.")
    assert (
        projects_candidate.document_entry["id"] == projects_candidate.document_path.split(".", 1)[1]
    )
    assert "paper_content_path" not in projects_candidate.model_dump()


def test_projection_uses_native_document_without_transition_fields() -> None:
    out = _projection_with_custom_section()
    assert "legacy_content" not in out.model_dump()
    projects = next(section for section in out.content["sections"] if section["key"] == "projects")
    assert (
        next(item for item in projects["entries"][0]["items"] if item.get("key") == "name")["value"]
        == "检索平台"
    )
    assert (
        next(
            section for section in out.content["sections"] if section["key"].startswith("custom:")
        )["title"]
        == "开源贡献"
    )


def test_manual_create_accepts_v2_with_unknown_top_level_keys(client) -> None:
    projection = _projection_with_custom_section()
    content = dict(projection.content)
    content["job_intent"] = "后端工程师"  # 岗位模式在 v2 文档顶层拼的旧键
    response = client.post(
        "/api/resumes/manual",
        json={
            "title": "v2 契约：未知顶层键丢弃",
            "content": content,
            "job_id": None,
        },
    )
    assert response.status_code == 201, response.text
    created = response.json()
    assert created["content"]["version"] == 2
    assert "job_intent" not in created["content"]  # 未知键丢弃，不 422
