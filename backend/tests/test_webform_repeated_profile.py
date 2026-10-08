"""网申资料多条补充记录的存储与填表展开。"""
from app.models.profile import Education, UserProfile
from app.services.webform import repeated_profile
from app.services.webform.data import build_form_data
from app.services.webform.fields import FORM_FIELDS, SOURCE_EXTRA


def test_repeated_profile_groups_expose_the_catalog(db_session):
    groups = repeated_profile.list_groups(db_session)

    keys = [group["key"] for group in groups]
    assert keys[:4] == ["education", "experience", "project", "campus"]
    assert "academic" in keys
    assert "certificate" in keys
    assert groups[0]["fields"][0]["key"] == "education_class_rank"
    education_group = next(group for group in groups if group["key"] == "education")
    assert not any(field["key"].startswith("education_is_") for field in education_group["fields"])
    assert groups[0]["records"] == []


def test_repeated_records_can_be_added_several_at_once_and_expand_by_order(db_session):
    repeated_profile.save_groups(
        db_session,
        {
            "education": [
                {"values": {"education_class_rank": "3", "education_campus": "主校区"}},
                {"values": {"education_class_rank": "1", "education_special_notes": "最高学历"}},
            ],
            "experience": [
                {
                    "values": {
                        "experience_department": "研发部",
                        "experience_location": "天津",
                    }
                }
            ],
        },
    )

    data = repeated_profile.expand_form_data(db_session)

    assert data == {
        "education_1_class_rank": "3",
        "education_1_campus": "主校区",
        "education_2_class_rank": "1",
        "education_2_special_notes": "最高学历",
        "experience_1_department": "研发部",
        "experience_1_location": "天津",
    }
    assert build_form_data(db_session)["education_2_class_rank"] == "1"


def test_repeated_save_is_a_full_overwrite_and_drops_unknown_fields(db_session):
    repeated_profile.save_groups(
        db_session,
        {"project": [{"values": {"project_link": "https://example.com", "unknown": "x"}}]},
    )
    repeated_profile.save_groups(db_session, {"project": [{"values": {}}]})

    groups = {group["key"]: group for group in repeated_profile.list_groups(db_session)}
    assert groups["project"]["records"] == []


def test_repeated_catalog_entries_keep_the_record_number(db_session):
    repeated_profile.save_groups(
        db_session,
        {
            "academic": [
                {"values": {"academic_paper_name": "第一篇论文"}},
                {"values": {"academic_paper_name": "第二篇论文"}},
            ]
        },
    )

    entries = repeated_profile.catalog_entries(db_session)

    assert [entry["key"] for entry in entries] == [
        "academic_1_paper_name",
        "academic_2_paper_name",
    ]
    assert entries[1]["label"] == "论文名称（第二条）"


def test_web_only_second_education_does_not_override_first_resume_education(db_session):
    db_session.add(UserProfile(name="测试者", educations=[Education(school="简历学校", major="信息工程")]))
    db_session.commit()
    repeated_profile.save_groups(
        db_session,
        {
            "education": [
                {"values": {"school": "网申学校", "education_campus": "北校区"}},
                {"values": {"school": "第二所网申学校", "major": "计算机"}},
            ],
            "portfolio": [
                {"values": {"portfolio_name": "演示作品", "portfolio_link": "https://example.org/one"}},
                {"values": {"portfolio_name": "第二件作品"}},
            ],
            "social": [{"values": {"social_platform": "示例平台", "social_account": "demo"}}],
        },
    )

    data = build_form_data(db_session)
    assert data["education_1_school"] == "简历学校"
    assert data["education_1_campus"] == "北校区"
    assert data["education_2_school"] == "第二所网申学校"
    assert data["education_2_major"] == "计算机"
    assert data["portfolio_1_name"] == "演示作品"
    assert data["portfolio_2_name"] == "第二件作品"
    assert data["social_1_account"] == "demo"


def test_supplement_catalog_covers_multiple_works_and_missing_single_fields(db_session):
    groups = {group["key"]: group for group in repeated_profile.list_groups(db_session)}
    assert {"portfolio", "social", "education", "experience"} <= set(groups)
    assert {"school", "education_expected_graduation"} <= {field["key"] for field in groups["education"]["fields"]}
    assert {"experience_company", "experience_leave_reason"} <= {field["key"] for field in groups["experience"]["fields"]}
    keys = {field.key for field in FORM_FIELDS if field.source == SOURCE_EXTRA}
    assert {"former_name", "student_origin", "interview_city", "ethnicity", "shoe_size"} <= keys
