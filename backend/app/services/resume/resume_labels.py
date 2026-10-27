# SPDX-License-Identifier: Apache-2.0
"""纸面固定文案的唯一来源：简历语言包（小节标题 / 字段前缀 / 分隔符 / 括号）。

**为什么要有这个模块**：同一份简历的正文分区标题今天在四处独立渲染（服务端 PDF、
Word、HTML 模板、Markdown），每处各写一份中文字面量。一个字面量写错或漏改，就会
出现"预览是「个人总结」、PDF 里是「个人总结 」，另外两份又是别的"这类无法自证的差异。
所以纸面上印的字**只有这一份表**：渲染器一律 ``section_titles(language)`` /
``field_labels(language)`` 取走整张表，**渲染器不许自带文案，也不许自己写
``if language == "en-US"``**——那样"英文少一个标题"这类错误就只可能发生在本文件的
表里，而这里可以用逐语言的完整性测试钉住。

一条刻意的边界：语言**只影响纸面固定文案**，不翻译正文内容（用户写的句子、
项目描述一律原样输出），也不参与生成链路（LLM prompt 不看这个值）。

``zh-CN`` 那张表以历史输出为基线（含 ``实习/工作经历`` 里的半角斜杠与 ``、`` 分隔符），
**2026-10 的 R-70 改名是唯一一次有意的标题变更**：论文发表→学术成果、专利→知识产权、
资格证照→证书资质（英文同步），同批连同 golden 断言逐项审查更新；改名之外仍要求默认语言产物零变化。

取值收口只有 ``normalize_language`` 一处：未知值、空值、非字符串一律回落到
``zh-CN``，不抛异常——一份被外部工具改过的库不该让导出整条挂掉。
"""

from __future__ import annotations

from typing import Literal, get_args

# 支持的语言（BCP 47 风格，与 ``<html lang>``、antd locale 文件名 ``zh_CN`` 都能对上）。
# 只保留确实有完整文案表的语言：多一个取值就多一份必须逐字校对过的表。
#
# 这里同时给出字面量类型：``normalize_language`` 的"收口后一定落在集合内"是**返回值
# 的类型**，不是调用方的责任——否则每个读到 ``record.language`` 的地方都要自己 cast，
# 类型检查器也就没法替我们守这条不变式了。
#
# schemas 是叶子层、不能 import services（见 tests/test_import_direction.py），所以
# ``schemas.resume.ResumeLanguage`` 必然另有一份同值声明；两者是否逐字相同由
# ``tests/test_export_labels.py`` 的守卫钉住，改一处漏另一处会直接失败。
ResumeLanguage = Literal["zh-CN", "en-US"]
RESUME_LANGUAGES: tuple[ResumeLanguage, ...] = get_args(ResumeLanguage)

# 默认语言。也是"读不出值"时的回落值，见 ``normalize_language``。
DEFAULT_RESUME_LANGUAGE: ResumeLanguage = "zh-CN"

# 正文七个分区的标题。键与 ``resume_sections.DEFAULT_SECTION_ORDER`` 逐字一致，
# 顺序也按那里的默认顺序排列，方便逐行对照。
SECTION_TITLES: dict[str, dict[str, str]] = {
    "zh-CN": {
        "education": "教育经历",
        "experience": "实习/工作经历",
        "projects": "项目经历",
        "publications": "学术成果",
        "research_projects": "科研项目",
        "patents": "知识产权",
        "credentials": "证书资质",
        "skills": "专业技能",
        "languages": "语言能力",
        "campus_experience": "校园经历",
        "awards": "荣誉奖项",
        "summary": "个人总结",
    },
    "en-US": {
        "education": "Education",
        "experience": "Experience",
        "projects": "Projects",
        "publications": "Academic Achievements",
        "research_projects": "Research Projects",
        "patents": "Intellectual Property",
        "credentials": "Certifications & Qualifications",
        "skills": "Skills",
        "languages": "Languages",
        "campus_experience": "Campus Activities",
        "awards": "Honors & Awards",
        "summary": "Summary",
    },
}

# 页眉与条目里的字段前缀（"词"，不含冒号与值）。冒号与拼接由渲染器负责，
# 本次不做标点本地化：英文产物里仍是 ``Objective：…``（全角冒号），属已知限制。
FIELD_LABELS: dict[str, dict[str, str]] = {
    "zh-CN": {
        "intent": "求职意向",
        "github": "GitHub",
        "website": "个人主页",
        "gpa": "绩点/排名",
        "courses": "核心课程",
        "tech_stack": "技术栈/工具",
        "photo_alt": "个人照片",
        # W14 科研栏目的字段前缀（中英两表同批，渲染器只取这份）。
        "doi": "DOI",
        "funding": "经费",
        "filed": "申请",
        "granted": "授权",
        # A4 扩展栏目的字段前缀（中英两表同批，渲染器只取这份）。
        "issuer": "颁发机构",
        "issued": "签发",
        "expiry": "到期",
        "verify": "核验链接",
        "artifact_type": "成果类型",
        "experience_kind": "工作类型",
        # F8（R-81）：资料页小字段 → 简历条目可选字段的纸面前缀。
        # 注意 issuer/artifact_type/experience_kind/funding 是复用属性，沿用上面已有标签；
        # level 同时服务 awards.level 与 research_projects.level——单一"键=属性名"的
        # FIELD_LABELS 装不下两个不同文案，取通用「级别」（渲染层不再按分区派生第二份表）。
        "study_form": "学习形式",
        "degree_type": "学位类型",
        "department": "院系",
        "rank": "成绩排名",
        "advisor": "导师",
        "research_direction": "研究方向",
        "team_size": "团队规模",
        "project_size": "项目规模",
        "category": "技能分类",
        "activity_type": "活动类型",
        "level": "级别",
        "ratio": "获奖比例",
        "my_rank": "我的署名位次",
        "outcome_type": "成果类型",
        "credential_type": "证书类型",
        # 2026-10：语言能力独立分区后的字段前缀（取得时间在同一行尾部展示）。
        "obtained": "取得时间",
    },
    "en-US": {
        "intent": "Objective",
        "github": "GitHub",
        "website": "Website",
        "gpa": "GPA / Rank",
        "courses": "Core Courses",
        "tech_stack": "Tech Stack",
        "photo_alt": "Profile photo",
        "doi": "DOI",
        "funding": "Funding",
        "filed": "Filed",
        "granted": "Granted",
        "issuer": "Issuer",
        "issued": "Issued",
        "expiry": "Expiry",
        "verify": "Verify",
        "artifact_type": "Artifact Type",
        "experience_kind": "Work Type",
        # F8（R-81）：与中文表同批；issuer 复用上面的 "Issuer"（证书资质既有文案）。
        "study_form": "Study Mode",
        "degree_type": "Degree Type",
        "department": "Department",
        "rank": "Rank",
        "advisor": "Advisor",
        "research_direction": "Research Direction",
        "team_size": "Team Size",
        "project_size": "Project Scale",
        "category": "Skill Category",
        "activity_type": "Activity Type",
        "level": "Level",
        "ratio": "Award Ratio",
        "my_rank": "My Authorship Rank",
        "outcome_type": "Outcome Type",
        "credential_type": "Credential Type",
        "obtained": "Obtained",
    },
}

# 分隔符与括号也属于"纸面上印什么"：只换字段前缀而留着 ``、``，英文产物会印出
# ``Python、MySQL``。英文的 ``", "`` 带尾随空格，因为它要拼在两个词之间。
LIST_SEPARATOR: dict[str, str] = {"zh-CN": "、", "en-US": ", "}
# 「技能名（等级）」与「姓名（性别）」的外层括号形态，``{level}`` / ``{gender}`` 是插槽。
LEVEL_PAREN: dict[str, str] = {"zh-CN": "（{level}）", "en-US": " ({level})"}
GENDER_PAREN: dict[str, str] = {"zh-CN": "（{gender}）", "en-US": " ({gender})"}


def normalize_language(value: str | None) -> ResumeLanguage:
    """把任意来源的语言值收口成 ``RESUME_LANGUAGES`` 里的一个。

    认不出就回 ``DEFAULT_RESUME_LANGUAGE``：数据库里出现 ``zh_CN`` / ``en`` / 空串
    （外部工具改过、旧备份、手写 SQL）时，导出的正确行为是"按默认语言照常输出"，
    而不是让整条渲染链路抛异常。
    """
    if isinstance(value, str):
        candidate = value.strip()
        if candidate in RESUME_LANGUAGES:
            return candidate
    return DEFAULT_RESUME_LANGUAGE


def section_titles(language: str | None) -> dict[str, str]:
    """取整张「分区键 → 标题」表（渲染器在循环外取一次即可）。

    返回副本：渲染器拿到的是自用的一张表，改它不会污染本模块的全局状态。
    """
    return dict(SECTION_TITLES[normalize_language(language)])


def section_title(key: str, language: str | None = None) -> str:
    """取单个分区标题；未知键回落为键名本身（与 ``resume_sections.section_label`` 同语义）。

    回落成键名而不是空串：缺少某个键时纸面上出现的是一行能看懂、能搜索的英文键，
    而不是"这个分区凭空消失"——后者是最难被发现的一类渲染 bug。
    """
    return section_titles(language).get(key, key)


def field_labels(language: str | None) -> dict[str, str]:
    """取整张「字段键 → 前缀词」表（返回副本，理由同 ``section_titles``）。"""
    return dict(FIELD_LABELS[normalize_language(language)])


def list_separator(language: str | None) -> str:
    """列表项之间的分隔符（``、`` / ``", "``）。"""
    return LIST_SEPARATOR[normalize_language(language)]


def level_text(name: str, level: str, language: str | None = None) -> str:
    """统一「技能名（等级）」的拼法；等级为空时只输出技能名。

    括号形态按语言取自 ``LEVEL_PAREN``：中文全角 ``（）``、英文半角加前导空格。
    没有等级就不该留一对空括号，所以这里显式分开处理。
    """
    if not level:
        return name
    return name + LEVEL_PAREN[normalize_language(language)].format(level=level)


def gender_text(gender: str, language: str | None = None) -> str:
    """统一「（性别）」的拼法；性别为空时返回空串。

    调用方通常已经判过空值，这里再判一次是为了避免"空性别印出一对孤零零的括号"。
    """
    if not gender:
        return ""
    return GENDER_PAREN[normalize_language(language)].format(gender=gender)


def level_parens(language: str | None = None) -> tuple[str, str]:
    """把「（等级）」的外层括号拆成左右两半：``("（", "）")`` / ``(" (", ")")``。

    HTML 模板不能直接用 ``level_text``——它要在括号**中间**放一个带
    ``data-resume-path`` 的 ``<span>``（前端靠它做「点纸面字段定位编辑」），所以模板需要
    的是两半括号而不是成品字符串。拆法从 ``LEVEL_PAREN`` 推出来，不另写一份括号表：
    两份表就一定会有一天只改了一份。
    """
    before, _, after = LEVEL_PAREN[normalize_language(language)].partition("{level}")
    return before, after


# ===== W14 科研状态词（事实锁字段的唯一文案来源）=====
# 正名口径（契约 §5.5）：under_review 必须显示为「在投」，禁止显示成「已发表」。
PUBLICATION_STATUS_LABELS: dict[str, dict[str, str]] = {
    "zh-CN": {
        "published": "已发表",
        "accepted": "已接收",
        "in_press": "出版中",
        "under_review": "在投",
        "preprint": "预印本",
        "other": "其他",
    },
    "en-US": {
        "published": "Published",
        "accepted": "Accepted",
        "in_press": "In Press",
        "under_review": "Under Review",
        "preprint": "Preprint",
        "other": "Other",
    },
}
PATENT_STATUS_LABELS: dict[str, dict[str, str]] = {
    "zh-CN": {"filed": "已申请", "pending": "审查中", "granted": "已授权", "expired": "已失效", "other": "其他"},
    "en-US": {"filed": "Filed", "pending": "Pending", "granted": "Granted", "expired": "Expired", "other": "Other"},
}
# A4 证书资质状态正名。**绝不出现"有效资格"这类认定**：active 只表示"有效期内"
# （来源状态事实），unknown 是"待核实"而不是"没有"；未知取值一律回落「待核实」，
# 宁可显示未核实，也不把待核实写成已取得。
CREDENTIAL_STATUS_LABELS: dict[str, dict[str, str]] = {
    "zh-CN": {
        "unknown": "待核实",
        "pending": "办理中",
        "active": "有效期内",
        "expired": "已过期",
    },
    "en-US": {
        "unknown": "Unverified",
        "pending": "Pending",
        "active": "Active",
        "expired": "Expired",
    },
}
_CREDENTIAL_STATUS_FALLBACK: dict[str, str] = {"zh-CN": "待核实", "en-US": "Unverified"}

# A4 实践/服务经历的工作类型词（不属于"工作类型"的取值不打印，宁可少一行也不猜）。
EXPERIENCE_KIND_LABELS: dict[str, dict[str, str]] = {
    "zh-CN": {
        "full_time": "全职",
        "part_time": "兼职",
        "contract": "合同制",
        "self_employed": "自雇",
        "internship": "实习",
        "volunteer": "志愿",
        "other": "其他",
    },
    "en-US": {
        "full_time": "Full-time",
        "part_time": "Part-time",
        "contract": "Contract",
        "self_employed": "Self-employed",
        "internship": "Internship",
        "volunteer": "Volunteer",
        "other": "Other",
    },
}


def publication_status_text(status: str, language: str | None = None) -> str:
    """论文状态的中文/英文正名；未知值回落到「其他」（绝不猜成已发表）。"""
    return PUBLICATION_STATUS_LABELS[normalize_language(language)].get(status, "其他")


def patent_status_text(status: str, language: str | None = None) -> str:
    """专利状态的正名；未知值回落「其他」。"""
    return PATENT_STATUS_LABELS[normalize_language(language)].get(status, "其他")


def credential_status_text(status: str, language: str | None = None) -> str:
    """证书资质状态的正名；未知值回落「待核实」——绝不把未核实写成已取得。"""
    normalized = normalize_language(language)
    return CREDENTIAL_STATUS_LABELS[normalized].get(
        status, _CREDENTIAL_STATUS_FALLBACK[normalized]
    )


def experience_kind_text(kind: str, language: str | None = None) -> str:
    """实践/服务经历的工作类型词；空值/未知值返回空串（不打印猜测的关系）。"""
    if not kind:
        return ""
    return EXPERIENCE_KIND_LABELS[normalize_language(language)].get(kind, "")


def _join_detail(parts) -> str:
    """把非空细节拼成" · " 分隔的一行（空项不产生多余分隔符）。"""
    return " · ".join(str(part).strip() for part in parts if str(part or "").strip())


def date_range(start_date: str, end_date: str) -> str:
    """日期区间：只有一端时不留孤零零的连字符。"""
    parts = [str(item).strip() for item in (start_date, end_date) if str(item or "").strip()]
    return " - ".join(parts)


def publication_detail(publication, language: str | None = None) -> str:
    """论文细节行：卷期 / DOI / 链接 / 备注（中英前缀取自 ``FIELD_LABELS``）。"""
    fields = field_labels(language)
    doi = f"{fields['doi']}：{publication.doi}" if publication.doi else ""
    return _join_detail([publication.volume_pages, doi, publication.url, publication.note])


def patent_detail(patent, language: str | None = None) -> str:
    """专利细节行：申请/授权日期与链接（中英前缀取自 ``FIELD_LABELS``）。"""
    fields = field_labels(language)
    filed = f"{fields['filed']} {patent.filed_date}" if patent.filed_date else ""
    granted = f"{fields['granted']} {patent.granted_date}" if patent.granted_date else ""
    return _join_detail([filed, granted, patent.url])


def credential_detail(credential, language: str | None = None) -> str:
    """证照细节行：签发/到期日期、核验链接、说明（中英前缀取自 FIELD_LABELS）。

    刻意**不含 credential_number**：证号是私密值，纸面与任何导出都不出现（模型里也没有
    这个字段，见 schemas/resume_credentials.py）。
    """
    fields = field_labels(language)
    issued = f"{fields['issued']} {credential.issue_date}" if credential.issue_date else ""
    expiry = f"{fields['expiry']} {credential.expiry_date}" if credential.expiry_date else ""
    # 核验链接带字段名前缀（与 DOI 同一口径）：读者一眼知道这个 URL 是干什么的。
    verify = (
        f"{fields['verify']}：{credential.verify_url}" if credential.verify_url else ""
    )
    return _join_detail([issued, expiry, verify, credential.note])


def authors_text(authors, language: str | None = None) -> str:
    """作者行：顺序即署名顺序；本人用 ``**加粗**`` 标记（结构化 is_self，不写进 name）。"""
    parts: list[str] = []
    for author in authors or []:
        name = str(getattr(author, "name", "") or "").strip()
        if not name:
            continue
        if getattr(author, "is_self", False):
            name = f"**{name}**"
        if getattr(author, "corresponding", False):
            name += "*"
        parts.append(name)
    separator = LIST_SEPARATOR[normalize_language(language)]
    return separator.join(parts)


__all__ = [
    "DEFAULT_RESUME_LANGUAGE",
    "FIELD_LABELS",
    "GENDER_PAREN",
    "LEVEL_PAREN",
    "LIST_SEPARATOR",
    "PATENT_STATUS_LABELS",
    "PUBLICATION_STATUS_LABELS",
    "RESUME_LANGUAGES",
    "SECTION_TITLES",
    "CREDENTIAL_STATUS_LABELS",
    "EXPERIENCE_KIND_LABELS",
    "authors_text",
    "credential_detail",
    "credential_status_text",
    "date_range",
    "experience_kind_text",
    "patent_detail",
    "publication_detail",
    "field_labels",
    "gender_text",
    "level_parens",
    "level_text",
    "list_separator",
    "normalize_language",
    "patent_status_text",
    "publication_status_text",
    "section_title",
    "section_titles",
]
