# SPDX-License-Identifier: Apache-2.0
"""planner 的格式化助手：把 v2 item 的规范值变成带角色的 Inline 段（D7）。

唯一原则：日期/枚举/列表/作者/URL 的显示格式只在这里做一次。HTML/PDF/Word/Markdown
四个出口只画 Inline 段，不再各自拼字符串（v1 的四处重复拼装正是"预览一个样、导出另一个样"
的根源）。语言切换只影响这里取的语言包，不动数据。
"""

from __future__ import annotations

from ...schemas.resume_document import (
    AuthorsItem,
    BodyStyle,
    FieldItem,
    Inline,
    ListItem,
    ResumeItem,
    TextItem,
)
from . import document_catalog as catalog
from .resume_labels import (
    CREDENTIAL_STATUS_LABELS,
    EXPERIENCE_KIND_LABELS,
    PATENT_STATUS_LABELS,
    PUBLICATION_STATUS_LABELS,
    credential_status_text,
    date_range,
    experience_kind_text,
    field_labels,
    list_separator,
    normalize_language,
    patent_status_text,
    publication_status_text,
)

__all__ = [
    "authors_inlines",
    "body_style_of",
    "enum_text",
    "field_label_text",
    "item_inlines",
    "item_path",
    "join_values",
    "normalized_date_range",
    "plain_text",
    "wants_paren",
]

_PRESENT_MARKERS = frozenset(("present", "至今", "现在", "now"))

_ENUM_BY_KEY: dict[str, str] = {
    "experience_kind": "experience_kind",
}


def item_path(section_key: str, entry_id: str, item_id: str) -> str:
    return section_key + "." + entry_id + "." + item_id


#: 四族枚举词表（A5 的跨家族兜底用；顺序无关）。
_ENUM_LABEL_MAPS = (
    PUBLICATION_STATUS_LABELS,
    PATENT_STATUS_LABELS,
    CREDENTIAL_STATUS_LABELS,
    EXPERIENCE_KIND_LABELS,
)


def _custom_enum_text(value: str, language: str) -> str | None:
    """自建板块 / 自定义枚举字段的纸面文案（A5）：目录里没有 enum_kind 时按值兜底。

    只在**四张已知词表对同一个 code 给出同一个显示名**时才翻译；像 pending 这种
    在论文 / 专利 / 证书里含义不同的歧义值一律不猜，交回原值——把「审稿中」写成
    「待核实」比露 code 更糟。
    """
    normalized = normalize_language(language)
    displays = {
        labels[normalized][value]
        for labels in _ENUM_LABEL_MAPS
        if labels[normalized].get(value)
    }
    return displays.pop() if len(displays) == 1 else None


def enum_text(item: FieldItem, enum_kind: str, language: str) -> str:
    """枚举字段的显示文案（事实锁词表唯一来源在 resume_labels）。"""
    kind = enum_kind
    if kind == "publication_status":
        return publication_status_text(item.value, language)
    if kind == "patent_status":
        return patent_status_text(item.value, language)
    if kind == "credential_status":
        return credential_status_text(item.value, language)
    if kind == "experience_kind":
        return experience_kind_text(item.value, language) or item.value
    if not kind:
        # A5：自建板块 / 自定义枚举字段的目录项没有 enum_kind，纸面此前直接露 code。
        return _custom_enum_text(item.value, language) or item.value
    return item.value


def field_label_text(
    item: FieldItem | ListItem | AuthorsItem, section_key: str, language: str
) -> str:
    """字段标签：item.label 覆盖目录（自定义字段），空则按目录取。"""
    explicit = str(item.label or "").strip()
    if explicit:
        return explicit
    return catalog.field_label(section_key, getattr(item, "key", ""), language)


def join_values(values: list[str], join: str, language: str, *, path: str = "") -> list[Inline]:
    """列表值 -> Inline 段（分隔符按 join 与语言）。

    **每个值段都带 item path**（2026-10-31 Q27）：列表在纸面上是多个 span，点其中任意
    一个值都应该定位回同一个 item；分隔符不是字段本体，path 留空。
    """
    if join == "dot":
        separator = " · "
    elif join == "semicolon":
        separator = "；" if normalize_language(language) == "zh-CN" else "; "
    elif join == "inline":
        separator = " "
    else:
        separator = list_separator(language)
    segments: list[Inline] = []
    for index, value in enumerate(values):
        if index:
            segments.append(Inline(text=separator, role="meta"))
        segments.append(Inline(text=value, role="meta", path=path))
    return segments


def normalized_date_range(raw: str, language: str) -> str:
    """start|end -> 日期区间文案；end 为空只显示 start，end=present 显示「至今」。"""
    text = str(raw or "").strip()
    if "|" not in text:
        return text
    start, _, end = text.partition("|")
    start = start.strip()
    end = end.strip()
    if end.lower() in _PRESENT_MARKERS or end in _PRESENT_MARKERS:
        end = field_labels(language).get("present", "至今")
    if not start:
        return end
    if not end:
        return start
    return date_range(start, end)


def authors_inlines(item: AuthorsItem, language: str, *, path: str = "") -> list[Inline]:
    """作者列表 -> Inline：顺序即署名顺序；本人 strong、通讯作者追加星号。

    与列表值同理（Q27）：每个作者名都带同一个 item path，点任一作者署名都能定位回
    这条作者字段；分隔符与通讯作者星号是装饰，path 留空。
    """
    separator = list_separator(language)
    segments: list[Inline] = []
    emitted = False
    for author in item.authors:
        name = str(author.name or "").strip()
        if not name:
            continue
        if emitted:
            segments.append(Inline(text=separator, role="meta"))
        segments.append(Inline(text=name, role="meta", strong=bool(author.is_self), path=path))
        if author.corresponding:
            segments.append(Inline(text="*", role="meta"))
        emitted = True
    return segments


def wants_paren(item: ResumeItem) -> bool:
    """这条 item 的值是否要包一层括号（``wrap == "paren"``）。

    ``wrap`` 是 **FieldItem 独有**的字段（ListItem / AuthorsItem 没有它：列表值与作者名
    本来就是多值拼接，套括号没有意义）。以前在 planner 里直接写 ``item.wrap``，一旦有
    用户把列表字段拖到 body / inline 板块（placement 是用户数据，拖拽就能改）就会
    AttributeError 打成 500；这里统一判型，非字段项一律"不加括号"。
    """
    return isinstance(item, FieldItem) and item.wrap == "paren"


def body_style_of(item: ResumeItem) -> BodyStyle:
    """正文块的样式（bullet / paragraph）。

    ``body_style`` 只有 FieldItem 与 ListItem 有（AuthorsItem 没有：作者名永远排一行），
    缺省与 FieldItem 的默认值一致取 ``bullet``——同样避免"AuthorsItem 被拖到 body"
    时 ``item.body_style`` 打成 500。
    """
    return item.body_style if isinstance(item, (FieldItem, ListItem)) else "bullet"


def item_inlines(
    item: ResumeItem,
    section_key: str,
    entry_id: str,
    language: str,
    *,
    show_label: bool | None = None,
    role: str = "meta",
    wrap_paren: bool = False,
) -> list[Inline]:
    """一条 item -> Inline 段（含可选「标签：值」前缀、括号包围与稳定 path）。"""
    lang = normalize_language(language)
    path = item_path(section_key, entry_id, item.id)
    if isinstance(item, TextItem):
        return [Inline(text=item.text, role="body", path=path)]
    label_text = field_label_text(item, section_key, lang)
    want_label = item.show_label if show_label is None else show_label
    body: list[Inline] = []
    if isinstance(item, FieldItem):
        if item.format == "date_range":
            display = normalized_date_range(item.value, lang)
        elif item.format == "enum":
            spec = catalog.field_spec(section_key, item.key)
            kind = spec.enum_kind if spec is not None else ""
            display = enum_text(item, kind, lang)
        else:
            display = item.value
        body = [
            Inline(
                text=display,
                role=role,
                link=item.value if item.format == "url" else None,
                path=path,
            )
        ]
    elif isinstance(item, ListItem):
        body = join_values(item.values, item.join, lang, path=path)
    else:
        body = authors_inlines(item, lang, path=path)
    segments: list[Inline] = []
    if want_label and label_text:
        # 标签不是可点击的字段本体：path 留空。定位粒度是 item——列表值/作者名这类
        # 多值字段的每个值段共享同一 item path（见 join_values / authors_inlines）。
        segments.append(Inline(text=label_text + "：", role="meta", path=""))
    if wrap_paren and wants_paren(item):
        from .resume_labels import level_parens

        before, after = level_parens(lang)
        segments.append(Inline(text=before, role=role, path=""))
        segments.extend(body)
        segments.append(Inline(text=after, role=role, path=""))
    else:
        segments.extend(body)
    return segments


def plain_text(segments: list[Inline]) -> str:
    """Inline 段拼成纯文本（Markdown/TXT/文本等价对拍用）。"""
    return "".join(segment.text for segment in segments)
