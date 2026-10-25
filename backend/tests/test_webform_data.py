# SPDX-License-Identifier: Apache-2.0
"""资料 → 网申扁平字段字典的展开测试（F5：资料来源改为新消费模型）。

F5 起 build_form_data 不再读旧 user_profile 简历内容：资料来源是当前组的消费 DTO
（F2 load_consumed_profile），旧表只保留"网申专用列"的只读来源（微信/证件/籍贯等）。
所以本文件用新模型条目（profile_entry）做夹具，并保留一条反向守卫：旧 UserProfile 的
简历字段不得再出现在网申取数里（R-46）。

源端合并（网申资料/一次性档位/自定义标签/补充记录）在 test_webform_data_sources.py。
"""
from app.models.profile import UserProfile
from app.services.profile import entry_store
from app.services.webform.data import build_catalog, build_form_data, build_webform_view


def _seed(db, section_key: str, values: dict[str, str]) -> None:
    entry_store.upsert_entry(db, section_key, values=values)


def _labels(catalog: list[dict[str, str]]) -> list[str]:
    return [row["label"] for row in catalog]


def _catalog_value(catalog: list[dict[str, str]], label: str) -> str:
    return next(row["value"] for row in catalog if row["label"] == label)


# ===== 基本取值：来源是新模型、不是旧 UserProfile =====


def test_build_form_data_reads_the_new_profile_model(db_session):
    _seed(db_session, "basic_info", {"basic_info.name": "李四", "basic_info.phone": "13900000000"})

    data = build_form_data(db_session)

    assert data["name"] == "李四"
    assert data["phone"] == "13900000000"


def test_old_user_profile_resume_fields_are_not_read_anymore(db_session):
    """R-46：旧资料的简历内容不再被网申链路读取；旧专用列（微信）仍按 R-39 只读可用。"""
    db_session.add(UserProfile(name="旧资料张三", phone="13800000000", target_city="旧城市"))
    db_session.commit()

    data = build_form_data(db_session)

    assert "name" not in data and "phone" not in data and "target_city" not in data


def test_legacy_webform_only_columns_stay_readable(db_session):
    """R-39：微信等网申专用列不属于简历内容，继续只读可用（不受新模型为空影响）。"""
    db_session.add(UserProfile(wechat="wx-001", qq="10001"))
    db_session.commit()

    data = build_form_data(db_session)

    assert data["wechat"] == "wx-001"
    assert data["qq"] == "10001"


# ===== 教育/经历挑选 =====


def test_the_highest_degree_wins_not_the_first_one(db_session):
    _seed(db_session, "educations", {"educations.school": "本科大学", "educations.degree": "本科"})
    _seed(db_session, "educations", {"educations.school": "硕士大学", "educations.degree": "硕士"})

    data = build_form_data(db_session)

    assert data["school"] == "硕士大学"
    assert data["degree"] == "硕士"


def test_the_latest_experience_wins_and_ongoing_counts_as_latest(db_session):
    _seed(
        db_session,
        "experiences",
        {"experiences.company": "旧公司", "experiences.end_date": "2024-06"},
    )
    _seed(db_session, "experiences", {"experiences.company": "至今公司", "experiences.end_date": "至今"})

    data = build_form_data(db_session)

    assert data["company"] == "至今公司"
    assert data["work_end"] == "至今"


def test_each_experience_is_expanded_with_a_stable_block_number(db_session):
    _seed(db_session, "experiences", {"experiences.company": "甲公司", "experiences.title": "一号岗位"})
    _seed(db_session, "experiences", {"experiences.company": "乙公司", "experiences.title": "二号岗位"})

    data = build_form_data(db_session)

    assert data["experience_1_company"] == "甲公司"
    assert data["experience_2_company"] == "乙公司"
    assert data["experience_2_role"] == "二号岗位"
    # 兼容 key 严格对应资料第 1 条，最近一条由 company/job_title 提供。
    assert data["experience_company"] == "甲公司"
    assert data["company"] == "乙公司"


def test_courses_and_achievements_follow_the_top_education(db_session):
    _seed(
        db_session,
        "educations",
        {
            "educations.degree": "本科",
            "educations.core_courses": "Python\n数据库",
            "educations.achievements": "一等奖",
        },
    )

    data = build_form_data(db_session)

    assert data["courses"] == "Python\n数据库"
    assert data["education_1_courses"] == "Python；数据库"
    assert data["education_1_achievements"] == "一等奖"


def test_project_and_campus_columns_are_matched_by_record(db_session):
    _seed(
        db_session,
        "projects",
        {
            "projects.name": "推荐系统",
            "projects.tech_stack": "Python, FastAPI",
            "projects.highlights": "延迟降低",
        },
    )
    _seed(
        db_session,
        "campus_experiences",
        {"campus_experiences.organization": "学生会", "campus_experiences.description": "组织活动"},
    )

    data = build_form_data(db_session)

    assert data["project_name"] == "推荐系统"
    assert data["project_tech_stack"] == "Python, FastAPI"
    assert data["project_1_highlights"] == "延迟降低"
    assert data["campus_organization"] == "学生会"
    assert data["campus_1_description"] == "组织活动"


def test_empty_values_are_dropped_so_they_never_overwrite_anything(db_session):
    _seed(db_session, "basic_info", {"basic_info.name": "张三"})

    data = build_form_data(db_session)

    assert "wechat" not in data
    assert "id_number" not in data
    assert data["name"] == "张三"


def test_the_target_job_title_overrides_the_generic_intent(db_session):
    _seed(db_session, "basic_info", {"basic_info.job_intention": "后端开发"})

    assert build_form_data(db_session, job_title="AI 应用开发")["job_intent"] == "AI 应用开发"
    assert build_form_data(db_session)["job_intent"] == "后端开发"


def test_values_are_stripped(db_session):
    _seed(db_session, "basic_info", {"basic_info.name": "  张三  "})

    assert build_form_data(db_session)["name"] == "张三"


# ===== 给人挑的清单 =====


def test_the_catalog_lists_every_record_not_just_the_latest(db_session):
    _seed(db_session, "experiences", {"experiences.company": "甲公司"})
    _seed(db_session, "experiences", {"experiences.company": "乙公司"})

    values = [row["value"] for row in build_catalog(db_session)]

    assert "甲公司" in values and "乙公司" in values
    groups = {row["group"] for row in build_catalog(db_session)}
    assert "实习/工作经历 1" in groups and "实习/工作经历 2" in groups


def test_the_catalog_does_not_list_the_same_value_twice(db_session):
    _seed(db_session, "educations", {"educations.school": "天津工业大学"})

    rows = [row for row in build_catalog(db_session) if row["value"] == "天津工业大学"]

    assert len(rows) == 1, [(row["group"], row["label"]) for row in rows]


def test_a_scalar_field_named_like_a_record_column_is_not_dropped(db_session):
    _seed(db_session, "basic_info", {"basic_info.name": "张三"})

    assert "姓名" in _labels(build_catalog(db_session))


def test_empty_values_do_not_show_up_in_the_catalog(db_session):
    _seed(db_session, "basic_info", {"basic_info.name": "张三"})

    catalog = build_catalog(db_session)

    assert all(row["value"].strip() for row in catalog)
    assert "微信号" not in _labels(catalog)


def test_long_text_is_flattened_for_scanning(db_session):
    _seed(db_session, "experiences", {"experiences.description": "做A\n\n做B\n  "})

    catalog = build_catalog(db_session)
    description = _catalog_value(catalog, "工作内容")

    assert "\n" not in description
    assert "做A" in description and "做B" in description


def test_custom_field_on_a_builtin_section_is_offered_with_label(db_session):
    """R-11/R-16：内置分区下的自建小字段也走同一份目录（CUSTOM_ 键 + 标签）。"""
    from app.services.profile import definition_store

    definition_store.create_custom_field(
        db_session, "projects", "合作方", "single_line"
    )
    field_id = next(
        row.field_id
        for row in definition_store.get_section(db_session, "projects").fields
        if not row.is_builtin
    )
    _seed(db_session, "projects", {"projects.name": "推荐系统", field_id: "合作方A"})

    data = build_form_data(db_session)
    catalog = build_catalog(db_session)

    assert data[f"CUSTOM_{field_id}"] == "合作方A"
    assert _catalog_value(catalog, "合作方") == "合作方A"


def test_build_webform_view_returns_data_and_catalog_from_one_snapshot(db_session):
    _seed(db_session, "basic_info", {"basic_info.name": "李四"})

    view = build_webform_view(db_session)

    assert view.data["name"] == "李四"
    assert "姓名" in _labels(view.catalog)
    assert view.custom_labels == {}
