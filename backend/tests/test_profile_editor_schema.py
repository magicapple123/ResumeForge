# SPDX-License-Identifier: Apache-2.0
"""F10/R-82 编辑器视图验收：投影 / 隐藏字段 / 自建板块 / 标量分区 / 创建冻结 / 旧快照。

覆盖计划 §3 的六组性质：
1. 投影 editor_schema：板块顺序 == participating_keys；教育字段按定义顺序、resume_attr
   映射到 ResumeContent 槽位（school/gpa/study_form/courses/achievements 等）；
2. 隐藏字段（field preference hidden）不出现在 editor_schema.fields；
3. 自建板块：section_key=custom:xxx、section_name=用户起的名字（22333）、
   resume_field=custom_sections；
4. basic_info 标量 resume_attr（name/phone/...）；summary 的 resume_attr="summary"；
5. 创建手写简历（带 profile_context）后详情 profile_usage.editor_schema 与投影一致，
   且之后改方案不影响这份简历（冻结）；
6. 旧快照（直接造一行 layout 不含 editor_schema）→ detail 返回 None、接口 200；
   坏数据同样降级为 None，不得 500。
"""

from __future__ import annotations

from app.models.profile_usage_snapshot import ProfileUsageSnapshot

PROJECTION_API = "/api/profile/current/projection"
MANUAL_API = "/api/resumes/manual"
SECTIONS_API = "/api/profile/sections"
FIELDS_API = "/api/profile/sections/{section_key}/fields"
PREFERENCES_API = "/api/profile/field-preferences/{field_id}"

EDUCATION_FIELD_ORDER = (
    "school",
    "major",
    "degree",
    "study_form",
    "degree_type",
    "department",
    "start_date",
    "end_date",
    "gpa",
    "rank",
    "advisor",
    "research_direction",
    "core_courses",
    "achievements",
)


def _projection(client) -> dict:
    response = client.get(PROJECTION_API)
    assert response.status_code == 200, response.text
    return response.json()


def _sections(schema: dict) -> dict[str, dict]:
    return {item["section_key"]: item for item in schema["sections"]}


def _section(schema: dict, key: str) -> dict:
    item = _sections(schema).get(key)
    assert item is not None, f"{key} 不在 editor_schema.sections 里"
    return item


def _field_attrs(section: dict) -> dict[str, str | None]:
    return {item["key"]: item["resume_attr"] for item in section["fields"]}


def _profile_context(projection: dict) -> dict:
    """与前端实际发送一致：只回传 token + 参与清单 + 展示用 layout。"""
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


def _create_manual(client, *, context: dict | None = None, title: str = "编辑器视图测试") -> int:
    payload: dict = {"title": title, "content": {"name": "张三", "summary": "后端工程师"}}
    if context is not None:
        payload["profile_context"] = context
    response = client.post(MANUAL_API, json=payload)
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _detail(client, resume_id: int) -> dict:
    response = client.get(f"/api/resumes/{resume_id}")
    assert response.status_code == 200, response.text
    return response.json()


def _create_section(client, name: str) -> dict:
    response = client.post(SECTIONS_API, json={"name": name})
    assert response.status_code == 201, response.text
    return response.json()


def _create_field(client, section_key: str, label: str, field_type: str) -> dict:
    response = client.post(
        FIELDS_API.format(section_key=section_key),
        json={"label": label, "field_type": field_type},
    )
    assert response.status_code == 201, response.text
    return response.json()


def _hide_field(client, field_id: str, section_key: str) -> None:
    response = client.patch(
        PREFERENCES_API.format(field_id=field_id),
        json={"section_key": section_key, "hidden": True},
    )
    assert response.status_code == 200, response.text


def test_projection_editor_schema_follows_participating_order_and_field_order(client) -> None:
    """板块顺序 == 全局顺序；教育字段按定义顺序且 resume_attr 指向纸面槽位。"""
    body = _projection(client)
    schema = body["editor_schema"]
    assert schema is not None
    assert [item["section_key"] for item in schema["sections"]] == (
        body["scope"]["participating_keys"]
    )
    assert schema["workspace_revision"] == body["scope"]["workspace_revision"]

    educations = _section(schema, "educations")
    assert educations["section_name"] == "教育经历"
    assert educations["form"] == "multi"
    assert educations["resume_field"] == "education"
    assert tuple(item["key"] for item in educations["fields"]) == EDUCATION_FIELD_ORDER
    attrs = _field_attrs(educations)
    assert attrs["school"] == "school"
    assert attrs["gpa"] == "gpa"
    assert attrs["study_form"] == "study_form"
    assert attrs["core_courses"] == "courses"  # 目录 key 与 ResumeContent 属性名不同
    assert attrs["achievements"] == "achievements"  # 承载区字段
    # 承载区元数据（需求 #5）：没有独立槽位的字段（用户自定义字段等）以「标签：值」行
    # 追加到这里；编辑器把它当输入框的直接落点，与纸面投影同一口径。
    assert educations["carrier_attr"] == "achievements"
    assert educations["carrier_list"] is True

    # 其余系统分区的 resume_field 同样来自 paper_policy 的同一份表（不在这里复制映射）。
    projects = _section(schema, "projects")
    assert projects["resume_field"] == "projects"
    assert _field_attrs(projects)["outcome_type"] == "artifact_type"  # F8 回填槽位改名
    assert projects["material_only"] is False

    # 仅素材分区：保留板块行，material_only 如实。
    patents = _section(schema, "patents")
    assert patents["material_only"] is True
    assert patents["resume_field"] == "patents"

    # 2026-10：语言能力是独立正文分区（用户反馈 #11），字段逐项映射到 content.languages。
    languages = _section(schema, "languages")
    assert languages["resume_field"] == "languages"
    assert languages["material_only"] is False
    assert _field_attrs(languages) == {
        "language": "name",
        "level": "level",
        "certificate": "certificate",
        "score": "score",
        "obtained_at": "obtained_at",
    }


def test_system_section_carrier_metadata_matches_paper_rule(client) -> None:
    """需求 #5：系统板块的承载区元数据与纸面规则逐字一致，编辑器据此渲染自定义字段输入框。

    carrier_attr / carrier_list 就是纸面投影把「标签：值」行追加到哪、以及是列表还是标量：
    错一列，用户在编辑器里改的值就上不了纸面（或者落到另一列里）。这里只断言"与
    paper_policy.SECTION_RULES 同一份表"，不在测试里复制一份更细的映射。
    """
    schema = _projection(client)["editor_schema"]
    projects = _section(schema, "projects")
    assert projects["carrier_attr"] == "description"
    assert projects["carrier_list"] is True

    skills = _section(schema, "skills")
    assert skills["carrier_attr"] == "level"
    assert skills["carrier_list"] is False

    awards = _section(schema, "awards")
    assert awards["carrier_attr"] == "description"
    assert awards["carrier_list"] is False

    credentials = _section(schema, "credentials")
    assert credentials["carrier_attr"] == "note"
    assert credentials["carrier_list"] is False

    # 仅素材板块（知识产权）没有承载区：自定义字段本就不上纸面，编辑器也不该给输入框。
    patents = _section(schema, "patents")
    assert patents["carrier_attr"] is None
    assert patents["carrier_list"] is False

    # 自建板块的字段走 ResumeCustomEntry.lines，不用系统板块的承载区。
    created = _create_section(client, "承载区自建板块")
    custom = _section(_projection(client)["editor_schema"], created["key"])
    assert custom["carrier_attr"] is None


def test_hidden_field_is_absent_from_editor_schema(client) -> None:
    """隐藏字段在消费 DTO 读取时就被裁掉，因此编辑器视图里也不出现。"""
    before = _section(_projection(client)["editor_schema"], "projects")
    assert "outcome_type" in _field_attrs(before)

    _hide_field(client, "projects.outcome_type", "projects")

    after = _section(_projection(client)["editor_schema"], "projects")
    assert "outcome_type" not in _field_attrs(after)
    # 隐藏逐字段生效，不是整段裁掉：同分区其他字段仍在。
    assert "name" in _field_attrs(after)
    assert "description" in _field_attrs(after)


def test_custom_section_keeps_user_name_and_custom_section_key(client) -> None:
    """自建板块：稳定 key + 用户起的名字（22333）+ resume_field=custom_sections。"""
    created = _create_section(client, "22333")
    key = created["key"]
    assert key.startswith("custom:")
    field = _create_field(client, key, "补充说明", "multi_line")

    schema = _projection(client)["editor_schema"]
    custom = _section(schema, key)
    assert custom["section_name"] == "22333"
    assert custom["form"] == "multi"
    assert custom["resume_field"] == "custom_sections"
    assert [item["field_id"] for item in custom["fields"]] == [field["field_id"]]
    # 自建字段没有独立输入框：值以「标签：值」进承载区，编辑器不单独渲染。
    assert all(item["resume_attr"] is None for item in custom["fields"])
    # 字段行只带定义身份（field_id/key/label/field_type 之外的展示数据由前端决定）。
    assert custom["fields"][0]["label"] == "补充说明"
    assert custom["fields"][0]["field_type"] == "multi_line"
    # 主文本标记：唯一的多行字段就是纸面投影写进 `ResumeCustomEntry.text` 的那个，
    # 前端据此把它绑定到主文本框、其余字段绑定到「标签：值」行。两处必须是同一判定。
    assert custom["fields"][0]["primary"] is True

    # 内置分区上挂的自建小字段同样只借道承载区，不占独立输入框。
    mentor = _create_field(client, "projects", "导师姓名", "single_line")
    projects = _section(_projection(client)["editor_schema"], "projects")
    matched = [item for item in projects["fields"] if item["field_id"] == mentor["field_id"]]
    assert len(matched) == 1
    assert matched[0]["resume_attr"] is None
    # 需求 #5：编辑器不靠"编一个 ResumeContent 属性名"渲染它，而是靠板块的承载区元数据
    # （值写进 projects.description 的「标签：值」行，与纸面投影 extras 同一落点）。
    assert projects["carrier_attr"] == "description"
    assert projects["carrier_list"] is True
    # 系统板块不带主文本标记：它们有槽位/承载区，不需要"哪一格是正文"的判定。
    assert all(item["primary"] is False for item in projects["fields"])


def test_custom_section_primary_field_is_first_multiline(client) -> None:
    """自建板块的主文本字段：`primary_field_id` 之外，取**第一个多行文本字段**。

    这条与 `paper_policy.custom_section_text_field()` 同一个判定：编辑器如果把单行字段
    当成主文本，用户改的值保存后会落到另一种列里（正文 ↔ 标签行互串）。
    """
    created = _create_section(client, "开源贡献")
    key = created["key"]
    single = _create_field(client, key, "角色", "single_line")
    multi = _create_field(client, key, "做的事", "multi_line")

    custom = _section(_projection(client)["editor_schema"], key)
    flags = {item["field_id"]: item["primary"] for item in custom["fields"]}
    assert flags[multi["field_id"]] is True
    assert flags[single["field_id"]] is False


def test_basic_info_and_summary_resume_attrs_map_to_resume_content(client) -> None:
    """标量分区：basic_info 只认身份字段槽位；summary 只认承载区字段。"""
    schema = _projection(client)["editor_schema"]

    basic = _section(schema, "basic_info")
    assert basic["form"] == "singleton"
    assert basic["resume_field"] is None
    attrs = _field_attrs(basic)
    assert attrs["name"] == "name"
    assert attrs["phone"] == "phone"
    assert attrs["email"] == "email"
    assert attrs["birth_month"] == "birth_year"  # v3 改名，ResumeContent 属性不变
    assert attrs["homepage"] == "personal_website"
    assert attrs["github"] == "github"
    assert attrs["job_intention"] == "job_intent"
    assert attrs["photo"] == "photo"
    # 仅素材 / 无独立纸面槽位的字段：编辑器没有独立输入框。
    assert attrs["target_city"] is None
    assert attrs["political_status"] is None

    summary = _section(schema, "summary")
    assert summary["form"] == "singleton"
    assert summary["resume_field"] is None
    carrier_fields = [item for item in summary["fields"] if item["resume_attr"] == "summary"]
    assert [item["field_id"] for item in carrier_fields] == ["summary.content"]
    assert all(
        item["resume_attr"] is None
        for item in summary["fields"]
        if item["field_id"] != "summary.content"
    )


def test_created_resume_freezes_editor_schema_from_projection(client, db_session) -> None:
    """创建时冻结：详情里的 editor_schema 与投影一致，之后改方案不影响已保存简历。"""
    projection = _projection(client)
    resume_id = _create_manual(client, context=_profile_context(projection))

    usage = _detail(client, resume_id)["profile_usage"]
    assert usage is not None
    assert usage["editor_schema"] == projection["editor_schema"]
    standalone = client.get(f"/api/resumes/{resume_id}/profile-usage")
    assert standalone.status_code == 200, standalone.text
    assert standalone.json()["profile_usage"]["editor_schema"] == projection["editor_schema"]

    # 快照 layout 里存的就是投影那份 JSON（F3 冻结的同一份，不靠前端回传）。
    db_session.rollback()
    row = (
        db_session.query(ProfileUsageSnapshot)
        .filter(ProfileUsageSnapshot.resume_id == resume_id)
        .one()
    )
    assert row.layout["editor_schema"] == projection["editor_schema"]

    # 之后隐藏一个字段：当前投影变了，但这份简历的冻结视图保持创建时的样子。
    _hide_field(client, "projects.outcome_type", "projects")
    changed = _section(_projection(client)["editor_schema"], "projects")
    assert "outcome_type" not in _field_attrs(changed)

    frozen = _detail(client, resume_id)["profile_usage"]["editor_schema"]
    assert frozen == projection["editor_schema"]
    assert "outcome_type" in _field_attrs(_section(frozen, "projects"))


def _add_legacy_snapshot(db_session, resume_id: int, *, snapshot_id: str, layout) -> None:
    """直接造一行历史快照（旧版本写出的 layout / 外部写入的可疑结构）。"""
    db_session.add(
        ProfileUsageSnapshot(
            snapshot_id=snapshot_id,
            resume_id=resume_id,
            group_id=None,
            group_name="默认组",
            participating=[],
            section_order=[],
            definition_revision=0,
            data_revision=0,
            layout=layout,
        )
    )
    db_session.commit()


def test_legacy_snapshot_without_editor_schema_returns_none(client, db_session) -> None:
    """旧快照 layout 没有这个键：详情与独立端点都返回 None 且 200（不得 500）。"""
    resume_id = _create_manual(client)  # 不带 profile_context：接口本来不写快照
    _add_legacy_snapshot(
        db_session,
        resume_id,
        snapshot_id="legacyeditor000000000001",
        layout={"group_name": "默认组", "participating": [], "section_order": []},
    )

    detail = client.get(f"/api/resumes/{resume_id}")
    assert detail.status_code == 200, detail.text
    usage = detail.json()["profile_usage"]
    assert usage is not None
    assert usage["editor_schema"] is None

    standalone = client.get(f"/api/resumes/{resume_id}/profile-usage")
    assert standalone.status_code == 200, standalone.text
    assert standalone.json()["profile_usage"]["editor_schema"] is None


def test_malformed_editor_schema_degrades_to_none(client, db_session) -> None:
    """坏数据（非 dict / 结构不合法）同样降级为 None：展示辅助字段不能拖垮详情。"""
    resume_id = _create_manual(client)
    _add_legacy_snapshot(
        db_session,
        resume_id,
        snapshot_id="badeditor0000000000001",
        layout={"editor_schema": {"sections": "oops", "workspace_revision": "nope"}},
    )
    detail = client.get(f"/api/resumes/{resume_id}")
    assert detail.status_code == 200, detail.text
    assert detail.json()["profile_usage"]["editor_schema"] is None

    other_id = _create_manual(client, title="坏 layout 测试")
    _add_legacy_snapshot(
        db_session,
        other_id,
        snapshot_id="badeditor0000000000002",
        layout=["not", "a", "dict"],
    )
    other = client.get(f"/api/resumes/{other_id}")
    assert other.status_code == 200, other.text
    assert other.json()["profile_usage"]["editor_schema"] is None
