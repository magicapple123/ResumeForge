# SPDX-License-Identifier: Apache-2.0
"""T7 写边界：v2 记录不再写 `format_config.section_order`（唯一真相是 `document.sections`）。

背景（计划 §5.2 #1）：v1 时代 `section_order` 曾承担三件事——卡片显示顺序、四出口顺序、
结构迁移来源。v2 渲染已经按 `document.sections` 出计划后，这个键只剩**转换期**用途：
`document_converter` 在 v1→v2 时按它落位分区；转换完成后它不该再落库，否则结构页签改了
顺序、旧键还在，备份/诊断/兼容读取继续把它当真。

本文件钉住四条写入路径：
1. 空白简历创建：资料顺序只用于**转换落位**，记录里不再出现 `section_order`；
2. 请求体显式 section_order：同样只用于转换；
3. 生成落库（SSE 与后台任务共用 `save_record`）：不落键；
4. 版式 PATCH（`PATCH /resumes/{id}/layout`）：旧客户端带来的键被剥离，其它覆盖保留。
"""

from __future__ import annotations

from app.services.profile import group_store
from app.services.resume.resume_record import save_record

# 资料页里把「项目经历」拖到最前的那一份（`basic_info` 是页眉，永远在第一）。
PROFILE_KEYS = [
    "basic_info",
    "projects",
    "educations",
    "experiences",
    "skills",
    "campus_experiences",
    "awards",
    "summary",
]

# 一份"有内容、可比对顺序"的 v1 草稿：converter 会按 section_order 决定 v2 分区落位。
LEGACY_CONTENT = {
    "name": "李四",
    "phone": "139-0000-0000",
    "summary": "一句话总结",
    "education": [{"school": "示例大学", "major": "市场营销"}],
    "projects": [{"name": "校园招聘会策划"}],
    "experience": [{"company": "示例科技有限公司", "role": "市场运营专员"}],
}


def _set_profile_order(client, keys: list[str]) -> None:
    response = client.patch("/api/profile", json={"section_order": keys})
    assert response.status_code == 200, response.text


def _create_manual(client, **overrides) -> dict:
    payload = {"content": LEGACY_CONTENT, **overrides}
    response = client.post("/api/resumes/manual", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def _section_keys(record: dict) -> list[str]:
    return [section["key"] for section in record["content"]["sections"]]


def test_manual_resume_uses_profile_order_for_sections_but_does_not_store_it(client):
    """资料顺序只用于转换：document.sections 按其落位，记录里不再写 section_order。"""
    _set_profile_order(client, PROFILE_KEYS)

    record = _create_manual(client)

    assert "section_order" not in record["format_config"]
    keys = _section_keys(record)
    assert keys.index("projects") < keys.index("education") < keys.index("experience")


def test_manual_resume_explicit_section_order_only_affects_conversion(client):
    """请求体显式顺序 → 转换按它落位，但同样不落库。"""
    _set_profile_order(client, PROFILE_KEYS)

    record = _create_manual(client, format_config={"section_order": ["experience", "projects"]})

    assert "section_order" not in record["format_config"]
    keys = _section_keys(record)
    assert keys.index("experience") < keys.index("projects")


# ===== 生成落库（SSE 与后台任务共用的 save_record）=====


def _save_generated(db_session, format_config):
    return save_record(
        db_session,
        LEGACY_CONTENT,
        [],
        None,
        "",
        "test-model",
        False,
        "balanced",
        format_config=format_config,
    )


def test_generated_resume_uses_profile_order_for_sections_without_storing_it(db_session):
    """生成链路：资料顺序用于分区落位；记录 format_config 不再出现 section_order。"""
    state = group_store.read_state(db_session)
    group_store.set_section_order(
        db_session,
        [
            "basic_info",
            *PROFILE_KEYS[1:],
            "publications",
            "research_projects",
            "patents",
            "credentials",
            "languages",
        ],
        expected_revision=int(state.revision or 1),
    )

    record = _save_generated(db_session, None)

    assert "section_order" not in record.format_config
    keys = [section["key"] for section in record.content["sections"]]
    assert keys.index("projects") < keys.index("education")


def test_generated_resume_keeps_frontend_snapshot_for_conversion_only(db_session):
    """前端快照里的顺序只用于转换落位；不落库。"""
    record = _save_generated(db_session, {"section_order": ["experience", "education"]})

    assert "section_order" not in record.format_config
    keys = [section["key"] for section in record.content["sections"]]
    assert keys.index("experience") < keys.index("education")


# ===== 版式 PATCH：旧客户端带来的键被剥离 =====


def test_layout_patch_strips_legacy_section_order_and_keeps_other_overrides(client):
    record = _create_manual(client)
    resume_id = record["id"]
    revision = record["revision"]

    response = client.patch(
        f"/api/resumes/{resume_id}/layout",
        json={
            "format_config": {"section_order": ["awards", "summary"], "accent": "#123456"},
            "expected_revision": revision,
        },
    )

    assert response.status_code == 200, response.text
    saved = response.json()
    assert "section_order" not in saved["format_config"]
    assert saved["format_config"]["accent"] == "#123456"
