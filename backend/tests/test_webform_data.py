"""资料 → 扁平字段字典的展开测试。

``profile_to_form_data`` 是纯函数（只读传入对象的属性），所以大部分用例用轻量替身即可；
``build_form_data`` 走真实会话，单独一条覆盖取数链路。
"""
from types import SimpleNamespace

from app.models.profile import UserProfile
from app.models.web_form_profile import REUSE_ONCE, WebFormProfileEntry
from app.services.webform.data import (
    build_form_data,
    build_live_form_data,
    pick_latest_experience,
    pick_top_education,
    profile_to_form_data,
)


def _education(**overrides):
    base = {
        "id": 1,
        "degree": "本科",
        "school": "天津工业大学",
        "department": "计算机科学与技术学院",
        "major": "软件工程",
        "degree_type": "",
        "study_mode": "",
        "start_date": "2022.09",
        "end_date": "2026.06",
        "gpa": "3.8/4.0",
        "cet4_score": "",
        "cet6_score": "",
        "courses": "",
        "achievements": "",
    }
    base.update(overrides)
    return SimpleNamespace(**base)


def _experience(**overrides):
    base = {
        "id": 1,
        "company": "",
        "role": "",
        "start_date": "",
        "end_date": "",
        "description": "",
    }
    base.update(overrides)
    return SimpleNamespace(**base)


def _profile(**overrides):
    base = {
        "name": "张三",
        "gender": "男",
        "birth_year": "",
        "birth_date": "",
        "phone": "13800000000",
        "phone_country_code": "+86",
        "email": "z@example.com",
        "wechat": "",
        "city": "天津",
        "target_city": "",
        "job_intent": "",
        "personal_website": "",
        "github": "",
        "summary": "",
        "country_region": "",
        "native_place": "",
        "political_status": "",
        "id_type": "",
        "id_number": "",
        "family_info": "",
        "expected_salary": "",
        "qq": "",
        "advisor": "",
        "research_direction": "",
        "preferred_industry": "",
        "educations": [],
        "experiences": [],
        "campus_experiences": [],
        "projects": [],
        "skills": [],
        "awards": [],
    }
    base.update(overrides)
    return SimpleNamespace(**base)


# ===== 选哪一条教育经历 =====


def test_the_highest_degree_wins_not_the_first_one():
    """用户常先填本科、后补硕士；取第一条会填成本科。"""
    education, total = pick_top_education(
        [_education(id=1, degree="本科"), _education(id=2, degree="硕士", school="某大学")]
    )
    assert education.school == "某大学"
    assert total == 2


def test_the_same_degree_keeps_the_earlier_record():
    education, _ = pick_top_education(
        [_education(id=1, school="第一所"), _education(id=2, school="第二所")]
    )
    assert education.school == "第一所"


def test_an_unknown_degree_ranks_below_every_known_one():
    education, _ = pick_top_education(
        [_education(id=1, degree="其他"), _education(id=2, degree="大专")]
    )
    assert education.degree == "大专"


def test_no_education_is_not_an_error():
    education, total = pick_top_education([])
    assert education is None
    assert total == 0


def test_education_variants_rank_by_their_common_name():
    """资料里"博士研究生"这种写法也要排到最高。"""
    education, _ = pick_top_education(
        [_education(id=1, degree="本科"), _education(id=2, degree="博士研究生")]
    )
    assert education.degree == "博士研究生"


# ===== 最近一段经历 =====


def test_the_latest_experience_wins_and_ongoing_counts_as_latest():
    experience = pick_latest_experience(
        [
            _experience(id=1, company="旧公司", end_date="2024.06"),
            _experience(id=2, company="至今公司", end_date=""),
            _experience(id=3, company="中间公司", end_date="2025.01"),
        ]
    )
    assert experience.company == "至今公司"


def test_no_experience_is_not_an_error():
    assert pick_latest_experience([]) is None


# ===== 展开成扁平字段 =====


def test_education_columns_are_flattened_from_the_top_record():
    data = profile_to_form_data(
        _profile(
            educations=[_education(id=1, degree="本科"), _education(id=2, degree="硕士", school="某大学")]
        )
    )
    assert data["school"] == "某大学"
    assert data["degree"] == "硕士"
    assert data["education_end"] == "2026.06"


def test_cet_scores_follow_the_top_education_record():
    """四六级分数录在**教育经历**上，取的是最高学历那一条——与其它教育字段同规则。

    （用户的要求："把四六级分数放到教育经历里面"。它跟着这条规则走而不是"找最近一次
    非空的分数"，所以研究生的分数要填在研究生那条里才生效。）
    """
    data = profile_to_form_data(
        _profile(
            educations=[
                _education(id=1, degree="本科", cet4_score="520", cet6_score="480"),
                _education(id=2, degree="硕士", school="某大学", cet6_score="512"),
            ]
        )
    )
    # 取硕士那一条：六级有值、四级没填（所以四级不进 data，不会去覆盖页面上的东西）。
    assert data["cet6_score"] == "512"
    assert "cet4_score" not in data


def test_cet_scores_are_absent_when_no_education_record_has_them():
    """没填就不产生这个键——空值不进 data，免得覆盖页面上的已有值。"""
    data = profile_to_form_data(_profile(educations=[_education(id=1)]))

    assert "cet4_score" not in data
    assert "cet6_score" not in data


def test_form_data_carries_every_resume_section_into_matchable_keys():
    data = profile_to_form_data(
        _profile(
            educations=[
                _education(
                    courses="Python\n数据库",
                    achievements="一等奖",
                )
            ],
            campus_experiences=[
                SimpleNamespace(
                    organization="学生会",
                    role="部长",
                    start_date="2023-09",
                    end_date="2024-06",
                    description="组织活动",
                )
            ],
            projects=[
                SimpleNamespace(
                    id=1,
                    name="推荐系统",
                    role="开发者",
                    start_date="2024-01",
                    end_date="2024-06",
                    tech_stack="Python, FastAPI",
                    description="搭建服务",
                    highlights="延迟降低",
                )
            ],
            skills=[SimpleNamespace(id=1, name="Python", level="熟练")],
        )
    )

    assert data["courses"] == "Python\n数据库"
    assert data["education_1_courses"] == "Python；数据库"
    assert data["education_1_achievements"] == "一等奖"
    assert data["project_tech_stack"] == "Python, FastAPI"
    assert data["project_1_highlights"] == "延迟降低"
    assert data["campus_organization"] == "学生会"
    assert data["campus_1_description"] == "组织活动"
    assert data["skill_name"] == "Python"
    assert data["skill_1_mastery"] == "熟练"


def test_empty_values_are_dropped_so_they_never_overwrite_anything():
    data = profile_to_form_data(_profile())
    assert "wechat" not in data
    assert "id_number" not in data
    assert data["name"] == "张三"


def test_form_data_expands_each_experience_with_a_stable_block_number():
    data = profile_to_form_data(
        _profile(
            experiences=[
                _experience(id=1, company="第一家公司", role="一号岗位"),
                _experience(id=2, company="第二家公司", role="二号岗位"),
            ]
        )
    )

    assert data["experience_1_company"] == "第一家公司"
    assert data["experience_2_company"] == "第二家公司"
    assert data["experience_2_role"] == "二号岗位"
    # 兼容 key 也必须与页面的第一条一致，不能再把最近一条冒充第一条。
    assert data["experience_company"] == "第一家公司"


def test_birth_year_falls_back_to_the_full_birth_date():
    """资料里可能只填了完整出生日期，而表单要的是年份（或反过来）。"""
    data = profile_to_form_data(_profile(birth_date="2004-03-15"))
    assert data["birth_year"] == "2004"

    data = profile_to_form_data(_profile(birth_year="2004"))
    assert data["birth_year"] == "2004"


def test_the_target_job_title_overrides_the_generic_intent():
    """在投的这个岗位比资料里那句泛泛的"求职意向"更贴近表单想要的答案。"""
    data = profile_to_form_data(_profile(job_intent="后端开发"), job_title="AI 应用开发")
    assert data["job_intent"] == "AI 应用开发"

    data = profile_to_form_data(_profile(job_intent="后端开发"))
    assert data["job_intent"] == "后端开发"


def test_values_are_stripped():
    data = profile_to_form_data(_profile(name="  张三  "))
    assert data["name"] == "张三"


# ===== 给人挑的清单 =====


def test_the_catalog_lists_every_record_not_just_the_latest():
    """**这是"让人自己挑"能绕开多段经历限制的地方**：清单里得有第二条实习经历，
    否则用户点到第二个区块时根本挑不到。"""
    from app.services.webform.data import catalog_from_profile

    profile = _profile(
        experiences=[
            _experience(id=1, company="甲公司", end_date="2024.09"),
            _experience(id=2, company="乙公司", end_date="2025.09"),
        ]
    )

    values = [item["value"] for item in catalog_from_profile(profile)]

    assert "甲公司" in values and "乙公司" in values


def test_the_catalog_groups_by_section():
    from app.services.webform.data import catalog_from_profile

    profile = _profile(
        name="张三",
        educations=[_education(id=1, school="天津工业大学")],
        experiences=[_experience(id=1, company="甲公司")],
    )
    items = catalog_from_profile(profile)
    groups = {item["group"] for item in items}

    assert "身份信息" in groups and "联系方式" in groups
    assert "教育经历 1" in groups and "实习和工作 1" in groups


def test_the_catalog_does_not_list_the_same_value_twice():
    """教育/实习在目录里既有扁平字段（取最近一条）又有按条分组。两份都放会让用户
    看到同一个值出现两次。"""
    from app.services.webform.data import catalog_from_profile

    profile = _profile(educations=[_education(id=1, school="天津工业大学")])
    items = catalog_from_profile(profile)

    schools = [item for item in items if item["value"] == "天津工业大学"]
    assert len(schools) == 1, [(item["group"], item["label"]) for item in schools]


def test_a_scalar_field_named_like_a_record_column_is_not_dropped():
    """**回归守卫**：`_MIRRORED_BY_RECORDS` 里那份是**手写的目录键名**。

    曾经想省事用子表列名生成，结果 `project.name` / `award.name` 的列名 `name` 把目录里
    的「姓名」也一起排除了——清单上直接少了姓名，而这种缺失一眼看不出来。
    """
    from app.services.webform.data import catalog_from_profile

    items = catalog_from_profile(_profile(name="张三"))
    labels = [item["label"] for item in items]

    assert "姓名" in labels


def test_empty_values_do_not_show_up_in_the_catalog():
    from app.services.webform.data import catalog_from_profile

    items = catalog_from_profile(_profile())

    assert all(item["value"].strip() for item in items)
    assert not any(item["label"] == "微信号" for item in items)


def test_long_text_is_flattened_for_scanning():
    """工作内容在资料里是换行存的，清单是给人扫的——压成一行。"""
    from app.services.webform.data import catalog_from_profile

    profile = _profile(
        experiences=[_experience(id=1, company="甲", description="做A\n\n做B\n  ")]
    )
    items = catalog_from_profile(profile)
    description = next(item for item in items if item["label"] == "工作内容")

    assert "\n" not in description["value"]
    assert "做A" in description["value"] and "做B" in description["value"]


def test_build_catalog_reads_through_a_real_session(db_session):
    from app.services.webform.data import build_catalog

    db_session.add(UserProfile(name="李四", phone="13900000000"))
    db_session.commit()

    items = build_catalog(db_session)

    name = next(item for item in items if item["label"] == "姓名")
    assert name["value"] == "李四"
    # `key` 是给「可能是这几个」排序用的（`service.related_entries` 靠它取同义词表）。
    assert name["key"] == "name"


def test_build_form_data_reads_through_a_real_session(db_session):
    db_session.add(UserProfile(name="李四", phone="13900000000"))
    db_session.commit()

    data = build_form_data(db_session)

    assert data["name"] == "李四"
    assert data["phone"] == "13900000000"


def test_webform_data_uses_all_saved_entries_for_batch_and_live(db_session):
    db_session.add(
        WebFormProfileEntry(
            field_key="referral_code", value="ABC123", reuse=REUSE_ONCE
        )
    )
    db_session.commit()

    assert build_form_data(db_session)["referral_code"] == "ABC123"
    assert build_live_form_data(db_session)["referral_code"] == "ABC123"


def test_live_form_data_maps_an_exact_custom_label_to_its_webform_field(db_session):
    db_session.add(
        WebFormProfileEntry(
            field_key="CUSTOM_内推码推荐人",
            value="345354543",
            label=" 内推码 ／ 推荐人 ",
        )
    )
    db_session.commit()

    live_data = build_live_form_data(db_session)

    assert live_data["CUSTOM_内推码推荐人"] == "345354543"
    assert live_data["referral_code"] == "345354543"
    assert "referral_code" not in build_form_data(db_session)


def test_live_form_data_prefers_the_existing_preset_value_over_a_custom_label(
    db_session,
):
    db_session.add_all(
        [
            WebFormProfileEntry(
                field_key="referral_code",
                value="PRESET123",
            ),
            WebFormProfileEntry(
                field_key="CUSTOM_内推码推荐人",
                value="CUSTOM456",
                label="内推码/推荐人",
            ),
        ]
    )
    db_session.commit()

    assert build_live_form_data(db_session)["referral_code"] == "PRESET123"


def test_live_form_data_does_not_alias_ambiguous_custom_labels(db_session):
    db_session.add_all(
        [
            WebFormProfileEntry(
                field_key="CUSTOM_referral_one",
                value="111",
                label="内推码/推荐人",
            ),
            WebFormProfileEntry(
                field_key="CUSTOM_referral_two",
                value="222",
                label="内推码 / 推荐人",
            ),
        ]
    )
    db_session.commit()

    assert "referral_code" not in build_live_form_data(db_session)


def test_live_form_data_maps_custom_label_when_the_field_label_is_also_a_synonym(db_session):
    """**回归守卫**：`salary` 的 label「期望薪资」同时也在自己的同义词表里。

    同一字段会对同一标签贡献两次，唯一性判定若不按字段去重，就会把唯一命中
    误判成歧义——别名支线对这类字段（全部 source="extra" 字段都是）全部失效。
    """
    db_session.add(
        WebFormProfileEntry(
            field_key="CUSTOM_期望薪资",
            value="25k",
            label="期望薪资",
        )
    )
    db_session.commit()

    live_data = build_live_form_data(db_session)

    assert live_data["salary"] == "25k"


def test_live_form_data_does_not_alias_when_two_custom_fields_share_a_standard_label(db_session):
    """同名（归一后）的两条自定义字段仍是歧义，不映射到标准字段。"""
    db_session.add_all(
        [
            WebFormProfileEntry(
                field_key="CUSTOM_salary_one",
                value="25k",
                label="期望薪资",
            ),
            WebFormProfileEntry(
                field_key="CUSTOM_salary_two",
                value="30k",
                label="期望薪资",
            ),
        ]
    )
    db_session.commit()

    assert "salary" not in build_live_form_data(db_session)


def test_live_form_data_keeps_the_preset_standard_value_over_a_same_named_custom_field(db_session):
    """已有规范字段值优先——即使自定义标签与标准标签精确同名也不覆盖。"""
    db_session.add_all(
        [
            WebFormProfileEntry(field_key="salary", value="30k"),
            WebFormProfileEntry(
                field_key="CUSTOM_期望薪资",
                value="25k",
                label="期望薪资",
            ),
        ]
    )
    db_session.commit()

    assert build_live_form_data(db_session)["salary"] == "30k"
