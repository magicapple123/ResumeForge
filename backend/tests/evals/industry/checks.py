# SPDX-License-Identifier: Apache-2.0
"""24 个跨行业案例的确定性检查（计划 §9.4：不调模型，全部可复现）。

四条检查分别回答四个问题：

1. 'fact_retention'：补充事实进入**候选上下文**后，九类事实是否全部保留、
   作者/发明人顺序与 is_self 是否原样、状态是否原样、私密证号是否被剔除？
   全程调用生产 'services.profile.fact_context.prompt_sections'。
2. 'candidate_paths'：general 与 targeted 两条**生产候选路径**
   （'build_general_profile_context' / 'build_targeted_profile_context'）是否都
   携带案例事实，且证号不进入候选 JSON？事实不参与相关性排序（契约 §3.3），
   所以两份候选里都应能找到每条事实的身份文本。
3. 'simulated_pipeline'：把案例事实+资料构造成一份"完美模型输出"，走生产
   'coerce_resume' → 断言无字段丢失（含 credentials / publications /
   research_projects / patents / 项目 public_url / 经历 experience_kind），再走
   生产 'revise_resume'（fake provider 回显同一 JSON + 改 summary）→ 断言科研/
   证照字段、状态、作者顺序与稳定 id 保留，证号不进提示词。
4. 'rule_negative'：对每份案例构造故意出错的输出，断言**既有**规则能捕获
   （事实新增 / 职责夸大 / 注入透传 / 隐私联系方式 + 生产覆盖度检查的遗漏检测），
   并如实记录现有规则捕获不到的两类缺口（状态升级、证号格式泄露）——报告里列明，
   不用 xfail 掩盖。若哪天生产补上了检查，这里的守卫断言会变红，提醒把缺口改为
   caught（见 'KNOWN_RULE_GAPS'）。

失败一律抛 :class:'CaseCheckError'（含案例 id 与检查名）；'run_case' 把四个检查
聚合成可 JSON 化的结果，供 'report.summarize_industry' 输出 available/executed/
skipped 与失败明细（A4 退出口径：executed == 24）。
"""
from __future__ import annotations

import asyncio
import hashlib
import inspect
import json
import re
from collections.abc import Callable
from copy import deepcopy
from types import SimpleNamespace
from typing import Any
from urllib.parse import urlsplit

import checks as rule_checks
from app.schemas.job import JobOut
from app.schemas.profile import (
    AwardOut,
    CampusExperienceOut,
    EducationOut,
    ExperienceOut,
    ProfileOut,
    ProjectOut,
    SkillOut,
)
from app.schemas.resume import ResumeContent
from app.services.profile import profile_relevance
from app.services.profile.fact_context import ProfileFactContext, prompt_sections
from app.services.profile.fact_mapping import (
    FACT_SECTION_BY_KIND,
    FACT_SECTION_KEYS,
    map_fact_payload,
)
from app.services.profile.profile_context import split_commas, split_lines
from app.services.profile.profile_relevance import (
    build_general_profile_context,
    build_targeted_profile_context,
)
from app.services.resume import document_identity, resume_coverage
from app.services.resume.resume_content import coerce_resume
from app.services.resume.resume_revision import revise_resume
from sample_schema import SyntheticClaim

from .case_schema import (
    FACT_IDENTITY_FIELDS,
    IndustryCase,
    fact_identity,
)

CHECK_FACT_RETENTION = "fact_retention"
CHECK_CANDIDATE_PATHS = "candidate_paths"
CHECK_SIMULATED_PIPELINE = "simulated_pipeline"
CHECK_RULE_NEGATIVE = "rule_negative"
CHECK_ORDER: tuple[str, ...] = (
    CHECK_FACT_RETENTION,
    CHECK_CANDIDATE_PATHS,
    CHECK_SIMULATED_PIPELINE,
    CHECK_RULE_NEGATIVE,
)

# 现有规则捕获不到的两类缺口：如实记录、进报告，不用 xfail 掩盖。
KNOWN_RULE_GAPS: dict[str, str] = {
    "status_upgrade": (
        "现有 8 条 evals 规则与生成链路都没有'论文/专利/证照状态升级'检查器："
        "事实锁（fact_locks）只作用于已有简历的 AI 改写，不覆盖生成输出；"
        "coerce_resume 接受 published/granted/active 等合法枚举，不会拦截升级。"
    ),
    "credential_number_leak": (
        "evals privacy_leak 与 privacy.SENSITIVE_PATTERNS 只识别手机/身份证/银行卡/"
        "邮箱；证号没有统一格式，正文里出现证号不会被确定性拦截。"
        "候选上下文已由 fact_mapping 剔除证号（fact_retention 断言），但输出侧无扫描器。"
    ),
}
# 集成缺口：探测生产代码是否已接上，接上后自动从缺口清单消失（报告随之更新）。
KNOWN_INTEGRATION_GAPS: dict[str, str] = {
    "credentials_identity_restore": (
        "document_identity.POINT_FIELDS 未登记 credentials：修订时模型不回显 id 会"
        "丢掉证照条目的稳定 id（论文/专利/项目/经历均已登记）。"
    ),
    "new_sections_coverage": (
        "resume_coverage._SECTION_MAP 只覆盖旧五栏：论文/科研项目/专利/证照没写进"
        "简历时不会出现在'没写入的内容'说明里。"
    ),
    "new_sections_entry_names": (
        "coverage 检查已登记新栏目，但 collect_entry_names（profile_relevance）只收集"
        "旧五栏的身份名：新栏目的入口清单为空，遗漏仍会被静默跳过（需要 be-facts 侧补齐）。"
    ),
}

_OBJECT_ID_PREFIX = {
    "education": "edu",
    "experience": "exp",
    "campus_experience": "cam",
    "projects": "pro",
    "skills": "ski",
    "awards": "awd",
    "publications": "pub",
    "research_projects": "res",
    "patents": "pat",
    "credentials": "cre",
}
# 简历字段 ↔ 候选资料分区 ↔ 身份字段（覆盖度检查的同一张表，不另写一份）。
# 新栏目（论文/科研项目/专利/证照）排在前面：生产 coverage 已登记它们时，
# 遗漏负例优先证明"新栏目少写一条也会被看见"；entry_names 尚未喂入新栏目时
# 自然回落到旧五栏（缺口由 detect_integration_gaps 记录）。
_ENTRY_SECTIONS: tuple[tuple[str, str, str], ...] = (
    ("publications", "publications", "title"),
    ("research_projects", "research_projects", "name"),
    ("patents", "patents", "title"),
    ("credentials", "credentials", "name"),
    ("projects", "projects", "name"),
    ("experience", "experiences", "company"),
    ("campus_experience", "campus_experiences", "organization"),
    ("awards", "awards", "name"),
    ("education", "educations", "school"),
)
# 合并进既有栏目的补充事实 → (候选 data section, 身份字段)。
# 九类里 work_project/practice/award/training/language 走这条；其余独立 section 用
# 生产 FACT_SECTION_BY_KIND + FACT_IDENTITY_FIELDS 定位。
MERGED_FACT_SECTIONS: dict[str, tuple[str, str]] = {
    "work_project": ("projects", "name"),
    "practice": ("experiences", "company"),
    "award": ("awards", "name"),
    "training": ("projects", "name"),
    "language": ("skills", "name"),
}

_PERSONAL_SECTIONS = (
    "education",
    "experience",
    "campus_experience",
    "projects",
    "skills",
    "awards",
    "publications",
    "research_projects",
    "patents",
    "credentials",
)


class CaseCheckError(AssertionError):
    """一条案例检查失败：带上案例 id / 检查名，报告可定位到具体案例。"""

    def __init__(self, case_id: str, check: str, message: str) -> None:
        super().__init__(f"[{case_id}][{check}] {message}")
        self.case_id = case_id
        self.check = check
        self.detail = message


def _require(condition: Any, case: IndustryCase | None, check: str, message: str) -> None:
    if not condition:
        raise CaseCheckError(case.id if case else "<unknown>", check, message)


# ===== 确定性构造：资料/事实 → 生产数据结构 =====


def _stable_id(prefix: str, *parts: object) -> str:
    digest = hashlib.sha1(":".join(str(part) for part in parts).encode("utf-8")).hexdigest()[:12]
    return f"{prefix}_{digest}"


def _profile_out(case: IndustryCase) -> ProfileOut:
    """ProfileUpdate → ProfileOut（读取模型需要 id；其余字段逐字保留）。"""
    data = case.profile.model_dump(mode="json")
    data["id"] = 1
    data["updated_at"] = None
    out_lists: tuple[tuple[str, type], ...] = (
        ("educations", EducationOut),
        ("experiences", ExperienceOut),
        ("campus_experiences", CampusExperienceOut),
        ("projects", ProjectOut),
        ("skills", SkillOut),
        ("awards", AwardOut),
    )
    for section, model in out_lists:
        data[section] = [
            model.model_validate({**item, "id": index + 1})
            for index, item in enumerate(data.get(section) or [])
        ]
    return ProfileOut.model_validate(data)


def _job_out(case: IndustryCase) -> JobOut:
    return JobOut.model_validate(
        {
            "id": 1,
            "title": case.job.title,
            "company": case.job.company,
            "description": case.job.jd,
            "created_at": "2026-01-01T00:00:00",
            "updated_at": "2026-01-01T00:00:00",
        }
    )


def _fact_items(case: IndustryCase) -> list[dict[str, Any]]:
    return [
        {
            "fact_id": _stable_id("fct", case.id, index),
            "kind": fact.kind,
            "revision": 1,
            "payload": deepcopy(fact.payload),
        }
        for index, fact in enumerate(case.facts)
    ]


def _fact_context(case: IndustryCase) -> ProfileFactContext:
    return ProfileFactContext(items=_fact_items(case))


def _perfect_payload(case: IndustryCase, *, include_ids: bool) -> dict[str, Any]:
    """用案例资料+事实构造成一份"完美模型输出"（生产 ResumeContent 的字段名）。"""
    profile = case.profile
    payload: dict[str, Any] = {
        "name": profile.name,
        "gender": profile.gender,
        "birth_year": profile.birth_year,
        "phone": profile.phone,
        "email": profile.email,
        "city": profile.city,
        "personal_website": profile.personal_website,
        "github": profile.github,
        "job_intent": profile.job_intent or case.job.title,
        "summary": profile.summary,
        "education": [
            {
                "school": item.school,
                "major": item.major,
                "degree": item.degree,
                "start_date": item.start_date,
                "end_date": item.end_date,
                "gpa": item.gpa,
                "courses": split_lines(item.courses),
                "achievements": split_lines(item.achievements),
            }
            for item in profile.educations
        ],
        "experience": [
            {
                "company": item.company,
                "role": item.role,
                "start_date": item.start_date,
                "end_date": item.end_date,
                "description": split_lines(item.description),
            }
            for item in profile.experiences
        ],
        "campus_experience": [
            {
                "organization": item.organization,
                "role": item.role,
                "start_date": item.start_date,
                "end_date": item.end_date,
                "description": split_lines(item.description),
            }
            for item in profile.campus_experiences
        ],
        "projects": [
            {
                "name": item.name,
                "role": item.role,
                "start_date": item.start_date,
                "end_date": item.end_date,
                "tech_stack": split_commas(item.tech_stack),
                "description": split_lines(item.description),
                "highlights": split_lines(item.highlights),
            }
            for item in profile.projects
        ],
        "skills": [{"name": item.name, "level": item.level} for item in profile.skills],
        "awards": [
            {"name": item.name, "date": item.date, "description": item.description}
            for item in profile.awards
        ],
    }
    for fact in case.facts:
        mapped = map_fact_payload(fact.kind, fact.payload)
        if mapped is None:  # pragma: no cover - schema 已限定九类
            continue
        if fact.kind == "publication":
            payload.setdefault("publications", []).append(mapped)
        elif fact.kind == "research_project":
            payload.setdefault("research_projects", []).append(mapped)
        elif fact.kind == "patent":
            payload.setdefault("patents", []).append(mapped)
        elif fact.kind == "credential":
            payload.setdefault("credentials", []).append(mapped)
        elif fact.kind == "work_project":
            payload.setdefault("projects", []).append(mapped)
        elif fact.kind == "practice":
            payload.setdefault("experience", []).append(mapped)
        elif fact.kind == "award":
            payload.setdefault("awards", []).append(mapped)
        elif fact.kind == "training":
            payload.setdefault("projects", []).append(mapped)
        elif fact.kind == "language":
            # 语言能力在候选里是 skills 条目；ResumeSkill 没有 custom_fields，
            # 这里按生产字段口径收口（保持"完美输出"可直接被 ResumeContent 校验）。
            payload.setdefault("skills", []).append(
                {key: value for key, value in mapped.items() if key != "custom_fields"}
            )
    if include_ids:
        for section in _PERSONAL_SECTIONS:
            for index, entry in enumerate(payload.get(section) or []):
                entry["id"] = _stable_id(_OBJECT_ID_PREFIX[section], case.id, section, index)
    return payload


def _resume_text(resume: ResumeContent) -> str:
    return json.dumps(resume.model_dump(mode="json"), ensure_ascii=False)


def _assert_private_number_absent(case: IndustryCase, check: str, text: str, where: str) -> None:
    number = case.expected.credential_number
    _require(
        bool(number) and number not in text,
        case,
        check,
        f"私密证号 {number!r} 出现在 {where}（证号不得进候选/提示词/纸面/输出）",
    )


def _find_entry(entries: list[Any] | None, identity_field: str, identity: str):
    for entry in entries or []:
        value = entry.get(identity_field) if isinstance(entry, dict) else getattr(entry, identity_field, "")
        if str(value or "").strip() == identity:
            return entry
    return None


def _authors_dump(payload: dict[str, Any], field_name: str) -> list[dict[str, Any]]:
    return [
        {
            "name": person.get("name", ""),
            "is_self": bool(person.get("is_self", False)),
            "corresponding": bool(person.get("corresponding", False)),
        }
        for person in payload.get(field_name) or []
    ]


# ===== 1. fact_retention =====


def check_fact_retention(case: IndustryCase) -> dict[str, Any]:
    """候选上下文（生产 prompt_sections）必须完整保留九类事实与私密边界。"""
    check = CHECK_FACT_RETENTION
    sections = prompt_sections(_fact_context(case))
    _require(
        list(sections.keys()) == list(FACT_SECTION_KEYS),
        case,
        check,
        f"候选 section 必须恰好是九类：{list(sections.keys())}",
    )
    for fact in case.facts:
        section = FACT_SECTION_BY_KIND[fact.kind]
        mapped = map_fact_payload(fact.kind, fact.payload)
        _require(
            mapped in sections[section],
            case,
            check,
            f"{fact.kind} 事实「{fact_identity(fact.kind, fact.payload)}」未保留在 {section}",
        )
        if fact.kind in ("publication", "patent"):
            field_name = "authors" if fact.kind == "publication" else "inventors"
            _require(
                mapped[field_name] == _authors_dump(fact.payload, field_name),
                case,
                check,
                f"{fact.kind} 的作者/发明人顺序或 is_self 标记被改动",
            )
            _require(
                mapped["status"] == fact.payload["status"],
                case,
                check,
                f"{fact.kind} 状态被改动：{mapped['status']} != {fact.payload['status']}",
            )
        if fact.kind == "credential":
            _require(
                "credential_number" not in mapped,
                case,
                check,
                "credential 候选字段里出现 credential_number（私密字段必须剔除）",
            )
            _require(
                mapped["status"] == fact.payload["status"],
                case,
                check,
                "credential 状态被改动",
            )
    for fact_kind, entries in sections.items():
        for entry in entries:
            for key, value in entry.items():
                if isinstance(value, str) and key in ("url", "verify_url", "public_url") and value:
                    _require(
                        value.lower().startswith(("http://", "https://")),
                        case,
                        check,
                        f"{fact_kind} 的链接字段 {key} 不是 http(s)：{value!r}",
                    )
    serialized = json.dumps(sections, ensure_ascii=False)
    _assert_private_number_absent(case, check, serialized, "候选上下文 JSON")
    return {
        "detail": f"九类候选 section 保留 {len(case.facts)} 条事实，证号未出现",
        "metrics": {
            "facts": len(case.facts),
            "sections": {key: len(value) for key, value in sections.items()},
        },
    }


# ===== 2. candidate_paths =====


def _candidate_assertions(
    case: IndustryCase,
    check: str,
    label: str,
    selection: Any,
    fact_sections: dict[str, list[dict[str, Any]]],
) -> None:
    data = selection.data
    serialized = selection.serialized
    for fact in case.facts:
        identity = fact_identity(fact.kind, fact.payload)
        if fact.kind in MERGED_FACT_SECTIONS:
            section, field_name = MERGED_FACT_SECTIONS[fact.kind]
        else:
            section = FACT_SECTION_BY_KIND[fact.kind]
            field_name = FACT_IDENTITY_FIELDS[fact.kind]
        entries = data.get(section) or []
        entry = _find_entry(entries, field_name, identity)
        _require(
            entry is not None,
            case,
            check,
            f"{label} 候选缺少 {fact.kind} 事实「{identity}」（section={section}）",
        )
        _require(
            identity in serialized,
            case,
            check,
            f"{label} 候选序列化文本缺少事实「{identity}」",
        )
    # 扩展字段：作品项目的 public_url/artifact_type、实践经历 experience_kind。
    for fact in case.facts:
        if fact.kind == "work_project":
            entry = _find_entry(data.get("projects") or [], "name", fact.payload["name"])
            _require(
                entry is not None and "public_url" in entry and "artifact_type" in entry,
                case,
                check,
                f"{label} 候选的作品项目缺 public_url/artifact_type",
            )
            if fact.payload.get("public_url"):
                _require(
                    entry["public_url"] == fact.payload["public_url"],
                    case,
                    check,
                    f"{label} 候选丢失作品项目 public_url",
                )
        if fact.kind == "practice":
            entry = _find_entry(data.get("experiences") or [], "company", fact.payload["organization"])
            _require(
                entry is not None and entry.get("experience_kind") == fact.payload["experience_kind"],
                case,
                check,
                f"{label} 候选丢失实践经历 experience_kind",
            )
        if fact.kind == "award":
            entry = _find_entry(data.get("awards") or [], "name", fact.payload["name"])
            _require(entry is not None, case, check, f"{label} 候选丢失荣誉奖项")
            _require(
                entry.get("date", "") == str(fact.payload.get("date") or ""),
                case,
                check,
                f"{label} 候选丢失荣誉奖项日期",
            )
        if fact.kind == "training":
            entry = _find_entry(data.get("projects") or [], "name", fact.payload["name"])
            _require(
                entry is not None and entry.get("artifact_type") == "培训",
                case,
                check,
                f"{label} 候选的训练事实缺 artifact_type=培训",
            )
        if fact.kind == "language":
            entry = _find_entry(data.get("skills") or [], "name", fact.payload["name"])
            _require(entry is not None, case, check, f"{label} 候选丢失语言能力")
            expected_level = map_fact_payload(fact.kind, fact.payload)["level"]
            _require(
                entry.get("level") == expected_level,
                case,
                check,
                f"{label} 候选丢失语言等级/证书信息",
            )
    # 旧资料条目也要在候选里（否则"新事实在了、旧资料被挤掉"同样是保真问题）。
    profile = case.profile
    for item in profile.experiences:
        _require(
            _find_entry(data.get("experiences") or [], "company", item.company) is not None,
            case,
            check,
            f"{label} 候选丢失资料经历「{item.company}」",
        )
    for item in profile.projects:
        _require(
            _find_entry(data.get("projects") or [], "name", item.name) is not None,
            case,
            check,
            f"{label} 候选丢失资料项目「{item.name}」",
        )
    for item in profile.educations:
        _require(
            _find_entry(data.get("educations") or [], "school", item.school) is not None,
            case,
            check,
            f"{label} 候选丢失教育经历「{item.school}」",
        )
    _assert_private_number_absent(case, check, serialized, f"{label} 候选序列化文本")
    _assert_private_number_absent(
        case, check, json.dumps(fact_sections, ensure_ascii=False), "事实 section"
    )


def check_candidate_paths(case: IndustryCase) -> dict[str, Any]:
    """general 与 targeted 两条生产候选路径都必须携带案例事实。"""
    check = CHECK_CANDIDATE_PATHS
    signature = inspect.signature(build_general_profile_context)
    _require(
        "fact_sections" in signature.parameters,
        case,
        check,
        "生产 build_general_profile_context 尚未接受 fact_sections（候选链路未接入补充事实）",
    )
    fact_sections = prompt_sections(_fact_context(case))
    profile = _profile_out(case)
    job = _job_out(case)
    general = build_general_profile_context(profile, fact_sections=fact_sections)
    targeted = build_targeted_profile_context(profile, job, fact_sections=fact_sections)
    _candidate_assertions(case, check, "general", general, fact_sections)
    _candidate_assertions(case, check, "targeted", targeted, fact_sections)
    kind_for_section = {
        "publications": "publication",
        "research_projects": "research_project",
        "patents": "patent",
        "credentials": "credential",
    }
    for section, kind in kind_for_section.items():
        if case.facts_of(kind):
            for label, selection in (("general", general), ("targeted", targeted)):
                _require(
                    section in selection.data,
                    case,
                    check,
                    f"{label} 候选 data 缺少事实 section {section}",
                )
    return {
        "detail": "general/targeted 均保留全部案例事实且无证号",
        "metrics": {
            "general_chars": len(general.serialized),
            "targeted_chars": len(targeted.serialized),
            "general_selected": general.selected_counts,
            "targeted_selected": targeted.selected_counts,
        },
        "gaps": [],
    }


# ===== 3. simulated_pipeline =====


def _extended_field_assertions(case: IndustryCase, check: str, resume: ResumeContent) -> None:
    dump = resume.model_dump(mode="json")
    for fact in case.facts:
        payload = fact.payload
        if fact.kind == "work_project":
            entry = _find_entry(dump.get("projects") or [], "name", payload["name"])
            _require(entry is not None, case, check, "coerce_resume 丢掉作品项目")
            _require(
                entry.get("public_url", "") == str(payload.get("public_url") or ""),
                case,
                check,
                "coerce_resume 丢掉作品项目 public_url",
            )
            _require(
                entry.get("artifact_type", "") == str(payload.get("artifact_type") or ""),
                case,
                check,
                "coerce_resume 丢掉作品项目 artifact_type",
            )
        elif fact.kind == "practice":
            entry = _find_entry(dump.get("experience") or [], "company", payload["organization"])
            _require(entry is not None, case, check, "coerce_resume 丢掉实践经历")
            _require(
                entry.get("experience_kind") == payload["experience_kind"],
                case,
                check,
                "coerce_resume 丢掉实践经历 experience_kind",
            )
        elif fact.kind in ("publication", "patent"):
            section = "publications" if fact.kind == "publication" else "patents"
            identity = fact_identity(fact.kind, payload)
            entry = _find_entry(dump.get(section) or [], "title", identity)
            _require(entry is not None, case, check, f"coerce_resume 丢掉 {fact.kind}")
            _require(
                entry.get("status") == payload["status"],
                case,
                check,
                f"{fact.kind} 状态在解析层被改动",
            )
        elif fact.kind == "credential":
            entry = _find_entry(dump.get("credentials") or [], "name", payload["name"])
            _require(entry is not None, case, check, "coerce_resume 丢掉资格证照")
            for key in ("issuer", "issue_date", "expiry_date", "status", "verify_url", "note"):
                _require(
                    entry.get(key, "") == str(payload.get(key, "")),
                    case,
                    check,
                    f"证照字段 {key} 在解析层被改动",
                )
        elif fact.kind == "award":
            entry = _find_entry(dump.get("awards") or [], "name", payload["name"])
            _require(entry is not None, case, check, "coerce_resume 丢掉荣誉奖项")
            _require(entry["date"] == payload["date"], case, check, "coerce_resume 改动荣誉日期")
        elif fact.kind == "training":
            entry = _find_entry(dump.get("projects") or [], "name", payload["name"])
            _require(entry is not None, case, check, "coerce_resume 丢掉培训事实")
            _require(
                entry.get("artifact_type") == "培训",
                case,
                check,
                "coerce_resume 丢掉培训事实的 artifact_type",
            )
        elif fact.kind == "language":
            entry = _find_entry(dump.get("skills") or [], "name", payload["name"])
            _require(entry is not None, case, check, "coerce_resume 丢掉语言能力")
            expected_level = map_fact_payload("language", payload)["level"]
            _require(
                entry.get("level") == expected_level,
                case,
                check,
                "coerce_resume 丢掉语言等级/证书信息",
            )
    _require(
        "credential_number" not in json.dumps(dump, ensure_ascii=False),
        case,
        check,
        "ResumeContent 输出里出现 credential_number（模型 schema 不该有该字段）",
    )


def _assert_fact_content_kept(case: IndustryCase, check: str, resume: ResumeContent) -> list[str]:
    """修订后：科研/证照/作品/实践字段与状态必须原样保留；返回集成缺口。"""
    gaps: list[str] = []
    dump = resume.model_dump(mode="json")
    for fact in case.facts:
        payload = fact.payload
        if fact.kind == "publication":
            entry = _find_entry(dump.get("publications") or [], "title", payload["title"])
            _require(entry is not None, case, check, "修订后丢失论文")
            _require(entry["status"] == payload["status"], case, check, "修订后论文状态被改动")
            _require(
                entry["authors"] == _authors_dump(payload, "authors"),
                case,
                check,
                "修订后论文作者顺序/is_self 被改动",
            )
        elif fact.kind == "research_project":
            entry = _find_entry(dump.get("research_projects") or [], "name", payload["name"])
            _require(entry is not None, case, check, "修订后丢失科研项目")
            for key in ("role", "organization", "funding", "description", "outcomes"):
                _require(
                    entry[key] == payload[key],
                    case,
                    check,
                    f"修订后科研项目字段 {key} 被改动",
                )
        elif fact.kind == "patent":
            entry = _find_entry(dump.get("patents") or [], "title", payload["title"])
            _require(entry is not None, case, check, "修订后丢失专利")
            _require(entry["status"] == payload["status"], case, check, "修订后专利状态被改动")
            _require(
                entry["patent_number"] == payload["patent_number"],
                case,
                check,
                "修订后专利号被改动",
            )
        elif fact.kind == "credential":
            entry = _find_entry(dump.get("credentials") or [], "name", payload["name"])
            _require(entry is not None, case, check, "修订后丢失资格证照")
            for key in ("status", "issuer", "verify_url"):
                _require(
                    entry.get(key, "") == str(payload.get(key, "")),
                    case,
                    check,
                    f"修订后证照字段 {key} 被改动",
                )
        elif fact.kind == "work_project":
            entry = _find_entry(dump.get("projects") or [], "name", payload["name"])
            _require(entry is not None, case, check, "修订后丢失作品项目")
            _require(
                entry.get("public_url", "") == str(payload.get("public_url") or ""),
                case,
                check,
                "修订后作品项目 public_url 丢失",
            )
        elif fact.kind == "practice":
            entry = _find_entry(dump.get("experience") or [], "company", payload["organization"])
            _require(entry is not None, case, check, "修订后丢失实践经历")
            _require(
                entry.get("experience_kind") == payload["experience_kind"],
                case,
                check,
                "修订后实践经历 experience_kind 丢失",
            )
        elif fact.kind == "award":
            entry = _find_entry(dump.get("awards") or [], "name", payload["name"])
            _require(entry is not None, case, check, "修订后丢失荣誉奖项")
            _require(entry["date"] == payload["date"], case, check, "修订后荣誉日期被改动")
        elif fact.kind == "training":
            entry = _find_entry(dump.get("projects") or [], "name", payload["name"])
            _require(entry is not None, case, check, "修订后丢失培训事实")
            _require(
                entry.get("artifact_type") == "培训",
                case,
                check,
                "修订后培训事实 artifact_type 丢失",
            )
        elif fact.kind == "language":
            entry = _find_entry(dump.get("skills") or [], "name", payload["name"])
            _require(entry is not None, case, check, "修订后丢失语言能力")
            expected_level = map_fact_payload("language", payload)["level"]
            _require(
                entry.get("level") == expected_level,
                case,
                check,
                "修订后语言等级/证书信息丢失",
            )
    # 稳定 id：模型不回显 id 时由 restore_entry_identity 按位置回填。
    for section in _PERSONAL_SECTIONS:
        entries = dump.get(section) or []
        if not entries:
            continue
        if section not in document_identity.ENTRY_FIELDS:
            gaps.append("credentials_identity_restore")
            continue
        for entry in entries:
            _require(
                entry.get("id"),
                case,
                check,
                f"修订后 {section} 条目的稳定 id 丢失（身份回填未生效）",
            )
    return gaps


class _EchoProvider:
    """fake provider：回显给定 JSON（模拟模型改写 summary、不回显 id）。"""

    def __init__(self, payload: dict[str, Any]) -> None:
        self.payload = payload
        self.prompt = ""

    async def chat(self, messages, *, thinking: bool = True):  # noqa: ANN001
        self.prompt = "\n".join(str(item.get("content", "")) for item in messages)
        return json.dumps(self.payload, ensure_ascii=False)


def check_simulated_pipeline(case: IndustryCase) -> dict[str, Any]:
    """完美输出 → coerce_resume → revise_resume，两个生产解析/修订入口都不许丢字段。"""
    check = CHECK_SIMULATED_PIPELINE
    payload = _perfect_payload(case, include_ids=True)
    expected = ResumeContent.model_validate(payload)
    resumed = coerce_resume(payload)
    _require(
        resumed.model_dump(mode="json") == expected.model_dump(mode="json"),
        case,
        check,
        "coerce_resume 解析后与输入 payload 不一致（存在字段丢失/改动）",
    )
    text = _resume_text(resumed)
    for term in case.expected.must_appear:
        _require(term in text, case, check, f"完美输出缺少 must_appear 关键词「{term}」")
    for term in case.expected.must_not_appear:
        _require(term not in text, case, check, f"完美输出出现 must_not_appear 关键词「{term}」")
    dump = resumed.model_dump(mode="json")
    for claim in case.expected.status_claims:
        section = {
            "publication": "publications",
            "patent": "patents",
            "credential": "credentials",
        }[claim.kind]
        field_name = FACT_IDENTITY_FIELDS[claim.kind]
        entry = _find_entry(dump.get(section) or [], field_name, claim.subject)
        _require(entry is not None, case, check, f"完美输出缺少状态事实「{claim.subject}」")
        _require(
            entry["status"] == claim.status,
            case,
            check,
            f"完美输出把状态「{claim.subject}」从 {claim.status} 改成 {entry['status']}",
        )
        _require(
            entry["status"] not in claim.upgraded_values,
            case,
            check,
            f"完美输出把状态「{claim.subject}」升级为 {entry['status']}",
        )
    _extended_field_assertions(case, check, resumed)

    revised_payload = _perfect_payload(case, include_ids=False)
    revised_payload["summary"] = "修订后的个人总结。"
    provider = _EchoProvider(revised_payload)
    revised = asyncio.run(revise_resume(provider, resumed, None, "把总结改得更精炼"))
    _require(revised.summary == "修订后的个人总结。", case, check, "修订没有应用 summary 改动")
    _assert_private_number_absent(case, check, provider.prompt, "修订提示词")
    _assert_private_number_absent(case, check, _resume_text(revised), "修订结果")
    gaps = _assert_fact_content_kept(case, check, revised)
    # G24：只有科研/证照/作品的简历不能被"空简历"保护误拦。
    _require(
        any(getattr(revised, section) for section in _PERSONAL_SECTIONS),
        case,
        check,
        "修订后简历被清空",
    )
    unknown_gaps = set(gaps) - set(KNOWN_INTEGRATION_GAPS)
    _require(not unknown_gaps, case, check, f"出现未登记的新集成缺口：{sorted(unknown_gaps)}")
    return {
        "detail": "coerce/revise 全字段保留（含科研/证照/扩展字段与稳定 id）",
        "metrics": {
            "sections": {section: len(getattr(resumed, section)) for section in _PERSONAL_SECTIONS},
            "revised_fields": len(case.facts),
        },
        "gaps": sorted(set(gaps)),
    }


# ===== 4. rule_negative =====


def _bridge_sample(case: IndustryCase) -> SimpleNamespace:
    """把案例映射成 evals 规则所需的最小样本形状（claims/JD/隐私占位/注入片段）。"""
    claims = []
    for fact in case.facts:
        identity = fact_identity(fact.kind, fact.payload)
        claims.append(
            SyntheticClaim(
                title=identity[:200],
                category="项目经历",
                subject=identity[:200],
                source_fact=json.dumps(fact.payload, ensure_ascii=False),
                responsibility_level="参与",
                key_terms=[identity] if len(identity) <= 200 else [],
            )
        )
    claims.append(
        SyntheticClaim(
            title="参与类事实",
            category="项目经历",
            subject=case.expected.must_appear[0][:200],
            source_fact="参与相关工作。",
            responsibility_level="参与",
            key_terms=[case.expected.must_appear[0]],
        )
    )
    placeholders = [value for value in (case.profile.phone, case.profile.email) if value]
    return SimpleNamespace(
        claims=claims,
        profile=case.profile,
        job_description=case.job.jd,
        injection_snippets=list(case.injection_phrases),
        privacy_placeholders=placeholders,
    )


def _rule_ids(findings: list[dict[str, Any]]) -> set[str]:
    return {finding["rule_id"] for finding in findings}


def _pick_fabricated_number(case: IndustryCase, sample: SimpleNamespace) -> str:
    allowed = rule_checks._extract_numbers(
        json.dumps([claim.source_fact for claim in sample.claims], ensure_ascii=False)
    ) | rule_checks._extract_numbers(case.profile.model_dump_json())
    for offset in range(1000):
        candidate = str(8_765_432_100 + offset)
        if not (rule_checks._extract_numbers(candidate) & allowed):
            return candidate
    raise CaseCheckError(case.id, CHECK_RULE_NEGATIVE, "找不到未在资料里出现的编造数字")


def _change_status(payload: dict[str, Any], claim) -> None:
    section = {
        "publication": "publications",
        "patent": "patents",
        "credential": "credentials",
    }[claim.kind]
    field_name = FACT_IDENTITY_FIELDS[claim.kind]
    for entry in payload.get(section) or []:
        if str(entry.get(field_name) or "").strip() == claim.subject:
            entry["status"] = claim.upgraded_values[0]
            return
    raise AssertionError(f"构造负例时找不到状态事实 {claim.subject}")


def _drop_one_resume_entry(
    case: IndustryCase, payload: dict[str, Any], entry_names: dict[str, tuple[str, ...]]
) -> tuple[str, str] | None:
    for resume_field, section, field_name in _ENTRY_SECTIONS:
        names = [str(name) for name in entry_names.get(section) or () if str(name)]
        entries = payload.get(resume_field) or []
        if not names or not entries:
            continue
        dropped = names[-1]
        payload[resume_field] = [
            entry for entry in entries if str(entry.get(field_name) or "").strip() != dropped
        ]
        return section, dropped
    return None


def check_rule_negative(case: IndustryCase) -> dict[str, Any]:
    """故意出错的输出必须被既有规则/生产覆盖度检查捕获；捕获不到的如实记缺口。"""
    check = CHECK_RULE_NEGATIVE
    payload = _perfect_payload(case, include_ids=False)
    perfect_text = json.dumps(payload, ensure_ascii=False)
    sample = _bridge_sample(case)
    clean = rule_checks.run_all_checks(sample, perfect_text)
    _require(
        clean == [],
        case,
        check,
        f"干净正文不应命中任何规则，实际命中：{sorted(_rule_ids(clean))}",
    )
    probes: list[dict[str, Any]] = []
    gaps: list[str] = []

    def _probe(probe_id: str, text: str, expected_rule: str) -> None:
        found = _rule_ids(rule_checks.run_all_checks(sample, text))
        _require(
            expected_rule in found,
            case,
            check,
            f"负例「{probe_id}」未被 {expected_rule} 捕获（命中：{sorted(found)}）",
        )
        probes.append({"id": probe_id, "caught": True, "caught_by": expected_rule})

    # 1) 编造数字（凭空指标不许写成自己的成果）
    bad = deepcopy(payload)
    number = _pick_fabricated_number(case, sample)
    bad["summary"] = f"{bad.get('summary') or ''}参与专项改进，累计节省 {number} 元。"
    _probe("fabricated_number", json.dumps(bad, ensure_ascii=False), rule_checks.RULE_FACT_ADDITION)

    # 2) 把"参与"写成"主导"（职责膨胀）
    bad = deepcopy(payload)
    subject = case.expected.must_appear[0]
    bad["summary"] = f"{bad.get('summary') or ''}主导{subject}，独立完成全部工作。"
    _probe(
        "responsibility_inflation",
        json.dumps(bad, ensure_ascii=False),
        rule_checks.RULE_RESPONSIBILITY_INFLATION,
    )

    # 3) 提示注入短语透传
    _probe(
        "prompt_injection",
        perfect_text + "\n" + case.injection_phrases[0],
        rule_checks.RULE_PROMPT_INJECTION_PASSTHROUGH,
    )

    # 4) 非占位联系方式泄露（隐私规则的正向证据）
    _probe(
        "contact_privacy",
        perfect_text + "\n联系电话 13912345678。",
        rule_checks.RULE_PRIVACY_LEAK,
    )

    # 5) 事实遗漏：用生产覆盖度检查证明"少写一条"会被看见
    fact_sections = prompt_sections(_fact_context(case))
    probe_profile = _profile_out(case)
    selection = build_general_profile_context(probe_profile, fact_sections=fact_sections)
    omission_payload = deepcopy(payload)
    dropped = _drop_one_resume_entry(case, omission_payload, selection.entry_names)
    if dropped is None:
        probes.append(
            {
                "id": "fact_omission",
                "caught": False,
                "caught_by": None,
                "not_applicable": "案例没有旧五栏条目（例如只有证照的极端稀疏资料），覆盖度检查无对象",
            }
        )
    else:
        section, dropped_name = dropped
        omitted_resume = ResumeContent.model_validate(omission_payload)
        details = resume_coverage.find_unwritten_details(
            omitted_resume, selection.entry_names, selection.data
        )
        _require(
            any(dropped_name in detail["names"] for detail in details),
            case,
            check,
            f"负例「fact_omission」未被生产覆盖度检查捕获（漏写「{dropped_name}」）",
        )
        probes.append(
            {
                "id": "fact_omission",
                "caught": True,
                "caught_by": "resume_coverage.find_unwritten_details",
                "section": section,
            }
        )

    # 6) 状态升级：现有规则捕获不到 → 如实记录缺口（守卫断言提醒未来补上）
    status_bad = deepcopy(payload)
    upgradable = [claim for claim in case.expected.status_claims if claim.upgraded_values]
    _require(
        bool(upgradable),
        case,
        check,
        "案例没有任何可升级状态事实，无法构造状态升级负例（每份案例应含非终态证照）",
    )
    claim = upgradable[0]
    _change_status(status_bad, claim)
    if claim.upgrade_wordings:
        # under_review → published / pending → granted / pending → active 的真实形态：
        # 枚举被改，同时正文写下"已发表/已授权/已取得"这类升级措辞。
        status_bad["summary"] = f"{status_bad.get('summary') or ''}{claim.upgrade_wordings[0]}。"
    status_text = json.dumps(status_bad, ensure_ascii=False)
    status_findings = _rule_ids(rule_checks.run_all_checks(sample, status_text))
    _require(
        not status_findings,
        case,
        check,
        f"状态升级负例被现有规则捕获（{sorted(status_findings)}）？"
        "说明已补上状态检查，请把本探针改为 caught 并更新 KNOWN_RULE_GAPS",
    )
    gaps.append("status_upgrade")
    probes.append(
        {
            "id": "status_upgrade",
            "caught": False,
            "caught_by": None,
            "gap": "status_upgrade",
            "detail": f"{claim.kind}「{claim.subject}」{claim.status}→{claim.upgraded_values[0]} 未被任何规则捕获",
            "current_rules_hit": sorted(status_findings),
        }
    )

    # 7) 证号格式泄露：隐私规则只认手机/身份证/邮箱 → 记录缺口（候选侧已由 fact_retention 挡住）
    credential_text = perfect_text + f"\n证号：{case.expected.credential_number}"
    credential_findings = _rule_ids(rule_checks.run_all_checks(sample, credential_text))
    _require(
        rule_checks.RULE_PRIVACY_LEAK not in credential_findings,
        case,
        check,
        "证号泄露负例被隐私规则捕获？说明已补上识别格式，请把本探针改为 caught 并更新 KNOWN_RULE_GAPS",
    )
    gaps.append("credential_number_leak")
    probes.append(
        {
            "id": "credential_number_leak",
            "caught": False,
            "caught_by": None,
            "gap": "credential_number_leak",
            "detail": "证号出现在正文时隐私规则不识别（无统一格式）",
            "current_rules_hit": sorted(credential_findings),
        }
    )

    unknown_gaps = set(gaps) - set(KNOWN_RULE_GAPS)
    _require(not unknown_gaps, case, check, f"出现未登记的新规则缺口：{sorted(unknown_gaps)}")
    applicable = [probe for probe in probes if not probe.get("not_applicable")]
    return {
        "detail": (
            f"负例检出 {sum(1 for probe in probes if probe['caught'])}/"
            f"{sum(1 for probe in applicable if probe['caught'])} 类可捕获错误全部命中，"
            f"已知缺口 {len(gaps)} 类（见报告）"
        ),
        "metrics": {"probes": probes},
        "gaps": sorted(set(gaps)),
    }


# ===== 执行与汇总 =====


_CHECK_FUNCS: tuple[tuple[str, Callable[[IndustryCase], dict[str, Any]]], ...] = (
    (CHECK_FACT_RETENTION, check_fact_retention),
    (CHECK_CANDIDATE_PATHS, check_candidate_paths),
    (CHECK_SIMULATED_PIPELINE, check_simulated_pipeline),
    (CHECK_RULE_NEGATIVE, check_rule_negative),
)


def detect_integration_gaps() -> dict[str, str]:
    """探测生产代码的集成现状；已接上的缺口自动消失（报告与断言都跟着更新）。"""
    gaps: dict[str, str] = {}
    if "credentials" not in document_identity.ENTRY_FIELDS:
        gaps["credentials_identity_restore"] = KNOWN_INTEGRATION_GAPS[
            "credentials_identity_restore"
        ]
    covered = {field for field, _section, _identity, _label in resume_coverage._SECTION_MAP}
    missing = {"publications", "research_projects", "patents", "credentials"} - covered
    if missing:
        gaps["new_sections_coverage"] = (
            f"{KNOWN_INTEGRATION_GAPS['new_sections_coverage']}"
            f"（缺：{'/'.join(sorted(missing))}）"
        )
    elif "publications" not in profile_relevance._IDENTITY_FIELDS:
        # coverage 已认新栏目，但生成候选的 entry_names 清单还没收集它们：
        # 新栏目"没写进简历"仍然不会被报告出来（跨 agent 集成缺口）。
        gaps["new_sections_entry_names"] = KNOWN_INTEGRATION_GAPS[
            "new_sections_entry_names"
        ]
    return gaps


def run_case(case: IndustryCase) -> dict[str, Any]:
    """逐份真实执行四条检查；任何检查失败都记进 findings（不跳过、不吞错）。"""
    result: dict[str, Any] = {
        "case_id": case.id,
        "industry_group": case.industry_group,
        "density": case.density,
        "persona": case.persona,
        "executed": True,
        "skipped": False,
        "skipped_reason": "",
        "checks": {},
        "findings": [],
        "gaps": [],
    }
    gap_ids: set[str] = set()
    for check_id, func in _CHECK_FUNCS:
        try:
            outcome = func(case)
        except CaseCheckError as exc:
            result["checks"][check_id] = {
                "passed": False,
                "detail": exc.detail,
                "gaps": [],
                "metrics": {},
            }
            result["findings"].append(f"{check_id}: {exc.detail}")
            continue
        gap_ids.update(outcome.get("gaps") or [])
        result["checks"][check_id] = {
            "passed": True,
            "detail": outcome.get("detail", ""),
            "gaps": outcome.get("gaps") or [],
            "metrics": outcome.get("metrics") or {},
        }
    result["gaps"] = sorted(gap_ids)
    result["integration_gaps"] = detect_integration_gaps()
    return result


def run_all_cases(cases: list[IndustryCase] | None = None) -> list[dict[str, Any]]:
    """执行全部 24 份案例；cases 显式传入便于测试构造负例。"""
    if cases is None:
        from .loader import load_cases

        cases = load_cases()
    return [run_case(case) for case in cases]


def executed_counts(results: list[dict[str, Any]]) -> dict[str, int]:
    available = len(results)
    executed = sum(1 for result in results if result.get("executed") and not result.get("skipped"))
    skipped = sum(1 for result in results if result.get("skipped"))
    failed = sum(1 for result in results if result.get("findings"))
    return {
        "available": available,
        "executed": executed,
        "skipped": skipped,
        "failed": failed,
    }


# ===== 纯虚构扫描（测试入口；不属于四条评测检查） =====

_ALLOWED_URL_HOST_SUFFIXES = (".example.com", ".example.org", ".example.net")
_URL_RE = re.compile(r"https?://[^\s\"'<>）)]+")
_CREDENTIAL_NUMBER_RE = re.compile(r"^CERT-[A-Z0-9-]{6,60}$")


def scan_fiction(case: IndustryCase, index: dict[str, Any]) -> dict[str, Any]:
    """钉住"纯虚构"：联系方式只允许保留占位、链接只用 example 域名、人员/机构在清单内。"""
    blob = json.dumps(case.model_dump(mode="json"), ensure_ascii=False)
    allow_phones = set(rule_checks.RESERVED_PHONES)
    for match in rule_checks._PHONE_RE.finditer(blob):
        if match.group() not in allow_phones:
            raise CaseCheckError(case.id, "fiction_scan", f"出现非保留占位手机号：{match.group()}")
    for match in rule_checks._ID_NUMBER_RE.finditer(blob):
        value = match.group()
        if not value.startswith(rule_checks.RESERVED_ID_PREFIX):
            raise CaseCheckError(case.id, "fiction_scan", f"出现非占位身份证号：{value}")
    for match in rule_checks._EMAIL_RE.finditer(blob):
        value = match.group().lower()
        if not value.endswith(rule_checks.RESERVED_EMAIL_DOMAIN):
            raise CaseCheckError(case.id, "fiction_scan", f"出现非 example.com 邮箱：{value}")
    for url in _URL_RE.findall(blob):
        host = (urlsplit(url).hostname or "").lower()
        allowed = host in {"example.com", "example.org", "example.net"} or host.endswith(
            _ALLOWED_URL_HOST_SUFFIXES
        )
        if not allowed:
            raise CaseCheckError(case.id, "fiction_scan", f"出现非 example 域名链接：{url}")
    unknown_names = case.person_names() - set(index.get("fictional_names") or [])
    _require(
        not unknown_names,
        case,
        "fiction_scan",
        f"出现未登记的姓名（疑似真实数据）：{sorted(unknown_names)}",
    )
    unknown_orgs = case.organization_names() - set(index.get("fictional_organizations") or [])
    _require(
        not unknown_orgs,
        case,
        "fiction_scan",
        f"出现未登记的机构（疑似真实数据）：{sorted(unknown_orgs)}",
    )
    number = case.expected.credential_number
    _require(
        bool(_CREDENTIAL_NUMBER_RE.match(number)),
        case,
        "fiction_scan",
        f"证号格式不像合成的保留样例：{number!r}",
    )
    return {
        "case_id": case.id,
        "phones": "reserved-only",
        "urls": "example-domains-only",
        "names": len(case.person_names()),
        "organizations": len(case.organization_names()),
    }


__all__ = [
    "CHECK_CANDIDATE_PATHS",
    "CHECK_FACT_RETENTION",
    "CHECK_ORDER",
    "CHECK_RULE_NEGATIVE",
    "CHECK_SIMULATED_PIPELINE",
    "CaseCheckError",
    "KNOWN_INTEGRATION_GAPS",
    "KNOWN_RULE_GAPS",
    "check_candidate_paths",
    "check_fact_retention",
    "check_rule_negative",
    "check_simulated_pipeline",
    "detect_integration_gaps",
    "executed_counts",
    "run_all_cases",
    "run_case",
    "scan_fiction",
]
