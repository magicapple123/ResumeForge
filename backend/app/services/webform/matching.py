"""取值决策的纯函数：选哪个下拉项、点哪个单选、日期怎么格式化。

## 为什么这些判断必须在 Python 里

填表引擎原先把"选哪个 option"塞在注入的 JS 里，而离线测试用的假客户端**不执行 JS**，
只能断言脚本字符串里出现了某个标记——于是"用 ``HTMLInputElement`` 的 setter 去写
``<select>``"这种必炸的写法能一路活到生产。把判断搬到 Python 之后，这些边界都能被穷举
测试，注入的 JS 退化成没有分支的哑执行器。

**这个模块不依赖浏览器**（只吃 ``SelectOption`` 与字符串），所以单元测试不需要任何桩件。
"""
from __future__ import annotations

import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass

from .fields import OPTION_ALIASES, PLACEHOLDER_TEXTS

# 全角 → 半角。表单里"（"与"("混用是常态。
_FULLWIDTH_START = 0xFF01
_FULLWIDTH_END = 0xFF5E
_FULLWIDTH_OFFSET = 0xFEE0

# 规范化时要去掉的首尾装饰性符号。
_DECORATION = " \t\r\n-—–:：·.、,，*＊[]【】()（）<>《》\"'“”‘’"

# 日期：先把中文的「年月日」规成统一分隔符，再套一个简单模式。
#
# 一开始写的是一个把「年/月/日」都塞进去的大正则，结果 ``2022年9月`` 解析不了——
# 「月」被写进了"日"那一组，末尾的「月」没人消费。先规范化再匹配既短又不容易出错。
_DATE_SEPARATORS = ".-/ "
_DATE_RE = re.compile(r"^(?P<year>\d{4})(?:[.\-/](?P<month>\d{1,2})(?:[.\-/](?P<day>\d{1,2}))?)?$")
_DATE_SAMPLE_RE = re.compile(
    r"(?P<year>\d{4})(?P<first>[.\-/])(?P<month>\d{1,2})"
    r"(?:(?P<second>[.\-/])(?P<day>\d{1,2}))?"
)
_DATE_TOKEN_RE = re.compile(
    r"(?i)y{4}\s*([.\-/])\s*(m{1,2})"
    r"(?:\s*([.\-/])\s*(d{1,2}))?"
)
_DATE_HINT_RE = re.compile(
    r"date|日期|年月|年/月|选择日期|出生|入学|毕业|起止时间|开始时间|结束时间"
    r"|(?:^|[_-])(start|end|begin|finish)(?:$|[_-])",
    re.IGNORECASE,
)

# 表示"仍在进行"的说法。它们是**合法答案**，但不是具体日期。
_PRESENT_TEXTS = frozenset(
    {"至今", "现在", "目前", "在职", "在读", "present", "now", "current", "till now", "至今为止"}
)


@dataclass(frozen=True)
class SelectOption:
    """下拉/单选里的一个选项。``value`` 是提交值（可能是 ``"3"`` 这种），``text`` 是给人看的。"""

    value: str
    text: str = ""
    disabled: bool = False

    def display(self) -> str:
        return self.text or self.value


@dataclass(frozen=True)
class SelectResolution:
    """一个值该落到哪个选项上。``status`` 的取值见下方各分支。"""

    status: str  # matched | no_option | ambiguous | empty
    option: SelectOption | None = None
    reason: str = ""


@dataclass(frozen=True)
class DateResolution:
    """一个日期值该怎么写进控件。

    ``assumed_day`` 为真表示"月份有了但日没有，补了个 1 号"——预览界面必须把这种
    标成需确认，不能与"资料里就是这一天"混为一谈。
    """

    status: str  # matched | unparsed | empty | ongoing
    value: str = ""
    assumed_day: bool = False
    reason: str = ""


def normalize_option_text(text: str) -> str:
    """规范化选项/取值文本，用于比较（不用于展示）。"""
    result = []
    for char in text or "":
        code = ord(char)
        if _FULLWIDTH_START <= code <= _FULLWIDTH_END:
            result.append(chr(code - _FULLWIDTH_OFFSET))
        else:
            result.append(char)
    return "".join(result).strip(_DECORATION).casefold()


def is_placeholder(text: str) -> bool:
    """是不是"还没选"的占位项。规范化后逐字比对。"""
    return normalize_option_text(text) in PLACEHOLDER_TEXTS


def aliases_of(value: str) -> frozenset[str]:
    """取一个值所在的概念组（规范化后的全部写法）。

    双向：既包含"它是规范名时它的别名"，也包含"它是某个别名时那一组的其他写法"，
    所以 ``硕士`` 与 ``硕士研究生`` 能互相找到。
    """
    target = normalize_option_text(value)
    if not target:
        return frozenset()
    group = {target}
    for canonical, aliases in OPTION_ALIASES.items():
        normalized_canonical = normalize_option_text(canonical)
        normalized_aliases = {normalize_option_text(alias) for alias in aliases}
        if target == normalized_canonical or target in normalized_aliases:
            group.add(normalized_canonical)
            group |= normalized_aliases
    return frozenset(group)


def meaningful_options(options: Sequence[SelectOption]) -> list[SelectOption]:
    """去掉禁用项与占位项之后剩下的可选项。"""
    return [
        option
        for option in options
        if not option.disabled and not is_placeholder(option.display())
    ]


def _unique(options: Iterable[SelectOption]) -> SelectOption | None:
    items = list(options)
    return items[0] if len(items) == 1 else None


def option_keys(option: SelectOption) -> frozenset[str]:
    """一个选项可以用来比对的全部文本：展示文本**与**提交值。

    两者都要比——``<option value="3">本科</option>`` 要按文本认，而单选的
    ``value`` 往往才是有效信息（有些站点单选没有 label，只有 value="男"）。
    """
    return frozenset(
        key for key in (normalize_option_text(option.text), normalize_option_text(option.value)) if key
    )


def resolve_select_option(options: Sequence[SelectOption], value: str) -> SelectResolution:
    """把 ``value`` 落到某个选项上。

    匹配次序：精确 → 别名 → 包含。**多候选一律 ``ambiguous``，不猜**——两个都沾边的
    时候选错比不选更糟，交给用户在下拉里点一下。
    """
    if not (value or "").strip():
        return SelectResolution("empty", reason="没有值可填")

    candidates = meaningful_options(options)
    if not candidates:
        return SelectResolution(
            "no_option",
            reason="下拉里只有占位项——若是联动下拉（选了上一级才加载），请先选上一级再读取表单",
        )

    target = normalize_option_text(value)

    exact = [option for option in candidates if target in option_keys(option)]
    if best := _unique(exact):
        return SelectResolution("matched", option=best)
    if exact:
        return SelectResolution("ambiguous", reason=f"有 {len(exact)} 个选项与“{value}”完全相同")

    wanted = aliases_of(value)
    if len(wanted) > 1:
        alias_hits = [option for option in candidates if option_keys(option) & wanted]
        if best := _unique(alias_hits):
            return SelectResolution("matched", option=best)
        if alias_hits:
            return SelectResolution(
                "ambiguous", reason=f"有 {len(alias_hits)} 个选项都对应“{value}”"
            )

    date_hits = [
        option
        for option in candidates
        if date_values_match(value, option.display()) or date_values_match(value, option.value)
    ]
    if best := _unique(date_hits):
        return SelectResolution("matched", option=best)
    if date_hits:
        return SelectResolution("ambiguous", reason=f"有 {len(date_hits)} 个日期选项对应“{value}”")

    def _contains(option: SelectOption) -> bool:
        return any(target in key or key in target for key in option_keys(option))

    contained = [option for option in candidates if _contains(option)]
    if best := _unique(contained):
        return SelectResolution("matched", option=best)
    if contained:
        return SelectResolution("ambiguous", reason=f"有 {len(contained)} 个选项都包含“{value}”")

    return SelectResolution("no_option", reason=f"页面下拉里没有“{value}”这一项")


def resolve_choice(options: Sequence[SelectOption], value: str) -> SelectResolution:
    """单选/复选组：与下拉同一套匹配规则，选项来自每个控件的 ``value`` 与自身标签。"""
    return resolve_select_option(options, value)


def parse_date(raw: str) -> tuple[int, int | None, int | None] | None:
    """解析资料里的日期字符串，返回 ``(年, 月, 日)``；解析不了返回 ``None``。

    接受 ``2022.09`` / ``2022-09`` / ``2022/9`` / ``2022年9月`` / ``2022年9月15日`` /
    ``2022`` 这几种写法（资料里都出现过）。
    """
    text = (raw or "").strip()
    if not text:
        return None
    text = text.replace("年", ".").replace("月", ".").replace("日", "")
    text = text.strip(_DATE_SEPARATORS)
    match = _DATE_RE.match(text)
    if match is None:
        return None
    month = match.group("month")
    day = match.group("day")
    return (
        int(match.group("year")),
        int(month) if month else None,
        int(day) if day else None,
    )


def date_component(raw: str, part: str) -> DateResolution:
    """把一个资料日期拆成目标下拉需要的年/月/日组件。"""
    if not (raw or "").strip():
        return DateResolution("empty", reason="资料里没有这一项")
    if is_ongoing(raw):
        return DateResolution("ongoing", reason=f"“{raw.strip()}”不是具体日期，请按页面选项选择")
    parsed = parse_date(raw)
    if parsed is None:
        return DateResolution("unparsed", reason=f"看不懂“{raw.strip()}”这个日期")
    year, month, day = parsed
    if part == "year":
        return DateResolution("matched", value=f"{year:04d}")
    if part == "month":
        if month is None:
            return DateResolution("unparsed", reason=f"资料里只有年份（{year}），没有月份")
        return DateResolution("matched", value=f"{month:02d}")
    if part == "day":
        if day is None:
            return DateResolution("unparsed", reason="资料里没有具体日期")
        return DateResolution("matched", value=f"{day:02d}")
    return DateResolution("unparsed", reason=f"不支持的日期组件：{part}")


def is_ongoing(raw: str) -> bool:
    """这个值是不是"至今"这类"仍在进行"，而不是一个具体日期。"""
    return (raw or "").strip().casefold() in _PRESENT_TEXTS


def is_date_hint(text: str) -> bool:
    """判断控件描述是否明确表示日期/时间字段。"""
    return bool(_DATE_HINT_RE.search(text or ""))


_DATE_LIKE_RE = re.compile(
    r"^\s*\d{4}\s*(?:[-./年]\s*\d{1,2}\s*(?:[-./月]\s*\d{1,2}\s*日?)?)?\s*$"
)


def same_phone_number(field_name: str, expected: str, actual: str) -> bool:
    """号码类字段：去掉分隔符后与期望一致，就算写对了。

    2026-10-05 腾讯校招页实测：我们写 ``138-0000-0000``，页面自己重排成
    ``13800000000``——数字完全一致，只是它去掉了横线。这种"页面规范化了格式"不该
    报"待确认"（那不是没生效）。只在 ``phone`` 前缀的字段上生效，且两侧数字都
    要够长（≥7 位），避免把日期一类的"数字恰好相同"误判成一致。
    """
    if not field_name.startswith("phone"):
        return False
    digits_expected = re.sub(r"\D", "", expected or "")
    digits_actual = re.sub(r"\D", "", actual or "")
    return len(digits_expected) >= 7 and digits_expected == digits_actual


def is_date_like_value(value: str) -> bool:
    """值本身是不是日期/年份形状（「2023-06」「2019.9」「2001」「2027年6月」）。

    「年 / 月 / 日」拆分组件的**槽位**只对日期形状的值开放：school 这类文本字段
    即使命中了年下拉（区块标签污染），也不该按拆分槽位把同一个值塞进每一个组件
    ——那会把学校名填进「年」「月」两个框。
    """
    return bool(_DATE_LIKE_RE.match(value or ""))


def date_values_match(left: str, right: str) -> bool:
    """判断两个日期文本是否表示同一天或同一个年月。"""
    left_parsed = parse_date(left)
    right_parsed = parse_date(right)
    return left_parsed is not None and left_parsed == right_parsed


def _format_text_date(raw: str, hint: str) -> str:
    parsed = parse_date(raw)
    if parsed is None:
        return raw.strip()
    year, month, day = parsed
    if month is None:
        return raw.strip()
    if re.search(r"年.*月", hint or ""):
        return f"{year}年{month}月" + (f"{day}日" if day is not None else "")

    sample = _DATE_SAMPLE_RE.search(hint or "")
    if sample is not None:
        first = sample.group("first")
        second = sample.group("second") or first
        month_text = f"{month:02d}" if len(sample.group("month")) == 2 else str(month)
        if day is None or sample.group("day") is None:
            return f"{year:04d}{first}{month_text}"
        day_text = f"{day:02d}" if len(sample.group("day")) == 2 else str(day)
        return f"{year:04d}{first}{month_text}{second}{day_text}"

    token = _DATE_TOKEN_RE.search(hint or "")
    if token is not None:
        first = token.group(1)
        month_text = f"{month:02d}" if len(token.group(2)) == 2 else str(month)
        if day is None or token.group(4) is None:
            return f"{year:04d}{first}{month_text}"
        second = token.group(3) or first
        day_text = f"{day:02d}" if len(token.group(4)) == 2 else str(day)
        return f"{year:04d}{first}{month_text}{second}{day_text}"

    if day is None:
        return f"{year:04d}-{month:02d}"
    return f"{year:04d}-{month:02d}-{day:02d}"


def format_date(raw: str, *, kind: str = "text", hint: str = "") -> DateResolution:
    """把资料里的日期字符串写成目标控件要的形状。

    ``kind`` 是目标控件期望的粒度：``date``（``YYYY-MM-DD``）、``month``（``YYYY-MM``）、
    ``text``（原样）。

    **只有年份时不往日期控件里塞**：``2022-01-01`` 里的月和日是我们编的，而这正是
    "宁可不给结论"要避免的。年月齐全而日缺失时补 1 号，但把 ``assumed_day`` 标出来。
    """
    if not (raw or "").strip():
        return DateResolution("empty", reason="资料里没有这一项")
    if is_ongoing(raw):
        return DateResolution("ongoing", reason=f"“{raw.strip()}”不是具体日期，请按页面选项选择")

    parsed = parse_date(raw)
    if parsed is None:
        return DateResolution("unparsed", reason=f"看不懂“{raw.strip()}”这个日期")
    year, month, day = parsed

    if kind == "text":
        return DateResolution("matched", value=_format_text_date(raw, hint))

    if month is None:
        if kind == "year":
            return DateResolution("matched", value=f"{year:04d}")
        return DateResolution(
            "unparsed", reason=f"资料里只有年份（{year}），这个控件需要完整日期"
        )

    if kind == "month":
        return DateResolution("matched", value=f"{year:04d}-{month:02d}")

    if kind == "year":
        return DateResolution("matched", value=f"{year:04d}")

    if day is None:
        return DateResolution(
            "matched", value=f"{year:04d}-{month:02d}-01", assumed_day=True, reason="日按 1 号填写"
        )
    return DateResolution("matched", value=f"{year:04d}-{month:02d}-{day:02d}")


__all__ = [
    "DateResolution",
    "SelectOption",
    "SelectResolution",
    "aliases_of",
    "date_component",
    "date_values_match",
    "format_date",
    "is_date_hint",
    "is_ongoing",
    "is_placeholder",
    "meaningful_options",
    "normalize_option_text",
    "parse_date",
    "resolve_choice",
    "resolve_select_option",
    "same_phone_number",
]
