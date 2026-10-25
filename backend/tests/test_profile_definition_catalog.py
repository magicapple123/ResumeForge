# SPDX-License-Identifier: Apache-2.0
"""F1-B 定义目录契约测试：13 个大字段 / 106 个默认小字段逐项钉住（契约 §3/§6）。

覆盖 13 条 key/名称/顺序/形态、106 字段逐分区顺序与类型、18 新增、4 改名、5 移除、
10 收起、12 组枚举、13 行承载区、provenance、字段 id、私密/照片红线，以及导入期自检
真的会拒绝坏数据。值校验同属 F1-B 且只允许写这一个测试文件，一并覆盖。
"""

from __future__ import annotations

import inspect
from dataclasses import replace

import pytest
from app.services.profile import definition_catalog as catalog
from app.services.profile import value_validation as vv

_TYPES = {"s": "single_line", "m": "multi_line", "d": "date_text", "photo": "photo"}


def _fields(spec: str) -> tuple[tuple[str, str, str, bool], ...]:
    """解析 "key:标签:类型码:收起(0/1)" 字段表；顺序即断言顺序（§3.2）。"""
    return tuple(
        (key, label, _TYPES[type_code], collapsed == "1")
        for key, label, type_code, collapsed in (p.split(":") for p in spec.split("; "))
    )


# (key, 中文名, 形态, 承载区字段, 仅素材, 并入来源, 字段表)；字段表按 §3.2，顺序即展示顺序。
EXPECTED_SECTIONS = (
    (
        "basic_info",
        "基本信息",
        "singleton",
        None,
        True,
        (),
        "name:姓名:s:0; gender:性别:s:0; birth_month:出生年月:d:0; phone:手机:s:0; "
        "email:邮箱:s:0; city:城市:s:0; target_city:意向城市:s:0; job_intention:求职意向:s:0; "
        "homepage:个人主页:s:0; github:GitHub:s:0; photo:照片:photo:0; "
        "portfolio_url:作品集链接:s:0; political_status:政治面貌:s:1; "
        "driver_license:驾照:s:0; available_date:到岗时间:s:0",
    ),
    (
        "educations",
        "教育经历",
        "multi",
        "achievements",
        False,
        (),
        "school:学校:s:0; major:专业:s:0; degree:学历:s:0; study_form:学习形式:s:0; "
        "degree_type:学位类型:s:0; department:院系:s:0; start_date:开始时间:d:0; "
        "end_date:结束时间:d:0; gpa:绩点:s:0; rank:成绩排名:s:0; advisor:导师:s:0; "
        "research_direction:研究方向:s:0; core_courses:主修课程:m:0; achievements:在校成果:m:0",
    ),
    (
        "experiences",
        "实习/工作经历",
        "multi",
        "description",
        False,
        ("practice",),
        "company:公司/机构:s:0; title:职位/角色:s:0; start_date:开始时间:d:0; "
        "end_date:结束时间:d:0; description:工作内容:m:0; team_size:团队规模:s:0; "
        "work_type:工作类型:s:1",
    ),
    (
        "projects",
        "项目经历",
        "multi",
        "description",
        False,
        ("work_project",),
        "name:项目名称:s:0; role:角色:s:0; start_date:开始时间:d:0; end_date:结束时间:d:0; "
        "tech_stack:技术栈:s:0; description:项目描述:m:0; highlights:亮点:m:0; "
        "project_size:项目规模:s:0; public_url:公开链接:s:1; outcome_type:成果类型:s:1",
    ),
    (
        "skills",
        "专业技能",
        "multi",
        "level",
        False,
        (),
        "name:技能名称:s:0; level:熟练度:s:0; category:技能分类:s:0",
    ),
    (
        "campus_experiences",
        "校园经历",
        "multi",
        "description",
        False,
        (),
        "organization:组织:s:0; role:角色:s:0; start_date:开始时间:d:0; end_date:结束时间:d:0; "
        "description:经历描述:m:0; activity_type:活动类型:s:0",
    ),
    (
        "awards",
        "荣誉奖项",
        "multi",
        "description",
        False,
        ("award",),
        "title:奖项名称:s:0; awarded_at:获奖时间:d:0; description:奖项说明:m:0; "
        "issuer:颁发机构:s:0; level:奖项级别:s:0; award_ratio:获奖比例:s:0",
    ),
    ("summary", "个人总结/自我评价", "singleton", "content", False, (), "content:正文:m:0"),
    (
        "publications",
        "学术成果",
        "multi",
        "note",
        False,
        ("publication",),
        "title:标题:s:0; outcome_type:成果类型:s:0; authorship_rank:我的署名位次:s:0; "
        "authors:作者:s:0; venue:期刊/会议:s:0; year:年份:d:0; status:状态:s:0; url:链接:s:0; "
        "note:备注:m:0; doi:DOI:s:1; volume_pages:卷期页码:s:1",
    ),
    (
        "research_projects",
        "科研项目",
        "multi",
        "description",
        False,
        ("research_project",),
        "name:项目名称:s:0; role:担任角色:s:0; institution:所属机构:s:0; level:项目级别:s:0; "
        "start_date:开始时间:d:0; end_date:结束时间:d:0; description:项目描述:m:0; "
        "outcomes:项目成果:m:0; funding:经费:s:1",
    ),
    (
        "patents",
        "知识产权",
        "multi",
        None,
        True,
        ("patent",),
        "title:名称:s:0; outcome_type:成果类型:s:0; inventors:发明人:s:0; "
        "inventor_rank:发明人位次:s:0; patent_number:专利号:s:0; status:状态:s:0; "
        "application_date:申请日期:d:0; grant_date:授权日期:d:0; url:链接:s:0; "
        "country:国家/地区:s:1",
    ),
    (
        "credentials",
        "证书资质",
        "multi",
        "note",
        False,
        ("credential",),
        "title:证书名称:s:0; credential_type:证书类型:s:0; issuer:颁发机构:s:0; "
        "issued_at:签发日期:d:0; expires_at:到期日期:d:0; status:状态:s:0; note:备注:m:0; "
        "credential_number:证书编号:s:1; verify_url:核验链接:s:1",
    ),
    (
        "languages",
        "语言能力",
        "multi",
        None,
        True,
        ("language",),
        "language:语言:s:0; level:水平/等级:s:0; certificate:证书:s:0; score:分数:s:0; "
        "obtained_at:取得时间:d:0",
    ),
)

# §3.2 标 [新增] 的 18 个字段；标 [改名] 的是 2 小字段 + 2 大字段；标 [收起] 的共 10 个。
NEW_FIELDS = (
    ("basic_info.portfolio_url", "作品集链接"),
    ("basic_info.political_status", "政治面貌"),
    ("basic_info.driver_license", "驾照"),
    ("basic_info.available_date", "到岗时间"),
    ("educations.rank", "成绩排名"),
    ("educations.advisor", "导师"),
    ("educations.research_direction", "研究方向"),
    ("experiences.team_size", "团队规模"),
    ("projects.project_size", "项目规模"),
    ("skills.category", "技能分类"),
    ("campus_experiences.activity_type", "活动类型"),
    ("awards.award_ratio", "获奖比例"),
    ("publications.outcome_type", "成果类型"),
    ("publications.authorship_rank", "我的署名位次"),
    ("research_projects.level", "项目级别"),
    ("patents.outcome_type", "成果类型"),
    ("patents.inventor_rank", "发明人位次"),
    ("credentials.credential_type", "证书类型"),
)
RENAMED = (
    ("field", "basic_info.birth_month", "出生年月", "出生年份"),
    ("field", "experiences.work_type", "工作类型", "关系类型"),
    ("section", "publications", "学术成果", "论文发表"),
    ("section", "patents", "知识产权", "专利"),
)
REMOVED = (
    ("educations", "CET4"),
    ("educations", "CET6"),
    ("skills", "证书"),
    ("skills", "成绩"),
    ("skills", "取得时间"),
)
COLLAPSED = (
    "basic_info.political_status",
    "experiences.work_type",
    "projects.public_url",
    "projects.outcome_type",
    "publications.doi",
    "publications.volume_pages",
    "research_projects.funding",
    "patents.country",
    "credentials.credential_number",
    "credentials.verify_url",
)
ENUMS = {
    "experiences.work_type": ("全职", "实习", "兼职", "志愿服务", "社会实践"),
    "skills.level": ("精通", "熟练", "掌握", "了解"),
    "skills.category": ("编程语言", "框架与库", "工具与平台", "软技能", "其他"),
    "projects.outcome_type": ("个人项目", "团队项目", "课程项目", "开源项目", "作品集"),
    "campus_experiences.activity_type": ("学生会", "社团", "志愿服务", "社会实践", "竞赛", "其他"),
    "awards.level": ("国家级", "省级", "市级", "校级", "院级", "其他"),
    "publications.outcome_type": ("期刊论文", "会议论文", "专著", "译著", "研究报告", "其他"),
    "publications.authorship_rank": ("第一作者", "第二作者", "第三作者", "通讯作者", "其他"),
    "research_projects.level": ("国家级", "省部级", "校级", "企业横向", "其他"),
    "patents.outcome_type": (
        "发明专利",
        "实用新型",
        "外观设计",
        "软件著作权",
        "集成电路布图",
        "其他",
    ),
    "patents.inventor_rank": ("第一发明人", "第二发明人", "其他"),
    "credentials.credential_type": ("职业资格", "技能认证", "语言证书", "其他"),
}


def _all_fields():
    return [field for spec in catalog.BUILTIN_SECTIONS for field in spec.fields]


def test_13_sections_and_106_fields_match_contract():
    sections = catalog.BUILTIN_SECTIONS
    assert len(sections) == 13 and sections[0].key == "basic_info"
    assert [spec.key for spec in sections] == [row[0] for row in EXPECTED_SECTIONS]
    assert tuple(row[0] for row in EXPECTED_SECTIONS) == catalog.BUILTIN_SECTION_KEYS
    assert tuple(row[1] for row in EXPECTED_SECTIONS) == catalog.BUILTIN_SECTION_NAMES
    singleton = tuple(r[0] for r in EXPECTED_SECTIONS if r[2] == "singleton")
    assert singleton == catalog.SINGLETON_SECTION_KEYS
    for index, (spec, row) in enumerate(zip(sections, EXPECTED_SECTIONS, strict=True), start=1):
        key, name, form, carrier, material_only, provenance, fields = row
        assert (spec.key, spec.name, spec.form, spec.order) == (key, name, form, index)
        assert (spec.carrier_field_key, spec.material_only, spec.provenance) == (
            carrier,
            material_only,
            provenance,
        )
        assert spec.is_builtin is True and spec.singleton == (form == "singleton")
        assert spec.carrier_field_id == (f"{key}.{carrier}" if carrier else None)
        expected = _fields(fields)
        actual = [(f.key, f.label, f.field_type, f.default_collapsed) for f in spec.fields]
        assert actual == list(expected)
        assert [f.order for f in spec.fields] == list(range(1, len(expected) + 1))
    fields = _all_fields()
    assert len(fields) == len(catalog.FIELD_BY_ID) == 106
    assert len({field.field_id for field in fields}) == 106
    assert all(field.field_id == f"{field.section_key}.{field.key}" for field in fields)


def test_18_new_fields_item_by_item():
    assert len(NEW_FIELDS) == len(catalog.NEW_FIELD_IDS) == 18
    assert tuple(field_id for field_id, _ in NEW_FIELDS) == catalog.NEW_FIELD_IDS
    assert all(catalog.get_field(f).label == label for f, label in NEW_FIELDS)


def test_4_renames_and_5_removals_leave_no_legacy_names():
    labels = {field.label for field in _all_fields()}
    names = {spec.name for spec in catalog.BUILTIN_SECTIONS}
    assert len(RENAMED) == 4 and len(REMOVED) == 5
    for kind, target, new_text, old_text in RENAMED:
        if kind == "field":
            field = catalog.get_field(target)
            assert field is not None and field.label == new_text
            assert old_text not in labels
        else:
            assert catalog.get_section(target).name == new_text
            assert old_text not in names
    assert not ({"出生年份", "关系类型", "论文发表", "专利"} & (labels | names))
    pairs = {(spec.key, field.label) for spec in catalog.BUILTIN_SECTIONS for field in spec.fields}
    assert not (set(REMOVED) & pairs)
    assert not {"CET4", "CET6"} & {f.label for f in catalog.get_section("educations").fields}
    assert not {"证书", "成绩", "取得时间"} & {
        f.label for f in catalog.get_section("skills").fields
    }


def test_10_collapsed_fields_and_12_enum_groups():
    assert tuple(f.field_id for f in _all_fields() if f.default_collapsed) == COLLAPSED
    assert {f.field_id: f.enum_suggestions for f in _all_fields() if f.enum_suggestions} == ENUMS
    assert len(COLLAPSED) == 10 and len(ENUMS) == 12


def test_13_carrier_rows_material_only_and_provenance():
    # EXPECTED_SECTIONS 的行: 0=key 1=名称 2=形态 3=承载区 4=仅素材 5=并入来源 6=字段表。
    carriers = {row[0]: row[3] for row in EXPECTED_SECTIONS}
    assert {spec.key: spec.carrier_field_key for spec in catalog.BUILTIN_SECTIONS} == carriers
    assert [row[0] for row in EXPECTED_SECTIONS if row[3] is None] == list(
        catalog.MATERIAL_ONLY_SECTION_KEYS
    )
    for spec in catalog.BUILTIN_SECTIONS:
        carrier = carriers[spec.key]
        assert spec.material_only == (carrier is None)
        field = catalog.carrier_field(spec.key)
        assert (field.field_id if field else None) == (f"{spec.key}.{carrier}" if carrier else None)
    assert {spec.key: spec.provenance for spec in catalog.BUILTIN_SECTIONS} == {
        row[0]: row[5] for row in EXPECTED_SECTIONS
    }
    assert all("training" not in row[5] for row in EXPECTED_SECTIONS)


def test_private_and_photo_field_special_cases():
    private = [f.field_id for f in _all_fields() if f.private]
    assert private == ["credentials.credential_number"]
    number = catalog.get_field(private[0])
    assert (number.llm_allowed, number.webform_allowed) == (False, False)
    photos = [f for f in _all_fields() if f.field_type == "photo"]
    assert [f.field_id for f in photos] == ["basic_info.photo"]
    photo = photos[0]
    assert (photo.llm_allowed, photo.webform_allowed, photo.private) == (False, False, False)


def test_query_helpers():
    assert catalog.get_section("basic_info") is catalog.BUILTIN_SECTIONS[0]
    assert catalog.get_section("nope") is None and catalog.get_field("custom:abc.name") is None
    assert catalog.get_field("basic_info.name").label == "姓名"
    assert catalog.carrier_field("basic_info") is None and catalog.carrier_field("nope") is None
    assert catalog.default_field_ids("skills") == ("skills.name", "skills.level", "skills.category")
    assert catalog.default_field_ids("nope") == ()
    assert catalog.is_singleton("summary") is True
    assert catalog.is_singleton("projects") is False and catalog.is_singleton("nope") is False
    assert catalog.built_in_seed_section_keys() == list(catalog.BUILTIN_SECTION_KEYS)
    assert list(catalog.SECTION_BY_KEY) == list(catalog.BUILTIN_SECTION_KEYS)


def _with_section(index: int, **changes) -> tuple:
    sections = list(catalog.BUILTIN_SECTIONS)
    sections[index] = replace(sections[index], **changes)
    return tuple(sections)


def _with_field(section_index: int, field_index: int, **changes) -> tuple:
    fields = list(catalog.BUILTIN_SECTIONS[section_index].fields)
    fields[field_index] = replace(fields[field_index], **changes)
    return _with_section(section_index, fields=tuple(fields))


BAD_CATALOGS = (
    (_with_section(1, order=1), "order 不连续"),
    (_with_section(0, name="基本资料"), "中文名不一致"),
    (_with_section(1, carrier_field_key="nope"), "承载区字段不属于本分区"),
    (_with_section(10, carrier_field_key="title"), "carrier/material_only 不一致"),
    (_with_field(0, 0, field_id="basic_info.wrong"), "字段 id 不匹配"),
    (_with_field(0, 12, default_collapsed=False), "默认收起不是 10 个"),
    (_with_field(4, 1, enum_suggestions=()), "枚举不是 12 组"),
    (_with_field(0, 2, label="出生年份"), "旧名仍在使用"),
    (_with_field(1, 0, label="CET4"), "已移除字段仍存在"),
    (_with_section(7, fields=()), "字段总数不是 106"),
)


@pytest.mark.parametrize(
    "sections", [case[0] for case in BAD_CATALOGS], ids=[case[1] for case in BAD_CATALOGS]
)
def test_import_time_validation_rejects_bad_catalog(sections):
    assert catalog._validate_catalog(catalog.BUILTIN_SECTIONS) is None
    with pytest.raises(AssertionError):
        catalog._validate_catalog(sections)


def test_import_time_validation_runs_on_import_and_checks_manifests(monkeypatch):
    assert "_validate_catalog(BUILTIN_SECTIONS)" in inspect.getsource(catalog)
    monkeypatch.setattr(catalog, "NEW_FIELD_IDS", catalog.NEW_FIELD_IDS[:-1])
    with pytest.raises(AssertionError):
        catalog._validate_catalog(catalog.BUILTIN_SECTIONS)
    monkeypatch.undo()
    monkeypatch.setattr(catalog, "REMOVED_FIELD_LABELS", catalog.REMOVED_FIELD_LABELS[:4])
    with pytest.raises(AssertionError):
        catalog._validate_catalog(catalog.BUILTIN_SECTIONS)


def test_limits_names_name_key_and_field_types():
    assert (vv.MAX_SINGLE_LINE_CHARS, vv.MAX_MULTI_LINE_CHARS) == (200, 2000)
    assert (vv.MAX_FIELD_LABEL_CHARS, vv.MAX_SECTION_NAME_CHARS) == (40, 40)
    assert (vv.MAX_CUSTOM_FIELDS_PER_SECTION, vv.MAX_ENTRIES_PER_SECTION) == (20, 200)
    assert vv.MAX_GROUPS == 20 and vv.TEXT_FIELD_TYPES == ("single_line", "multi_line", "date_text")
    assert vv.normalize_name_key("  YingJieSheng  ") == "yingjiesheng"
    assert vv.normalize_name_key("应届生") == "应届生"
    assert vv.normalize_name_key("ＡＢＣ") == "ＡＢＣ"  # 全角不折叠
    assert vv.normalize_name_key("ÄBC") == "Äbc"
    assert vv.validate_section_name("  开源贡献 ") == "开源贡献"
    assert vv.validate_field_label(" 导师姓名 ") == "导师姓名"
    for bad in ("", "   ", "长" * 41):
        for validate in (vv.validate_section_name, vv.validate_field_label):
            with pytest.raises(vv.ValidationFailure):
                validate(bad)
    with pytest.raises(vv.ValidationFailure) as failure:
        vv.validate_section_name("长" * 41)
    assert failure.value.code == "section_name_too_long"
    assert "40" in failure.value.detail and "缩短" in failure.value.detail
    for field_type in vv.TEXT_FIELD_TYPES:
        assert vv.validate_field_type(field_type) == field_type
    for bad in ("photo", "", "checkbox"):
        with pytest.raises(vv.ValidationFailure) as failure:
            vv.validate_field_type(bad)
        assert failure.value.code == "field_type_unsupported"


def test_validate_value_by_field_type():
    assert vv.validate_value("single_line", "  张三  ") == "张三"
    assert vv.validate_value("multi_line", " 第一行\n第二行 \n") == "第一行\n第二行"
    assert vv.validate_value("date_text", "2024.09") == "2024-09"
    assert vv.validate_value("date_text", "2024年") == "2024"
    assert vv.validate_value("date_text", "明年") == "明年"  # 无法识别保留原文
    assert vv.validate_value("photo", " user_files/a.png ") == "user_files/a.png"
    assert (
        vv.validate_value("single_line", None) == ""
        and vv.validate_value("single_line", 2024) == "2024"
    )
    assert len(vv.validate_value("multi_line", "字" * 2000)) == 2000
    for field_type, raw in (
        ("single_line", "字" * 201),
        ("multi_line", "字" * 2001),
        ("date_text", "字" * 201),
        ("photo", "a" * 2049),
        ("date_text", {"a": 1}),
    ):
        with pytest.raises(vv.ValidationFailure):
            vv.validate_value(field_type, raw)


def test_validate_values_rejects_unknown_field_and_keeps_empty():
    allowed = {"basic_info.name", "basic_info.phone"}
    assert vv.validate_values("basic_info", {}, allowed) == {}
    values = {"basic_info.name": " 张三 ", "basic_info.phone": ""}
    assert vv.validate_values("basic_info", values, allowed) == {
        "basic_info.name": "张三",
        "basic_info.phone": "",
    }
    number = {"credentials.credential_number": "ABC123"}  # private 字段允许本地保存
    assert vv.validate_values("credentials", number, set(number)) == number
    for bad, code in (({"custom:abc.f1": "x"}, "unknown_field"), (None, "invalid_values")):
        with pytest.raises(vv.ValidationFailure) as failure:
            vv.validate_values("basic_info", bad, allowed)  # type: ignore[arg-type]
        assert failure.value.code == code
    with pytest.raises(vv.ValidationFailure) as failure:
        vv.validate_values("basic_info", {"custom:abc.f1": "x"}, allowed)
    assert "basic_info" in failure.value.detail and "刷新" in failure.value.detail


def test_validate_values_with_types_uses_callers_field_types():
    values = {"custom:abc.f1": " 第一行\n第二行 ", "custom:abc.f2": "2024/09"}
    result = vv.validate_values_with_types(
        "custom:abc", values, {"custom:abc.f1": "multi_line", "custom:abc.f2": "date_text"}
    )
    assert result == {"custom:abc.f1": "第一行\n第二行", "custom:abc.f2": "2024-09"}
    with pytest.raises(vv.ValidationFailure) as failure:
        vv.validate_values_with_types(
            "custom:abc", {"custom:abc.missing": "x"}, {"custom:abc.f1": "multi_line"}
        )
    assert failure.value.code == "unknown_field"
