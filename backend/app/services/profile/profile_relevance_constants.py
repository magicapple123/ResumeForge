# SPDX-License-Identifier: Apache-2.0
"""岗位相关性筛选使用的常量和不可变结果类型。"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

# 这些上限是"一份简历"的候选上限，不是资料库的存储上限。
SECTION_LIMITS = {
    # 13 个大字段里"多条"的 11 个（基本信息 / 个人总结是单例，不进列表循环，计划 §6.3）。
    # 旧六分区的名额保持改造前的对应值；学术/科研/知识产权/证书各 20。
    "educations": 2,
    "experiences": 3,
    "campus_experiences": 2,
    "projects": 3,
    "skills": 14,
    "awards": 3,
    "publications": 20,
    "research_projects": 20,
    "patents": 20,
    "credentials": 20,
    # 语言能力从专业技能拆回独立后单列名额（R-72/§6.3）；仍受总预算控制。
    "languages": 20,
}

# 自建大字段的定义在库里，不能预先枚举；每个自建分区同样 20 条（§6.3）。
CUSTOM_SECTION_LIMIT = 20


def is_custom_section_key(key: str) -> bool:
    """自建大字段的分区键固定为 custom:<section_id>（契约 §2.1）。"""
    return str(key).startswith("custom:")


def section_limit(key: str) -> int:
    """某分区的候选名额：内置 13 项查表，自建分区统一 20（未知 key 也按 20 兜底）。"""
    return SECTION_LIMITS.get(str(key), CUSTOM_SECTION_LIMIT)

# 补充事实的候选 section 白名单（灵活化契约 §5）。
# STANDALONE：原样作为新键加入候选资料；MERGED：并进既有栏目（复用既有输出 schema）。
FACT_STANDALONE_SECTIONS: tuple[str, ...] = (
    "publications",
    "research_projects",
    "patents",
    "credentials",
)
FACT_MERGED_SECTIONS: tuple[str, ...] = (
    "work_projects",
    "practices",
    "awards",
    "skills",
    "trainings",
)
# 补充事实 section → 候选资料的既有栏目。作品/培训都并进 projects（项目内容/编辑器复用），
# 实践并进 experiences，荣誉并进 awards，语言并进 skills；"九个 section"对外仍是事实
# 快照的完整形状，候选链路只认这张表，不写第二套映射。
FACT_MERGE_TARGETS: dict[str, str] = {
    "work_projects": "projects",
    "practices": "experiences",
    "awards": "awards",
    "skills": "skills",
    "trainings": "projects",
}
FACT_SECTION_KEYS: tuple[str, ...] = FACT_STANDALONE_SECTIONS + FACT_MERGED_SECTIONS

SECTION_PRIMARY_FIELDS = {
    "educations": "school",
    "experiences": "company",
    "campus_experiences": "organization",
    "projects": "name",
    "skills": "name",
    "awards": "name",
    # 补充事实主字段：论文/专利用标题，科研/证照用名称（映射后候选的键名）。
    "publications": "title",
    "research_projects": "name",
    "patents": "title",
    "credentials": "name",
    # v3 新增大字段：语言条目的身份字段就是语言名（R-72 映射 name=语言）。
    "languages": "language",
}

# 岗位方向词只用于低权重的语义补充；硬技能仍然优先使用 JD 技能解析结果。
DOMAIN_SIGNALS: dict[str, tuple[str, ...]] = {
    "ai_algorithm": (
        "算法",
        "机器学习",
        "深度学习",
        "自然语言处理",
        "计算机视觉",
        "大模型",
        "LLM",
        "AIGC",
        "RAG",
        "AI Agent",
        "智能体",
        "推荐系统",
        "多模态",
        "模型训练",
        "推理",
    ),
    "backend": (
        "后端",
        "服务端",
        "微服务",
        "分布式",
        "高并发",
        "接口开发",
        "服务开发",
        "数据库",
        "系统设计",
    ),
    "frontend_client": (
        "前端",
        "客户端",
        "移动端",
        "桌面端",
        "Web 开发",
        "界面开发",
        "交互开发",
    ),
    "data": (
        "数据分析",
        "数据工程",
        "数据挖掘",
        "商业分析",
        "指标体系",
        "数据可视化",
    ),
    "product_operations": (
        "产品经理",
        "产品运营",
        "用户研究",
        "需求分析",
        "竞品分析",
        "活动策划",
        "内容运营",
        "增长运营",
        "用户增长",
    ),
    "testing": ("测试开发", "软件测试", "自动化测试", "质量保证", "测试工程师"),
}

# 这类词能强化已经识别出的方向，但过于宽泛，不能单独把 JD 归到某个方向。
DOMAIN_CONTEXT_SIGNALS: dict[str, tuple[str, ...]] = {
    "product_operations": ("活动", "内容", "推广", "公众号", "宣传", "协作"),
}

# 当 JD 没有明确写出某个技能，但岗位方向很明确时，用于给技能一个较小的
# 先验分数。这里只放常见类别，不会压过 JD 中的直接技能命中。
SKILL_DOMAIN_HINTS: dict[str, tuple[str, ...]] = {
    "ai_algorithm": (
        "Python",
        "PyTorch",
        "TensorFlow",
        "机器学习",
        "深度学习",
        "NLP",
        "LLM",
        "大模型",
        "Transformer",
        "RAG",
    ),
    "backend": (
        "Python",
        "Java",
        "Go",
        "C++",
        "FastAPI",
        "Django",
        "Spring Boot",
        "MySQL",
        "Redis",
        "Docker",
        "Linux",
    ),
    "frontend_client": (
        "JavaScript",
        "TypeScript",
        "React",
        "Vue",
        "Flutter",
        "Electron",
        "CSS3",
        "HTML5",
    ),
    "data": (
        "Python",
        "SQL",
        "MySQL",
        "Spark",
        "Flink",
        "数据分析",
        "数据挖掘",
    ),
    "product_operations": (
        "用户研究",
        "活动策划",
        "内容运营",
        "Excel",
        "Figma",
        "数据分析",
    ),
    "testing": ("Python", "Java", "Selenium", "自动化测试", "接口测试"),
}

_TITLE_SPLIT_RE = re.compile(r"[\s\-_/|,，、；;（）()：:]+")
_ASCII_TERM_RE = re.compile(r"[A-Za-z]")
_LIST_DETAIL_FIELDS = ("courses", "achievements", "description", "highlights")
_OPTIONAL_TOP_LEVEL_FIELDS = ("summary", "github", "personal_website", "target_city")
_LLM_PROFILE_FIELDS = (
    "target_city",
    "job_intent",
    "summary",
    # GitHub / 个人主页是用户主动填写的公开作品链接，本来就是放简历用的——
    # 不属于身份敏感字段（与电话/邮箱/身份证不同），要随候选资料提供给模型。
    "github",
    "personal_website",
    "educations",
    "experiences",
    "campus_experiences",
    "projects",
    "skills",
    "awards",
    # 补充事实（A3）的独立 section。它们**只在本次候选真的带上这些 section 时才出现**
    # （见 build_llm_profile_prompt_data 的跳过规则）：没有新事实时提示词结构与改动前
    # 逐字节一致，旧请求/旧备份不受影响。
    *FACT_STANDALONE_SECTIONS,
    # v3 新增大字段：语言能力进模型素材（R-73 要求模型知道有语言，纸面再映射 skills）。
    "languages",
    # v3 新增基本信息的合法素材字段。**只增不改**：旧资料没有这些值时不出现，
    # 因此默认组在"新字段全空"时的模型输入仍是改造前基线（C1/R-31）。
    "portfolio_url",
    "political_status",
    "driver_license",
    "available_date",
)
_MIN_PROFILE_CONTEXT_CHARS = 1_000
_REFERENCE_SECTIONS = ("educations", "experiences", "campus_experiences", "projects")
_REFERENCE_CONTENT_KEY = "_reference_content"
_REFERENCE_FILE_KEY = "_reference_file_name"
_REFERENCE_EXCERPT_MAX_CHARS = 1_800
_REFERENCE_FACT_MAX_CHARS = 320
_REFERENCE_FACT_LIMIT = 5
_REFERENCE_INSTRUCTION_RE = re.compile(
    r"(?:忽略|绕过).{0,24}(?:系统|规则|指令|要求|限制)|"
    r"(?:系统|开发者|用户)\s*(?:消息|指令)|"
    r"(?:执行|遵循).{0,16}(?:以下|上述|本文).{0,8}(?:命令|指令)|"
    r"(?:虚构|编造).{0,24}(?:经历|成绩|成果|数据|数字)|"
    r"(?:请勿|不要|无需).{0,24}(?:虚构|编造|弱化|执行)",
    re.IGNORECASE,
)
_REFERENCE_META_RE = re.compile(
    r"用途说明|事实性总结|供后续|简历(?:包装|优化|措辞)|"
    r"面试(?:准备|要点)|可直接(?:提炼|引用|使用)|不是(?:系统|用户)指令",
    re.IGNORECASE,
)
_MARKDOWN_LIST_PREFIX_RE = re.compile(r"^(?:[-+*]\s+|\d+(?:[.)、]|、)\s*)")
_MARKDOWN_TABLE_DIVIDER_RE = re.compile(r"^:?-{3,}:?$")


@dataclass(frozen=True)
class JobFocus:
    """从岗位标题/JD 中提取的可解释匹配信号。"""

    skills: tuple[str, ...]
    domains: tuple[str, ...]
    terms: tuple[str, ...]


@dataclass(frozen=True)
class ProfileSelection:
    """候选资料及其诊断信息。``serialized`` 一定是完整合法 JSON。

    ``entry_names`` 记录**筛选之前**每一段经历类分区里都有谁（用条目的身份字段，
    如项目名 / 公司名 / 学校名）。存在理由：预算压缩与岗位相关性筛选都发生在
    ``data`` 上，等生成结束再想回答"我的项目怎么没写进简历"，``data`` 已经只剩
    被留下来的那几个了——没有这份清单，就说不清是"没被选中"还是"模型没写"。
    """

    data: dict[str, Any]
    serialized: str
    focus: JobFocus
    selected_counts: dict[str, int]
    omitted_counts: dict[str, int]
    entry_names: dict[str, tuple[str, ...]]
    # A4/§8.5：哪些分区用了"信号不足时的最小候选兜底"（仅岗位路径可能非空）。
    # 生成说明据此如实告知用户"交集较少、资料中未提供的要求不会编写"。
    fallback_sections: tuple[str, ...] = ()
# ===== 生成候选的提示词形状与枚举映射（F3-A profile_context 使用） =====
# 13 个大字段里进入列表的分区由消费 DTO 的 participating_keys 决定；这里只放
# "字段 key → 旧提示词键/枚举"的纯数据，供 profile_context 落成旧形状候选。

# 旧六分区的提示词形状：(输出键, 新模型字段 key, 变换)。
# 变换：text=原样字符串；lines=按换行拆要点；commas=按中英文逗号拆技术栈。
_LEGACY_SECTION_SHAPES: dict[str, tuple[tuple[str, str, str], ...]] = {
    "educations": (
        ("school", "school", "text"),
        ("major", "major", "text"),
        ("degree", "degree", "text"),
        ("start_date", "start_date", "text"),
        ("end_date", "end_date", "text"),
        ("gpa", "gpa", "text"),
        ("courses", "core_courses", "lines"),
        ("achievements", "achievements", "lines"),
    ),
    "experiences": (
        ("company", "company", "text"),
        ("role", "title", "text"),
        ("start_date", "start_date", "text"),
        ("end_date", "end_date", "text"),
        ("description", "description", "lines"),
    ),
    "campus_experiences": (
        ("organization", "organization", "text"),
        ("role", "role", "text"),
        ("start_date", "start_date", "text"),
        ("end_date", "end_date", "text"),
        ("description", "description", "lines"),
    ),
    "projects": (
        ("name", "name", "text"),
        ("role", "role", "text"),
        ("start_date", "start_date", "text"),
        ("end_date", "end_date", "text"),
        ("tech_stack", "tech_stack", "commas"),
        ("description", "description", "lines"),
        ("highlights", "highlights", "lines"),
    ),
    "skills": (("name", "name", "text"), ("level", "level", "text")),
    "awards": (
        ("name", "title", "text"),
        ("date", "awarded_at", "text"),
        ("description", "description", "text"),
    ),
}

# 旧六分区里 v3 才暴露给模型的字段：输出键优先对齐 ResumeContent 已有槽位，
# 避免模型把新键塞进不存在的输出字段；空值不出现（只增不改）。
_INCREMENT_ALIASES: dict[str, dict[str, str]] = {
    "experiences": {"work_type": "experience_kind"},
    "projects": {"outcome_type": "artifact_type"},
}

# 基本信息：旧提示词的平铺键保持旧名（等价基线要求），v3 新字段只在有值时追加。
_BASIC_INFO_LEGACY: tuple[tuple[str, str], ...] = (
    ("name", "name"),
    ("gender", "gender"),
    ("birth_year", "birth_month"),
    ("phone", "phone"),
    ("email", "email"),
    ("city", "city"),
    ("target_city", "target_city"),
    ("job_intent", "job_intention"),
    ("personal_website", "homepage"),
    ("github", "github"),
)
_BASIC_INFO_EXTRA: tuple[str, ...] = (
    "portfolio_url",
    "political_status",
    "driver_license",
    "available_date",
)

# 新资料目录里的状态是自由文本（建议值多为中文），而 ResumeContent 的状态是英文枚举。
# 候选必须给出能解析的枚举值，否则会被解析层清空——映射集中在这里，不在提示词里让模型猜。
_WORK_TYPE_KINDS = {
    "全职": "full_time",
    "实习": "internship",
    "兼职": "part_time",
    "志愿服务": "volunteer",
    "社会实践": "other",
}
_PUBLICATION_STATUS = {
    "published": "published", "已发表": "published",
    "accepted": "accepted", "已录用": "accepted", "录用": "accepted",
    "in_press": "in_press", "已见刊": "in_press", "排印中": "in_press",
    "under_review": "under_review", "在投": "under_review", "审稿中": "under_review",
    "preprint": "preprint", "预印本": "preprint",
    "other": "other", "其他": "other",
}
_PATENT_STATUS = {
    "filed": "filed", "已申请": "filed",
    "pending": "pending", "审查中": "pending", "实审中": "pending",
    "granted": "granted", "已授权": "granted",
    "expired": "expired", "已过期": "expired",
    "other": "other", "其他": "other",
}
_CREDENTIAL_STATUS = {
    "active": "active", "已取得": "active", "有效": "active",
    "pending": "pending", "办理中": "pending", "待取得": "pending",
    "expired": "expired", "已过期": "expired",
    "unknown": "unknown", "未知": "unknown", "其他": "unknown",
}
