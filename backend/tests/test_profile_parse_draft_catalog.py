# SPDX-License-Identifier: Apache-2.0
"""F4-BE 识别草稿新目录测试：/api/profile/parse-text 的 sections（F4 契约 §6）。

覆盖四组性质：
1. 旧响应的旧字段完整保留（向前兼容，前端逐批迁移），只新增 sections；
2. sections 恰为 definition_catalog 的 13 个内置分区（key/名称/顺序/默认字段/标签全部
   来自目录，前端不再维护旧→新映射——R-16 唯一目录）；
3. 多条目分区：fields = 第一条，entries 承载全部条目（按钮式校对）；
4. 已移除字段不复活：教育 CET4/CET6、专业技能的证书/成绩/取得时间既不出现在 field_id
   也不出现在 label；旧字段值仍留在旧响应里。
"""

from __future__ import annotations

from app.services.profile import definition_catalog

PARSE_API = "/api/profile/parse-text"

BUILTIN_ORDER = (
    "basic_info",
    "educations",
    "experiences",
    "projects",
    "skills",
    "campus_experiences",
    "awards",
    "summary",
    "publications",
    "research_projects",
    "patents",
    "credentials",
    "languages",
)


PROFILE_TEXT = """姓名：张三
邮箱：zhangsan@example.com
手机号：13800000000
求职意向：后端开发工程师

教育经历
天津工业大学｜软件工程｜本科｜2022.09-2026.06
核心课程：数据结构、数据库

实习经历
某科技公司｜后端开发实习生｜2025.06-2025.09
负责 FastAPI 服务开发

项目经历
简历通｜核心开发｜2025.01-至今
技术栈：Python、FastAPI、React
项目描述：搭建简历平台
亮点：支持岗位导向简历生成

专业技能
Python（熟练）、FastAPI、SQL

荣誉奖项
奖学金｜2024.10

个人总结
具备后端开发和项目协作经验。"""

TWO_EDUCATIONS_TEXT = """姓名：李四

教育经历
学校：甲大学 专业：软件工程 学位：本科 时间：2020-2024
课程：算法、数据库
学校：乙大学 专业：计算机科学 学位：硕士 时间：2024-2026
课程：机器学习

工作经历
公司：甲科技 职位：后端工程师 时间：2024.06-2025.06
工作内容：负责接口开发"""


def _parse(client, text: str) -> dict:
    response = client.post(PARSE_API, json={"text": text})
    assert response.status_code == 200, response.text
    return response.json()


def _section(draft: dict, key: str) -> dict:
    for section in draft["sections"]:
        if section["key"] == key:
            return section
    raise AssertionError(f"sections 缺少分区：{key}")


def _values(section: dict) -> dict[str, str]:
    return {field["field_id"]: field["value"] for field in section["fields"]}


def test_old_shape_is_preserved_and_sections_added(client) -> None:
    """旧字段一个不改（含 educations 数组/ warnings/ parse_engine），只追加 sections。"""
    draft = _parse(client, PROFILE_TEXT)
    assert draft["name"] == "张三"
    assert draft["email"] == "zhangsan@example.com"
    assert draft["job_intent"] == "后端开发工程师"
    assert draft["educations"][0]["school"] == "天津工业大学"
    assert draft["projects"][0]["tech_stack"] == "Python、FastAPI、React"
    assert isinstance(draft["warnings"], list)
    assert draft["parse_engine"] == "local"  # 测试环境未配置模型 → 本地规则
    assert isinstance(draft["sections"], list)  # 新增字段（可选，向后兼容）


def test_sections_are_exactly_the_13_builtin_sections_in_catalog_order(client) -> None:
    draft = _parse(client, PROFILE_TEXT)
    sections = draft["sections"]
    assert [section["key"] for section in sections] == list(BUILTIN_ORDER)
    assert [section["name"] for section in sections] == [
        definition_catalog.get_section(key).name for key in BUILTIN_ORDER
    ]
    for section in sections:
        spec = definition_catalog.get_section(section["key"])
        assert spec is not None
        assert [field["field_id"] for field in section["fields"]] == [
            field.field_id for field in spec.fields
        ]
        assert [field["label"] for field in section["fields"]] == [
            field.label for field in spec.fields
        ]


def test_parsed_values_are_mapped_into_catalog_fields(client) -> None:
    draft = _parse(client, PROFILE_TEXT)
    basic = _values(_section(draft, "basic_info"))
    assert basic["basic_info.name"] == "张三"
    assert basic["basic_info.email"] == "zhangsan@example.com"
    assert basic["basic_info.phone"] == "13800000000"
    assert basic["basic_info.job_intention"] == "后端开发工程师"  # 旧 job_intent → 新求职意向
    education = _values(_section(draft, "educations"))
    assert education["educations.school"] == "天津工业大学"
    assert education["educations.major"] == "软件工程"
    assert education["educations.degree"] == "本科"
    assert education["educations.core_courses"] == "数据结构、数据库"  # 旧 courses
    assert education["educations.start_date"] == "2022-09"
    assert education["educations.end_date"] == "2026-06"
    project = _values(_section(draft, "projects"))
    assert project["projects.name"] == "简历通"
    assert project["projects.description"] == "搭建简历平台"
    assert project["projects.tech_stack"] == "Python、FastAPI、React"
    assert project["projects.highlights"] == "支持岗位导向简历生成"
    assert _values(_section(draft, "summary"))["summary.content"] == "具备后端开发和项目协作经验。"
    assert _values(_section(draft, "experiences"))["experiences.company"] == "某科技公司"
    assert _values(_section(draft, "awards"))["awards.title"] == "奖学金"


def test_multi_entries_give_first_fields_plus_optional_entries(client) -> None:
    draft = _parse(client, TWO_EDUCATIONS_TEXT)
    education = _section(draft, "educations")
    assert _values(education)["educations.school"] == "甲大学"  # fields = 第一条
    entries = education.get("entries")
    assert isinstance(entries, list) and len(entries) == 2
    assert _values({"fields": entries[0]["fields"]})["educations.school"] == "甲大学"
    assert _values({"fields": entries[1]["fields"]})["educations.school"] == "乙大学"
    assert _values({"fields": entries[1]["fields"]})["educations.degree_type"] == ""  # 空值也占位
    # 单条分区不重复承载 entries（载荷更小）
    assert "entries" not in _section(draft, "experiences")
    # 单例分区没有 entries
    assert "entries" not in _section(draft, "basic_info")
    assert "entries" not in _section(draft, "summary")


def test_removed_education_fields_never_revive(client) -> None:
    """CET4/CET6 是 v3 移除字段：新目录草稿的 field_id/label 都不得出现（旧字段仍保留）。"""
    text = PROFILE_TEXT.replace(
        "核心课程：数据结构、数据库",
        "核心课程：数据结构、数据库\nCET4：550\nCET6：500",
    )
    draft = _parse(client, text)
    education = _section(draft, "educations")
    field_ids = {field["field_id"] for field in education["fields"]}
    assert not any("cet" in field_id for field_id in field_ids)
    labels = {field["label"] for field in education["fields"]}
    assert "CET4" not in labels and "CET6" not in labels
    # 整个新目录草稿的字段定义里都没有已移除字段（值里保留用户原文不算复活字段）
    all_ids = {field["field_id"] for section in draft["sections"] for field in section["fields"]}
    all_labels = {field["label"] for section in draft["sections"] for field in section["fields"]}
    assert not any("cet" in field_id.lower() for field_id in all_ids)
    assert not any("CET" in label for label in all_labels)
    # 旧响应仍保留旧字段（兼容），但识别器没把 CET 解析出来也不强求有值
    assert "cet4_score" in draft["educations"][0]


def test_removed_skill_fields_never_revive(client) -> None:
    draft = _parse(client, PROFILE_TEXT)
    skills = _section(draft, "skills")
    assert {field["field_id"] for field in skills["fields"]} == {
        "skills.name",
        "skills.level",
        "skills.category",
    }
    labels = {field["label"] for field in skills["fields"]}
    assert labels == {"技能名称", "熟练度", "技能分类"}
    assert not ({"证书", "成绩", "取得时间"} & labels)


def test_empty_input_still_returns_13_sections_with_blank_fields(client) -> None:
    draft = _parse(client, "这是一段无法识别结构的介绍")
    assert [section["key"] for section in draft["sections"]] == list(BUILTIN_ORDER)
    basic = _values(_section(draft, "basic_info"))
    assert basic["basic_info.name"] == ""
    assert all(field["value"] == "" for section in draft["sections"] for field in section["fields"])
    # 未解析出的 5 个新分区（学术/科研/知识产权/证书/语言）也保留空字段供补录
    for key in ("publications", "research_projects", "patents", "credentials", "languages"):
        assert _section(draft, key)["fields"]
