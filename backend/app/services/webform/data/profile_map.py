"""学历/经历挑选纯函数与 ``profile_to_form_data`` 扁平字段映射（职责①②）。

从 ``webform/data.py`` 拆出：挑记录用的纯函数，以及与 ``FORM_FIELDS``/守卫测试
成对存在的巨型扁平映射 ``profile_to_form_data``（整块保留，不拆 dict）。
"""

from __future__ import annotations

from typing import Any, Sequence

from ....models.profile import Education

from ..repeated_fields import field_key_for_block


# 学历层次排序：取"最高"那一条去填表。认不出的学历排最低，同级时按资料里的顺序。
DEGREE_RANK: dict[str, int] = {
    "博士": 4,
    "博士研究生": 4,
    "硕士": 3,
    "研究生": 3,
    "硕士研究生": 3,
    "本科": 2,
    "大学本科": 2,
    "大专": 1,
    "专科": 1,
    "高职": 1,
    "高中": 0,
}


def education_rank(education: Education) -> int:
    """这条教育经历的学历有多高（认不出按 -1，排在已知学历之后）。"""
    return DEGREE_RANK.get((education.degree or "").strip(), -1)


def pick_top_education(educations: Sequence[Education]) -> tuple[Education | None, int]:
    """选出要填进表单的那一条教育经历，并返回总数。

    网申表单的"教育经历"往往是**多条**。批量填充会按页面区块序号使用对应记录；
    没有序号的兼容字段仍选最高学历，避免用户先填本科、后补硕士时把最高学历填成本科。
    """
    items = list(educations)
    if not items:
        return None, 0
    best = max(items, key=lambda item: (education_rank(item), -item.id))
    return best, len(items)


def pick_latest_experience(experiences: Sequence[Any]) -> Any | None:
    """最近一段实习/工作。按结束时间倒序，空结束时间（"至今"）视为最新。"""
    return _latest_by_end_date(experiences)


def _latest_by_end_date(items: Sequence[Any]) -> Any | None:
    records = list(items)
    if not records:
        return None
    return max(records, key=lambda item: ((item.end_date or "9999"), -item.id))


def pick_latest_project(projects: Sequence[Any]) -> Any | None:
    """最近一个项目。"""
    return _latest_by_end_date(projects)


def pick_latest_award(awards: Sequence[Any]) -> Any | None:
    """最近一个奖项。``award`` 的日期列叫 ``date`` 而不是 ``end_date``。"""
    records = list(awards)
    if not records:
        return None
    return max(records, key=lambda item: ((item.date or "9999"), -item.id))


def _as_block_text(raw: str) -> str:
    """把换行分隔的多行文本压成一行。

    资料里的"工作内容""项目描述"是按行存的（一行一条），而网申区块里的描述框通常是
    一整段。换行原样塞进 ``<textarea>`` 也行，但预览表里会显示成一大片——压成
    分号分隔更便于核对。
    """
    lines = [line.strip() for line in (raw or "").splitlines() if line.strip()]
    return "；".join(lines)


def _first_record(records: Sequence[Any]) -> Any | None:
    """返回页面第一个重复区块对应的资料记录。

    页面上的序号是用户看到的顺序，不应被"最近一条"排序规则替换。最近记录仍由
    ``company`` / ``job_title`` 这类独立字段使用。
    """
    items = list(records)
    return items[0] if items else None


def _expand_repeated_records(
    data: dict[str, str],
    records: Sequence[Any],
    family: str,
    fields: Sequence[tuple[str, str]],
) -> None:
    """把子表的每一条记录展开成带区块序号的动态字段。"""
    for index, record in enumerate(records, start=1):
        for base_field, attribute in fields:
            value = getattr(record, attribute, "") or ""
            if attribute in {"description", "courses", "achievements"}:
                value = _as_block_text(str(value))
            key = field_key_for_block(base_field, family, index)
            if str(value).strip():
                data[key] = str(value).strip()


def profile_to_form_data(profile: Any, *, job_title: str = "") -> dict[str, str]:
    """把一份资料展开成扁平字段字典（纯函数，便于离线测试）。

    ``job_title`` 是可选的目标岗位名：有它时优先当作求职意向——比起资料里那句泛泛的
    "求职意向"，当前在投的这个岗位才是表单想要的答案。
    """
    education, _total = pick_top_education(profile.educations)
    experiences = list(profile.experiences or [])
    projects = list(profile.projects or [])
    skills = list(profile.skills or [])
    awards = list(profile.awards or [])
    educations = list(profile.educations or [])
    campus_experiences = list(getattr(profile, "campus_experiences", []) or [])
    experience = pick_latest_experience(experiences)
    first_experience = _first_record(experiences)
    first_project = _first_record(projects)
    first_award = _first_record(awards)

    data: dict[str, str] = {
        # ===== 身份 =====
        "name": profile.name,
        "gender": profile.gender,
        "birth_date": profile.birth_date,
        "birth_year": profile.birth_year or (profile.birth_date or "")[:4],
        "country_region": profile.country_region,
        "native_place": profile.native_place,
        "political_status": profile.political_status,
        "id_type": profile.id_type,
        "id_number": profile.id_number,
        # ===== 联系 =====
        "phone": profile.phone,
        "phone_country_code": profile.phone_country_code,
        "email": profile.email,
        "wechat": profile.wechat,
        "qq": profile.qq,
        "city": profile.city,
        "target_city": profile.target_city,
        # ===== 教育 =====
        "school": education.school if education else "",
        "department": education.department if education else "",
        "advisor": profile.advisor,
        "research_direction": profile.research_direction,
        "major": education.major if education else "",
        "degree": education.degree if education else "",
        "degree_type": education.degree_type if education else "",
        "study_mode": education.study_mode if education else "",
        "education_start": education.start_date if education else "",
        "education_end": education.end_date if education else "",
        "gpa": education.gpa if education else "",
        "courses": education.courses if education else "",
        "achievements": education.achievements if education else "",
        # 四六级分数跟着最高学历那一条走（与上面这些教育字段同源同规则）——
        # 它们是某段学历期间考出来的成绩，所以录在教育经历上而不是基本信息里。
        "cet4_score": education.cet4_score if education else "",
        "cet6_score": education.cet6_score if education else "",
        # ===== 其他 =====
        "job_intent": job_title or profile.job_intent,
        "preferred_industry": profile.preferred_industry,
        "salary": profile.expected_salary,
        "company": experience.company if experience else "",
        "job_title": experience.role if experience else "",
        "work_start": experience.start_date if experience else "",
        "work_end": experience.end_date if experience else "",
        "summary": profile.summary,
        "family_info": profile.family_info,
        "github": profile.github,
        "personal_website": profile.personal_website,
        # ===== 多段经历的无序号兼容字段 =====
        # 旧页面与旧调用方仍使用无序号 key；它们现在严格对应资料列表的第 1 条。
        # 最近一条仍由上面的 company/job_title/work_start/work_end 独立字段提供。
        #
        # 注意与上面 ``company``/``job_title``/``work_start``/``work_end`` 的关系：那几个是
        # 表单里**独立**的"最近实习单位"栏，这几个是**区块内**的同名栏。两者取值同源，
        # 但靠 ``FIELD_BLOCK_HINTS`` 落在不同的控件上，不会互相抢。
        "experience_company": first_experience.company if first_experience else "",
        "experience_role": first_experience.role if first_experience else "",
        "experience_start": first_experience.start_date if first_experience else "",
        "experience_end": first_experience.end_date if first_experience else "",
        "experience_description": _as_block_text(
            first_experience.description if first_experience else ""
        ),
        "project_name": first_project.name if first_project else "",
        "project_role": first_project.role if first_project else "",
        "project_start": first_project.start_date if first_project else "",
        "project_end": first_project.end_date if first_project else "",
        "project_description": _as_block_text(
            first_project.description if first_project else ""
        ),
        "project_tech_stack": first_project.tech_stack if first_project else "",
        "project_highlights": _as_block_text(
            first_project.highlights if first_project else ""
        ),
        "campus_organization": (
            campus_experiences[0].organization if campus_experiences else ""
        ),
        "campus_role": campus_experiences[0].role if campus_experiences else "",
        "campus_start": campus_experiences[0].start_date if campus_experiences else "",
        "campus_end": campus_experiences[0].end_date if campus_experiences else "",
        "campus_description": _as_block_text(
            campus_experiences[0].description if campus_experiences else ""
        ),
        "skill_name": skills[0].name if skills else "",
        "skill_mastery": skills[0].level if skills else "",
        "award_name": first_award.name if first_award else "",
        "award_date": first_award.date if first_award else "",
        "award_description": first_award.description if first_award else "",
    }

    _expand_repeated_records(
        data,
        educations,
        "education",
        (
            ("school", "school"),
            ("department", "department"),
            ("major", "major"),
            ("degree", "degree"),
            ("degree_type", "degree_type"),
            ("study_mode", "study_mode"),
            ("education_start", "start_date"),
            ("education_end", "end_date"),
            ("gpa", "gpa"),
            ("education_courses", "courses"),
            ("education_achievements", "achievements"),
            ("cet4_score", "cet4_score"),
            ("cet6_score", "cet6_score"),
        ),
    )
    _expand_repeated_records(
        data,
        experiences,
        "experience",
        (
            ("experience_company", "company"),
            ("experience_role", "role"),
            ("experience_start", "start_date"),
            ("experience_end", "end_date"),
            ("experience_description", "description"),
        ),
    )
    _expand_repeated_records(
        data,
        projects,
        "project",
        (
            ("project_name", "name"),
            ("project_role", "role"),
            ("project_start", "start_date"),
            ("project_end", "end_date"),
            ("project_description", "description"),
            ("project_tech_stack", "tech_stack"),
            ("project_highlights", "highlights"),
        ),
    )
    _expand_repeated_records(
        data,
        awards,
        "award",
        (
            ("award_name", "name"),
            ("award_date", "date"),
            ("award_description", "description"),
        ),
    )
    _expand_repeated_records(
        data,
        campus_experiences,
        "campus",
        (
            ("campus_organization", "organization"),
            ("campus_role", "role"),
            ("campus_start", "start_date"),
            ("campus_end", "end_date"),
            ("campus_description", "description"),
        ),
    )
    _expand_repeated_records(
        data,
        skills,
        "skill",
        (("skill_name", "name"), ("skill_mastery", "level")),
    )
    return {key: value.strip() for key, value in data.items() if (value or "").strip()}

