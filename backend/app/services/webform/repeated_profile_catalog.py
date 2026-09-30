"""网申资料中可重复记录的字段目录。

这些字段是简历资料的补充，不复制简历里已经存在的学校、单位、项目名称等基础内容。
每条记录会按所属经历的序号展开成 ``education_1_*``、``experience_2_*`` 这类
网申填表字段，供匹配器区分同一页面上的多组控件。
"""
from __future__ import annotations

from dataclasses import dataclass, replace

from .repeated_profile_additions import (
    ADDITIONAL_GROUPS,
    ADDITIONAL_SYNONYMS,
    GROUP_FIELD_ADDITIONS,
    FieldSpec,
)


@dataclass(frozen=True)
class RepeatedProfileField:
    """一条可重复的网申补充字段。"""

    key: str
    label: str
    kind: str = "text"
    sensitive: bool = False
    options: tuple[str, ...] = ()


@dataclass(frozen=True)
class RepeatedProfileGroup:
    """一组可以新增多条的网申补充资料。"""

    key: str
    label: str
    family: str
    fields: tuple[RepeatedProfileField, ...]


def _field(
    key: str,
    label: str,
    kind: str = "text",
    *,
    options: tuple[str, ...] = (),
    sensitive: bool = False,
) -> RepeatedProfileField:
    return RepeatedProfileField(
        key=key, label=label, kind=kind, options=options, sensitive=sensitive
    )


def _from_spec(spec: FieldSpec) -> RepeatedProfileField:
    return _field(spec[0], spec[1], spec[2], sensitive=spec[3])


REPEATED_PROFILE_GROUPS: tuple[RepeatedProfileGroup, ...] = (
    RepeatedProfileGroup(
        key="education",
        label="教育经历补充",
        family="education",
        fields=(
            _field("education_class_rank", "班级排名"),
            _field("education_major_rank", "专业排名名次"),
            _field("education_rank_total", "专业排名总人数"),
            _field("education_gpa_scale", "GPA满分基数"),
            _field("education_school_location", "学校所在地"),
            _field("education_campus", "校区"),
            _field("education_is_overseas", "是否境外教育", "select", options=("是", "否")),
            _field("education_is_unified_recruitment", "是否统招", "select", options=("是", "否")),
            _field("education_is_highest", "是否最高学历", "select", options=("是", "否")),
            _field("education_is_minor", "是否辅修", "select", options=("是", "否")),
            _field("education_special_notes", "教育经历特殊情况说明", "longtext"),
        ),
    ),
    RepeatedProfileGroup(
        key="experience",
        label="实习和工作补充",
        family="experience",
        fields=(
            _field("experience_department", "所在部门"),
            _field("experience_work_type", "工作性质"),
            _field("experience_location", "工作地点"),
            _field("experience_industry", "所在行业"),
            _field("experience_company_type", "公司类型"),
            _field("experience_annual_salary", "职位年薪"),
            _field("experience_min_expected_annual_salary", "最低期望年薪"),
            _field("experience_max_expected_annual_salary", "最高期望年薪"),
            _field("experience_achievements", "工作业绩和主要成就", "longtext"),
            _field("experience_leave_reason", "离职原因", "longtext"),
        ),
    ),
    RepeatedProfileGroup(
        key="project",
        label="项目经历补充",
        family="project",
        fields=(
            _field("project_link", "项目链接"),
            _field("project_additional_notes", "项目补充说明", "longtext"),
        ),
    ),
    RepeatedProfileGroup(
        key="campus",
        label="校园和社会实践补充",
        family="campus",
        fields=(
            _field("campus_practice_name", "实践名称"),
            _field("campus_location", "实践地点"),
            _field("campus_additional_notes", "实践补充说明", "longtext"),
        ),
    ),
    RepeatedProfileGroup(
        key="academic",
        label="学术成果",
        family="academic",
        fields=(
            _field("academic_paper_name", "论文名称"),
            _field("academic_publication", "发表渠道"),
            _field("academic_journal_level", "期刊等级"),
            _field("academic_author_order", "作者顺序"),
            _field("academic_impact_factor", "影响因子"),
            _field("academic_link", "论文链接"),
            _field("academic_book_name", "学术专著名称"),
            _field("academic_book_details", "学术专著资料", "longtext"),
        ),
    ),
    RepeatedProfileGroup(
        key="award",
        label="竞赛和获奖补充",
        family="award",
        fields=(
            _field("award_type", "获奖类型"),
            _field("award_competition", "获奖大赛"),
            _field("award_level", "获奖等级"),
            _field("award_rank", "获奖名次"),
            _field("award_scholarship_name", "奖学金名称"),
            _field("award_scholarship_level", "奖学金等级"),
            _field("award_scholarship_date", "奖学金获奖时间", "date"),
            _field("award_materials", "科研和竞赛获奖资料", "longtext"),
        ),
    ),
    RepeatedProfileGroup(
        key="language",
        label="语言能力补充",
        family="language",
        fields=(
            _field("language_name", "语种"),
            _field("language_level", "语言水平"),
            _field("language_speaking", "听说能力"),
            _field("language_reading", "读写能力"),
            _field("language_study_experience", "留学或生活经验", "longtext"),
        ),
    ),
    RepeatedProfileGroup(
        key="certificate",
        label="证书补充",
        family="certificate",
        fields=(
            _field("certificate_name", "证书名称"),
            _field("certificate_type", "证书类型"),
            _field("certificate_level", "证书等级"),
            _field("certificate_score", "证书成绩"),
            _field("certificate_issue_date", "发证日期", "date"),
            _field("certificate_expiry_date", "证书有效期", "date"),
            _field("certificate_exam_type", "英语考试类型"),
            _field("certificate_exam_score", "英语考试成绩"),
            _field("certificate_obtained_date", "英语证书获得时间", "date"),
        ),
    ),
    RepeatedProfileGroup(
        key="skill",
        label="技能补充",
        family="skill",
        fields=(
            _field("skill_category", "技能类别"),
            _field("skill_mastery", "技能掌握程度"),
            _field("skill_other", "其他技能", "longtext"),
        ),
    ),
    RepeatedProfileGroup(
        key="emergency_contact",
        label="紧急联系人",
        family="contact",
        fields=(
            _field("contact_name", "紧急联系人姓名", sensitive=True),
            _field("contact_relation", "与紧急联系人关系", sensitive=True),
            _field("contact_phone", "紧急联系人电话", "tel", sensitive=True),
        ),
    ),
)

REPEATED_PROFILE_GROUPS = tuple(
    replace(
        group,
        fields=group.fields + tuple(_from_spec(spec) for spec in GROUP_FIELD_ADDITIONS.get(group.key, ())),
    )
    for group in REPEATED_PROFILE_GROUPS
) + tuple(
    RepeatedProfileGroup(
        key=key, label=label, family=family, fields=tuple(_from_spec(spec) for spec in fields)
    )
    for key, label, family, fields in ADDITIONAL_GROUPS
)

REPEATED_PROFILE_GROUP_BY_KEY = {group.key: group for group in REPEATED_PROFILE_GROUPS}
REPEATED_PROFILE_FIELD_BY_KEY = {
    field.key: field for group in REPEATED_PROFILE_GROUPS for field in group.fields
}

# 这些映射会在 fields.py 中并入统一匹配目录。它们单独放在这里，避免继续把已经很长的
# 静态字段表和重复资料编辑结构混在同一个文件里。
REPEATED_FIELD_LABELS = {
    field.key: field.label for field in REPEATED_PROFILE_FIELD_BY_KEY.values()
}

REPEATED_FIELD_SYNONYMS: dict[str, tuple[str, ...]] = {
    "education_class_rank": ("班级排名", "班级名次"),
    "education_major_rank": ("专业排名名次", "专业排名"),
    "education_rank_total": ("专业排名总人数", "专业总人数", "排名总人数"),
    "education_gpa_scale": ("GPA满分", "绩点满分", "GPA满分基数"),
    "education_school_location": ("学校所在地", "就读地", "学校所在城市"),
    "education_campus": ("校区", "分校区"),
    "education_is_overseas": ("是否境外教育", "境外教育经历"),
    "education_is_unified_recruitment": ("是否统招", "统招"),
    "education_is_highest": ("是否最高学历", "最高学历"),
    "education_is_minor": ("是否辅修", "辅修经历"),
    "education_special_notes": ("教育经历特殊情况", "学历特殊情况", "特殊情况说明"),
    "experience_department": ("所在部门", "部门名称", "任职部门"),
    "experience_work_type": ("工作性质", "工作类型", "用工性质"),
    "experience_location": ("工作地点", "任职地点", "工作所在地"),
    "experience_industry": ("所在行业", "行业类别", "所属行业"),
    "experience_company_type": ("公司类型", "单位类型"),
    "experience_annual_salary": ("职位年薪", "任职年薪"),
    "experience_min_expected_annual_salary": ("最低期望年薪",),
    "experience_max_expected_annual_salary": ("最高期望年薪",),
    "experience_achievements": ("工作业绩", "主要成就", "工作成果"),
    "experience_leave_reason": ("离职原因", "离职理由"),
    "project_link": ("项目链接", "项目地址", "项目网址"),
    "project_additional_notes": ("项目补充说明", "项目补充信息"),
    "campus_practice_name": ("实践名称", "在校实践名称", "校园经历名称"),
    "campus_location": ("实践地点", "校园经历地点"),
    "campus_additional_notes": ("实践补充说明", "社会实践说明"),
    "academic_paper_name": ("论文名称", "论文题目", "学术论文"),
    "academic_publication": ("发表渠道", "会议期刊名称", "发表期刊"),
    "academic_journal_level": ("期刊等级", "期刊档位"),
    "academic_author_order": ("作者顺序", "作者排名"),
    "academic_impact_factor": ("影响因子",),
    "academic_link": ("论文链接", "论文网址"),
    "academic_book_name": ("学术专著名称", "专著名称"),
    "academic_book_details": ("学术专著资料", "专著资料"),
    "award_type": ("获奖类型", "奖项类别"),
    "award_competition": ("获奖大赛", "竞赛名称"),
    "award_level": ("获奖等级", "奖项等级", "大赛成绩"),
    "award_rank": ("获奖名次", "名次"),
    "award_scholarship_name": ("奖学金名称",),
    "award_scholarship_level": ("奖学金等级",),
    "award_scholarship_date": ("奖学金获奖时间",),
    "award_materials": ("科研获奖资料", "竞赛获奖资料", "获奖资料"),
    "language_name": ("语言类型", "语种", "外语种类"),
    "language_level": ("语言水平", "语言等级", "掌握程度"),
    "language_speaking": ("听说能力", "口语能力"),
    "language_reading": ("读写能力", "读写水平"),
    "language_study_experience": ("留学经验", "生活经验", "留学或生活经验"),
    "certificate_name": ("证书名称", "相关证书", "等级证书"),
    "certificate_type": ("证书类型", "证书类别"),
    "certificate_level": ("证书等级", "证书级别"),
    "certificate_score": ("证书成绩",),
    "certificate_issue_date": ("发证日期", "证书获得日期"),
    "certificate_expiry_date": ("证书有效期", "有效期"),
    "certificate_exam_type": ("英语考试类型", "考试类型", "英语等级"),
    "certificate_exam_score": ("英语考试成绩", "英语分数"),
    "certificate_obtained_date": ("英语证书获得时间", "英语证书日期"),
    "skill_category": ("技能类别", "技能分类"),
    "skill_mastery": ("技能掌握程度", "熟练程度", "技能水平"),
    "skill_other": ("其他技能", "其他能力"),
    "contact_name": ("紧急联系人姓名", "紧急联系人"),
    "contact_relation": ("紧急联系人关系", "与本人关系", "联系人关系"),
    "contact_phone": ("紧急联系人电话", "紧急联系人手机", "紧急联系电话"),
}
REPEATED_FIELD_SYNONYMS.update(ADDITIONAL_SYNONYMS)

REPEATED_FIELD_BLOCK_HINTS = {
    field.key: group.label.replace("补充", "")
    for group in REPEATED_PROFILE_GROUPS
    for field in group.fields
}
REPEATED_FIELD_BLOCK_HINTS.update(
    {
        "contact_name": "紧急联系人",
        "contact_relation": "紧急联系人",
        "contact_phone": "紧急联系人",
    }
)

REPEATED_FIELD_PREFERRED_TYPES = {
    field.key: (field.kind,) for field in REPEATED_PROFILE_FIELD_BY_KEY.values() if field.kind != "text"
}


def group_for_key(group_key: str) -> RepeatedProfileGroup | None:
    """按稳定 key 查找重复资料组。"""
    return REPEATED_PROFILE_GROUP_BY_KEY.get(group_key)


__all__ = [
    "REPEATED_FIELD_BLOCK_HINTS",
    "REPEATED_FIELD_LABELS",
    "REPEATED_FIELD_PREFERRED_TYPES",
    "REPEATED_FIELD_SYNONYMS",
    "REPEATED_PROFILE_GROUPS",
    "REPEATED_PROFILE_GROUP_BY_KEY",
    "REPEATED_PROFILE_FIELD_BY_KEY",
    "RepeatedProfileField",
    "RepeatedProfileGroup",
    "group_for_key",
]
