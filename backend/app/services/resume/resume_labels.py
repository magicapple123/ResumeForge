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

``zh-CN`` 那张表必须与历史输出**逐字相同**（含 ``实习/工作经历`` 里的半角斜杠与
``、`` 分隔符）：默认语言的产物零变化是黄金基线不动的前提。

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
        "skills": "专业技能",
        "campus_experience": "校园经历",
        "awards": "荣誉奖项",
        "summary": "个人总结",
    },
    "en-US": {
        "education": "Education",
        "experience": "Experience",
        "projects": "Projects",
        "skills": "Skills",
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
    },
    "en-US": {
        "intent": "Objective",
        "github": "GitHub",
        "website": "Website",
        "gpa": "GPA / Rank",
        "courses": "Core Courses",
        "tech_stack": "Tech Stack",
        "photo_alt": "Profile photo",
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


__all__ = [
    "DEFAULT_RESUME_LANGUAGE",
    "FIELD_LABELS",
    "GENDER_PAREN",
    "LEVEL_PAREN",
    "LIST_SEPARATOR",
    "RESUME_LANGUAGES",
    "SECTION_TITLES",
    "field_labels",
    "gender_text",
    "level_parens",
    "level_text",
    "list_separator",
    "normalize_language",
    "section_title",
    "section_titles",
]
