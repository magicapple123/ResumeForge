"""把用户资料整理成"可以直接往表单里填"的扁平字段字典。

与 ``services/apply/_queue.py::build_apply_data`` 是**超集**关系：那个只取投递必需的
6 个展示字段（BOSS 那条链路只用得到它们），这里要覆盖网申表单的全部常见项。
两者**刻意各自独立**——投递链路的取数口径不该被网申的需求牵着走，反之亦然。

日期一律按资料里的字符串原样带出，格式化交给 ``matching.format_date``（它知道目标控件
是 ``date`` 还是 ``month``）。
"""
from __future__ import annotations

import unicodedata
from typing import Any, Sequence

from sqlalchemy.orm import Session

from ...models.profile import Education
from ...models.web_form_profile import CUSTOM_KEY_PREFIX
from . import extra_profile
from .extra_profile import list_entries
from .fields import FORM_FIELDS, SOURCE_EXTRA
from .repeated_fields import field_key_for_block
from ..profile.profile_service import get_profile_detail

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
    return {key: value.strip() for key, value in data.items() if (value or "").strip()}


def _combine_profile_and_extra_data(
    db: Session, *, job_title: str, reusable_only: bool
) -> dict[str, str]:
    """合并简历资料与网申资料；由调用方明确选择是否过滤「本次」档位。"""
    profile_data = profile_to_form_data(get_profile_detail(db), job_title=job_title)
    return {**profile_data, **list_entries(db, reusable_only=reusable_only)}


def build_form_data(db: Session, *, job_title: str = "") -> dict[str, str]:
    """读取整页批量预填使用的资料，并排除只供本次使用的值。

    简历资料（``UserProfile``）与**网申资料**（``web_form_profile_entry``）在这里合并：
    后者是用户专门为网申填的补充项（四六级分数、档案所在地、紧急联系人…），**简历里没有**。
    ``reuse="once"`` 的内推码、某家的申请编号等只记不进入批量预填。

    ⚠️ **这条合并只发生在网申填表取数中**。简历生成读的是 ``get_profile_detail()`` →
    ``UserProfile``，完全不经过本函数——所以"生成简历不读网申资料"是结构保证的，不靠约定。
    """
    return _combine_profile_and_extra_data(db, job_title=job_title, reusable_only=True)


def build_live_form_data(db: Session, *, job_title: str = "") -> dict[str, str]:
    """读取「点哪个填哪个」的实时资料，包括档位为「本次」的已保存字段。

    这些值只作为当前输入框的建议；实时面板仍要求用户明确点击「填入」，不会自动写入页面。
    整页批量预填继续使用 ``build_form_data()``，不受此路径影响。
    """
    data = _combine_profile_and_extra_data(db, job_title=job_title, reusable_only=False)
    return _with_unique_custom_label_values(db, data)


def _normalize_field_label(label: str) -> str:
    """忽略标签中的空白与标点，同时统一全角字符和拉丁字母大小写。"""
    compatible = unicodedata.normalize("NFKC", label)
    folded = unicodedata.normalize("NFKC", compatible.casefold())
    return "".join(char for char in folded if char.isalnum())


def _with_unique_custom_label_values(
    db: Session, data: dict[str, str]
) -> dict[str, str]:
    """仅为实时逐框建议，把唯一精确匹配的自定义标签映射到预设网申字段。

    AI/规则仍负责识别页面字段；这里仅解决识别结果已有规范键、而资料以同名自定义字段
    保存时取不到值的问题。歧义标签不猜，已有规范字段值优先，批量预填不走本函数。
    """
    details = extra_profile.list_details(db)
    custom_keys_by_label: dict[str, list[str]] = {}
    for key, detail in details.items():
        if not key.startswith(CUSTOM_KEY_PREFIX):
            continue
        normalized_label = _normalize_field_label(detail.get("label", ""))
        if normalized_label:
            custom_keys_by_label.setdefault(normalized_label, []).append(key)

    field_keys_by_label: dict[str, list[str]] = {}
    for field in FORM_FIELDS:
        if field.source != SOURCE_EXTRA:
            continue
        normalized_label = _normalize_field_label(field.label)
        if normalized_label:
            field_keys_by_label.setdefault(normalized_label, []).append(field.key)

    result = dict(data)
    for normalized_label, custom_keys in custom_keys_by_label.items():
        field_keys = field_keys_by_label.get(normalized_label, [])
        if len(custom_keys) != 1 or len(field_keys) != 1:
            continue

        field_key = field_keys[0]
        if (result.get(field_key) or "").strip():
            continue
        value = (details[custom_keys[0]].get("value") or "").strip()
        if value:
            result[field_key] = value
    return result


# ===== 供"人工挑选"的完整清单 =====
#
# 与 ``profile_to_form_data`` 的关键差别：那个是**给匹配器用的**（每个字段一个值，
# 教育/实习只取最近一条），这个是**给人挑的**——所以子表要**逐条列出**，否则用户
# 想填第二条实习经历时根本挑不到。
#
# 这也是"让用户自己选"这套办法能顺带解决多段经历的原因：不需要识别「添加」按钮、
# 不需要判断区块，第几条就是清单里的第几行。

# 子表 → (字段名, 中文标签) 的展开顺序。
_EDUCATION_FIELDS: tuple[tuple[str, str], ...] = (
    ("school", "学校"),
    ("department", "院系"),
    ("major", "专业"),
    ("degree", "学历"),
    ("study_mode", "学习形式"),
    ("degree_type", "学位"),
    ("start_date", "入学时间"),
    ("end_date", "毕业时间"),
    ("gpa", "绩点/排名"),
    ("cet4_score", "英语四级分数"),
    ("cet6_score", "英语六级分数"),
    ("courses", "核心课程"),
    ("achievements", "在校成果"),
)
_EXPERIENCE_FIELDS: tuple[tuple[str, str], ...] = (
    ("company", "实习单位"),
    ("role", "实习职位"),
    ("start_date", "开始时间"),
    ("end_date", "结束时间"),
    ("description", "工作内容"),
)
_PROJECT_FIELDS: tuple[tuple[str, str], ...] = (
    ("name", "项目名称"),
    ("role", "担任角色"),
    ("start_date", "开始时间"),
    ("end_date", "结束时间"),
    ("tech_stack", "技术栈 / 工具 / 方法"),
    ("description", "项目描述"),
    ("highlights", "亮点 / 成果"),
)
_CAMPUS_FIELDS: tuple[tuple[str, str], ...] = (
    ("organization", "组织 / 部门"),
    ("role", "职务 / 角色"),
    ("start_date", "开始时间"),
    ("end_date", "结束时间"),
    ("description", "经历描述"),
)
_SKILL_FIELDS: tuple[tuple[str, str], ...] = (
    ("name", "技能"),
    ("level", "熟练程度"),
)
_AWARD_FIELDS: tuple[tuple[str, str], ...] = (
    ("name", "奖项名称"),
    ("date", "获奖时间"),
    ("description", "奖项说明"),
)

# **目录里**这些字段取自子表、但用的是扁平键名（匹配器要"每个字段一个值"）。在给人挑的
# 清单里它们由按条分组覆盖，所以跳过——否则同一个值会出现两次。
#
# ⚠️ 这里是**手写列举目录键名**，不是从子表列名推出来的。曾经想省事用子表列名生成，
# 结果 `project.name` / `award.name` 的列名 `name` 把目录里的「姓名」也一起排除了
# ——清单上直接少了姓名，而那种缺失一眼看不出来。
_MIRRORED_BY_RECORDS: frozenset[str] = frozenset(
    {
        "school",
        "department",
        "major",
        "degree",
        "study_mode",
        "degree_type",
        "gpa",
        "education_start",
        "education_end",
        "company",
        "job_title",
        "work_start",
        "work_end",
    }
)

_RECORD_GROUPS: tuple[tuple[str, str, tuple[tuple[str, str], ...]], ...] = (
    ("educations", "教育经历", _EDUCATION_FIELDS),
    ("experiences", "实习/工作", _EXPERIENCE_FIELDS),
    ("campus_experiences", "校园经历", _CAMPUS_FIELDS),
    ("projects", "项目经历", _PROJECT_FIELDS),
    ("skills", "专业技能", _SKILL_FIELDS),
    ("awards", "荣誉奖项", _AWARD_FIELDS),
)


def catalog_from_profile(profile: Any, *, job_title: str = "") -> list[dict[str, str]]:
    """把资料整理成一份**给人挑**的清单：``[{group, label, value}, ...]``。

    分区沿用字段目录的分组名（身份信息 / 联系方式 / 教育经历 / 其他），子表则按条分组
    （"教育经历 1"、"实习/工作 2"…）。空值不进清单——列一堆点不动的行没有意义。
    """
    entries: list[dict[str, str]] = []

    data = profile_to_form_data(profile, job_title=job_title)
    for spec in FORM_FIELDS:
        # 两类别在这里出现，它们由下面的**按条分组**覆盖：
        # - `derived`（"实习单位（第一条）"那种）；
        # - 取自子表但用了扁平字段名的（学校/专业/学历、最近实习单位…）——扁平那份只
        #   取了最近一条，而按条分组列的是全部。两份都放，用户会看到同一个值出现两次。
        if spec.derived or spec.key in _MIRRORED_BY_RECORDS:
            continue
        value = (data.get(spec.key) or "").strip()
        if value:
            # `key` 给「可能是这几个」排序用（`service.related_entries` 靠它取同义词表）。
            # 顺带说明：加它**不影响 `build_catalog` 那段去重**——`SOURCE_EXTRA` 与
            # `SOURCE_PROFILE` 的 key 集合按构造不相交。
            entries.append(
                {"group": spec.group, "label": spec.label, "value": value, "key": spec.key}
            )

    for attribute, group_name, fields in _RECORD_GROUPS:
        for index, record in enumerate(getattr(profile, attribute, []) or [], start=1):
            group = f"{group_name} {index}"
            for field_name, label in fields:
                value = str(getattr(record, field_name, "") or "").strip()
                if value:
                    # 子表字段的 key 直接用字段名（`school` / `company`…）：排序时靠它去
                    # `FIELD_SYNONYMS` 取同义词表，取不到才退回按标签比。
                    entries.append(
                        {"group": group, "label": label, "value": value, "key": field_name}
                    )

    # 长文本（工作内容、项目描述）压成一行：清单是给人扫的，多行会把一屏吃掉。
    for entry in entries:
        entry["value"] = _as_block_text(entry["value"])
    return entries


def build_catalog(db: Session, *, job_title: str = "") -> list[dict[str, str]]:
    """返回完整可挑选目录，并把已记住的网申字段也放进来。"""
    entries = catalog_from_profile(get_profile_detail(db), job_title=job_title)
    values = list_entries(db)
    details = extra_profile.list_details(db)
    known_keys = {entry.get("key", "") for entry in entries}

    for field in FORM_FIELDS:
        value = (values.get(field.key) or "").strip()
        if not value or field.key in known_keys:
            continue
        entries.append(
            {
                "group": field.group,
                "label": field.label,
                "value": _as_block_text(value),
                "key": field.key,
                "source": "extra",
            }
        )
        known_keys.add(field.key)

    custom_groups: list[str] = []
    for field in extra_profile.custom_fields_of(db, custom_groups):
        key = field["key"]
        value = (values.get(key) or "").strip()
        if not value or key in known_keys:
            continue
        entries.append(
            {
                "group": field["group"],
                "label": field["label"],
                "value": _as_block_text(value),
                "key": key,
                "source": "extra",
                "reuse": details.get(key, {}).get("reuse", "general"),
            }
        )
        known_keys.add(key)
    return entries


__all__ = [
    "DEGREE_RANK",
    "build_catalog",
    "catalog_from_profile",
    "build_form_data",
    "build_live_form_data",
    "education_rank",
    "pick_latest_experience",
    "pick_top_education",
    "profile_to_form_data",
]
