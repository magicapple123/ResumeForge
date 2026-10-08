"""重复表单区块的语义解析与字段命名。

网申页面经常把同一类经历渲染成多组结构完全相同的控件。
这个模块只负责回答两个纯问题：

* 页面上的 ``实习经历-2`` 属于哪一类、哪一条；
* 一个重复字段应该使用哪个扁平字段 key。

浏览器快照、规则匹配、AI 兜底和资料展开都依赖这份规则，避免各自用不同的
"第一条"判断。
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass


@dataclass(frozen=True)
class RepeatedBlock:
    """页面上一个重复区块的规范描述。"""

    family: str
    index: int | None
    label: str


# 顺序按别名长度从长到短生成正则，避免“项目经历”被更短的“经历”提前截断。
BLOCK_FAMILY_ALIASES: dict[str, tuple[str, ...]] = {
    "experience": (
        "实习工作经历",
        "实习和工作经历",
        "实习和工作补充",
        "实习和工作",
        "实习经历",
        "工作经历",
        "工作经验",
    ),
    "project": ("项目经历补充", "项目经历", "项目经验"),
    "campus": (
        "校园和社会实践经历",
        "校园和社会实践补充",
        "校园和社会实践",
        "校园经历",
        "校内经历",
        "社会实践",
    ),
    "education": ("教育经历补充", "教育经历", "学习经历"),
    "award": (
        "竞赛和获奖补充",
        "竞赛和获奖",
        "获奖信息",
        "奖项信息",
        "荣誉奖项",
        "获奖经历",
    ),
    "academic": ("学术成果补充", "学术成果", "科研成果", "论文成果"),
    "language": ("语言能力补充", "语言能力", "语言经历", "外语能力"),
    "certificate": ("证书补充", "证书信息", "资格证书", "证书经历"),
    "skill": ("技能补充", "技能信息", "专业技能", "技能特长"),
    "contact": ("紧急联系人", "紧急联络人"),
    "portfolio": ("作品和附件", "作品经历", "作品集", "作品展示"),
    "social": ("社交账号", "社交平台账号"),
}

_ALIASES_TO_FAMILY = {
    alias: family
    for family, aliases in BLOCK_FAMILY_ALIASES.items()
    for alias in aliases
}
_ALIASES = "|".join(
    re.escape(alias)
    for alias in sorted(_ALIASES_TO_FAMILY, key=len, reverse=True)
)
_INDEX = r"[0-9０-９一二三四五六七八九十百千万]+"
_SEPARATOR = r"(?:[-‐‑‒–—―－_＿:：]|第)"
_LABEL_WITH_INDEX = re.compile(
    rf"(?P<alias>{_ALIASES})\s*(?:{_SEPARATOR}\s*)?(?P<index>{_INDEX})\s*(?:条|段|项|个|份)?"
)
_INDEX_BEFORE_LABEL = re.compile(
    rf"第\s*(?P<index>{_INDEX})\s*(?:条|段|项|个|份)?\s*(?P<alias>{_ALIASES})"
)
_LABEL_WITH_SUFFIX = re.compile(
    rf"(?P<alias>{_ALIASES})\s+(?P<index>{_INDEX})\s*(?:条|段|项|个|份)"
)

_CN_DIGITS = {
    "零": 0,
    "〇": 0,
    "一": 1,
    "二": 2,
    "两": 2,
    "三": 3,
    "四": 4,
    "五": 5,
    "六": 6,
    "七": 7,
    "八": 8,
    "九": 9,
}
_CN_UNITS = {"十": 10, "百": 100, "千": 1000, "万": 10000}
_ORDINAL_SUFFIX = re.compile(
    r"\s*[（(]\s*第[0-9０-９一二三四五六七八九十百千万]+\s*条\s*[）)]\s*$"
)


def parse_index(raw: str) -> int | None:
    """解析阿拉伯数字、全角数字和常见中文数字。"""
    text = unicodedata.normalize("NFKC", str(raw or "")).strip()
    if not text:
        return None
    if text.isdigit():
        value = int(text)
        return value if value > 0 else None

    total = 0
    section = 0
    number = 0
    for char in text:
        if char in _CN_DIGITS:
            number = _CN_DIGITS[char]
            continue
        unit = _CN_UNITS.get(char)
        if unit is None:
            return None
        if unit == 10000:
            section = (section + (number or 0)) * unit
            total += section
            section = 0
            number = 0
        elif number:
            section += number * unit
            number = 0
        else:
            section += unit
    value = total + section + number
    return value if value > 0 else None


def _match_block(text: str) -> tuple[str, int, str] | None:
    normalized = unicodedata.normalize("NFKC", str(text or ""))
    normalized = re.sub(r"\s+", " ", normalized).strip()
    if not normalized:
        return None

    for pattern in (_INDEX_BEFORE_LABEL, _LABEL_WITH_INDEX, _LABEL_WITH_SUFFIX):
        match = pattern.search(normalized)
        if match is None:
            continue
        index = parse_index(match.group("index"))
        if index is None:
            continue
        alias = match.group("alias")
        family = _ALIASES_TO_FAMILY.get(alias)
        if family is None:
            continue
        return family, index, match.group(0).strip()
    return None


def parse_block_label(text: str) -> RepeatedBlock | None:
    """从一个 DOM 文本片段中提取重复区块标题。

    只接受带序号的标题。单独的“实习经历”不足以区分第几条，不能作为重复映射依据。
    """
    matched = _match_block(text)
    if matched is None:
        return None
    family, index, label = matched
    return RepeatedBlock(family=family, index=index, label=label)


def family_for_field(field_name: str) -> str | None:
    """返回字段所属的重复区块类型。"""
    base, _index = split_repeated_key(field_name)
    for family in (
        "experience",
        "project",
        "award",
        "campus",
        "education",
        "academic",
        "language",
        "certificate",
        "skill",
        "contact",
        "portfolio",
        "social",
    ):
        if base.startswith(f"{family}_"):
            return family
    if base in {
        "school",
        "department",
        "major",
        "degree",
        "degree_type",
        "study_mode",
        "education_start",
        "education_end",
        "gpa",
        "cet4_score",
        "cet6_score",
    }:
        return "education"
    return None


def split_repeated_key(field_name: str) -> tuple[str, int | None]:
    """把 ``experience_2_company`` 拆成基础字段和序号。"""
    match = re.match(
        r"^(experience|project|award|campus|education|academic|language|certificate|skill|contact|portfolio|social)_(\d+)_(.+)$",
        str(field_name or ""),
    )
    if match is None:
        return str(field_name or ""), None
    family, raw_index, suffix = match.groups()
    index = parse_index(raw_index)
    if index is None:
        return str(field_name or ""), None
    if family == "education":
        base = {
            "start": "education_start",
            "end": "education_end",
        }.get(suffix)
        if base is None:
            base = (
                suffix
                if suffix
                in {
                    "school",
                    "department",
                    "major",
                    "degree",
                    "degree_type",
                    "study_mode",
                    "gpa",
                    "cet4_score",
                    "cet6_score",
                }
                else f"education_{suffix}"
            )
    else:
        base = f"{family}_{suffix}"
    return base, index


def field_key_for_block(field_name: str, family: str | None, index: int | None) -> str:
    """根据页面区块把基础字段转换成动态 key。"""
    base, existing_index = split_repeated_key(field_name)
    if existing_index is not None:
        return field_name
    if not family or not index or family_for_field(base) != family:
        return field_name
    if family == "education" and base in {
        "school",
        "department",
        "major",
        "degree",
        "degree_type",
        "study_mode",
        "gpa",
        "cet4_score",
        "cet6_score",
        "education_start",
        "education_end",
    }:
        suffix = base.removeprefix("education_")
        if base in {
            "school",
            "department",
            "major",
            "degree",
            "degree_type",
            "study_mode",
            "gpa",
            "cet4_score",
            "cet6_score",
        }:
            suffix = base
        return f"education_{index}_{suffix}"
    return f"{family}_{index}_{base.removeprefix(family + '_')}"


def field_label_for_key(field_name: str, base_label: str = "") -> str:
    """为动态字段生成稳定的中文显示名。"""
    base, index = split_repeated_key(field_name)
    label = base_label or base
    if index is None:
        return label
    # ``FIELD_LABELS`` 中的兼容字段本身带有“（第一条）”。动态 key 再追加
    # 序号前先去掉这个展示层后缀，否则第二条会变成
    # “实习单位（第一条）（第二条）”。
    label = _ORDINAL_SUFFIX.sub("", label).strip()
    return f"{label}（第{ordinal_text(index)}条）"


def ordinal_text(index: int) -> str:
    """把序号转成用户易读的中文序数。"""
    if index <= 10:
        return ("一", "二", "三", "四", "五", "六", "七", "八", "九", "十")[index - 1]
    if index < 20:
        return f"十{ordinal_text(index - 10)}"
    if index % 10 == 0:
        return f"{ordinal_text(index // 10)}十"
    return f"{ordinal_text(index // 10)}十{ordinal_text(index % 10)}"


def compatible_block(
    field_name: str,
    block_family: str,
    block_index: int | None,
    *,
    target_index: int | None = None,
) -> bool:
    """判断字段与控件区块是否兼容。

    没有区块信息的旧快照保持兼容；一旦页面提供了区块类型，就不允许跨区块借用。
    """
    expected_family = family_for_field(field_name)
    if not block_family:
        return True
    # 这些是“最近一条”独立字段，不应在带序号的经历区块里抢走逐条字段。
    if expected_family is None and field_name in {
        "company",
        "job_title",
        "work_start",
        "work_end",
    }:
        return False
    if expected_family is None:
        return True
    if expected_family != block_family:
        return False
    if target_index is not None and block_index is not None:
        return target_index == block_index
    return True


def family_from_control_text(control_text: str) -> str | None:
    """Infer a repeated-section family from a control's own label/prompt only."""
    text = unicodedata.normalize("NFKC", str(control_text or "")).casefold()
    markers = (
        ("project", ("项目名称", "项目角色", "项目描述", "项目链接", "项目经历")),
        ("experience", ("公司名称", "职位名称", "工作描述", "实习经历", "工作经历")),
        ("award", ("荣誉名称", "荣誉描述", "奖项名称", "竞赛名称", "获奖")),
        ("certificate", ("证书名称", "证书描述", "证书类型", "资格证书")),
        ("campus", ("校园经历", "社团经历", "校园职务", "实践名称")),
        ("academic", ("论文名称", "学术成果", "科研成果")),
    )
    matches = [family for family, markers_for_family in markers if any(marker in text for marker in markers_for_family)]
    return matches[0] if len(set(matches)) == 1 else None


__all__ = [
    "BLOCK_FAMILY_ALIASES",
    "RepeatedBlock",
    "compatible_block",
    "family_for_field",
    "field_key_for_block",
    "field_label_for_key",
    "ordinal_text",
    "parse_block_label",
    "parse_index",
    "split_repeated_key",
]
