# SPDX-License-Identifier: Apache-2.0
"""篇幅上限的全格式裁剪（问题 1-D 方案 A）：把「最大篇幅」真的变成**内容预算**。

为什么要有这个模块
------------------
``page_limit`` 以前只是"PDF 的页数上限"：PDF 走 ``pdf_exporter.fit`` 真渲染 +
``truncate_pdf`` 硬裁，Word 只标记 overflow（Word 自己顺延页数、一个字都不丢），HTML 只把
body 钉成 N 页高、内容照旧溢出，TXT / Markdown 连参数都不收。界面文案叫「最大篇幅」，
语义是统一的 —— 承诺与实现不一致（用户选「1 页」，Word / HTML / TXT 把全部内容导出来）。

裁定（方案 A）是**全格式统一裁剪**，唯一收口在 ``export_pipeline.build_export``；本模块只
提供纯函数，不认识 HTTP、不落库、不改记录：

- :func:`truncate_document_to_page_limit`：真渲染一次 PDF 拿 ``pages_needed`` 与 ``spans``，
  超限时取**第一条**越界 ``span`` 的 ``(kind, section, object_id, point_index)`` 作裁点，
  按**整块**裁（``point`` → 该要点及其后；``entry`` → 该条目及其后；``section`` → 该板块
  及其后），绝不切半句。
- :func:`truncate_for_format`：上面那条 + Word 的二次收敛（最多 3 轮）。

裁点必须与 PDF **同源**：用的是 ``build_resume_pdf`` 的 ``spans``（与
``document_pagination._truncated_at`` 同一份判据），不另写一套文字测量——否则"报告裁在
哪里"与"实际裁在哪里"会各说各话。

不可根除的取舍（交付说明必须照写）
--------------------------------
- 裁点按 **PDF 版式**计算，Word 自己的分页引擎可能差半页 → 只能保证"估算 ≤ 上限"，
  Word 打开仍可能多出半页。这归因于 Word 自己的排版引擎，**无法根除**。
- 裁掉的是**整块**内容，不会出现半句；但单条要点本身超过整页时，会**整条丢掉**
  （与 PDF 现在的行为一致）。
- 非 PDF 格式每次多跑一次 PDF 渲染（≈0.3–0.6s，字体缓存热）。本地单用户可接受；后续
  可缓存 ``(content_sha256, render_config_sha256)`` 的页数结论。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, replace
from typing import Any, Protocol

from ...schemas.resume_document import (
    AuthorsItem,
    ListItem,
    ResumeDocument,
    ResumeEntry,
    ResumeSection,
    TextItem,
    document_to_json,
    normalize_document,
)
from ...schemas.resume_generation import LONG_CV_MAX_PAGES
from ..pdf_exporter import build_resume_pdf
from ..pdf_exporter.fonts import ResumePDFError
from .document_html import coerce_document
from .resume_labels import normalize_language

logger = logging.getLogger(__name__)

#: Word 二次收敛的最大轮数（每轮 = 建一次 docx + 估一次页数）。
#: 3 轮的依据：第 1 轮裁到 PDF 的裁点、第 2/3 轮吃掉"连续流估算比真实分页多算"的偏差；
#: 再多轮也收敛不了时，差异已经属于 Word 自己的排版引擎，继续裁只会白丢内容。
MAX_DOCX_ROUNDS = 3

#: ``spans`` 里可作裁点的三类语义块（``meta`` 是页头联系方式，不是可裁的块）。
_CUTTABLE_KINDS = frozenset(("point", "entry", "section"))


class PageLimitContext(Protocol):
    """本模块需要的版式上下文（``export_pipeline.RenderContext`` 结构上满足它）。

    **不用 import RenderContext**：``export_pipeline`` 会 import 本模块，反向 import 会成环；
    这里只要结构一致（鸭子类型），测试也能直接传一个轻量替身。

    成员声明成**只读属性**：``RenderContext`` 是 frozen dataclass，可写字段的协议它满足
    不了（类型检查器会判"协议的字段可写、传入的不可写"）。
    """

    @property
    def page_limit(self) -> int: ...

    @property
    def page_limit_is_unlimited(self) -> bool: ...

    @property
    def template(self) -> str: ...

    @property
    def font_scale(self) -> str: ...

    @property
    def format_config(self) -> dict | None: ...

    @property
    def margin_mm(self) -> float | None: ...

    @property
    def include_photo(self) -> bool: ...

    @property
    def language(self) -> str: ...


@dataclass(frozen=True)
class CutDescriptor:
    """裁点：从哪一块开始不进文件（与 ``document_pagination._truncated_at`` 同形）。"""

    kind: str
    section: str
    object_id: str | None = None
    point_index: int | None = None
    text_preview: str = ""

    def header_value(self) -> str:
        """响应头 ``X-Resume-Truncated-At`` 的值：``section/object_id``（无 id 时只有 section）。"""
        return f"{self.section}/{self.object_id}" if self.object_id else self.section


@dataclass(frozen=True)
class TruncationResult:
    """裁剪结论。

    ``document`` 是**要交给渲染器的那一份**：没裁时就是调用方传进来的原对象（同一引用，
    零复制）；裁过时是裁剪后的 v2 文档 dict。``pages_needed`` 记的是**裁前**的真实需求
    页数（界面用它说"按当前设置约需 N 页"），``docx`` 只在 Word 收敛路径里非空（那份产物
    已经建好，管线直接复用，不重复建第二遍）。
    """

    document: Any
    pages_needed: int | None = None
    truncated: bool = False
    cut: CutDescriptor | None = None
    rounds: int = 0
    docx: Any | None = None


def _limit_of(context: PageLimitContext) -> int:
    """生效的页数上限：与 ``build_resume_pdf`` / ``build_resume_docx`` 同一个夹紧口径。"""
    return max(1, min(int(context.page_limit), LONG_CV_MAX_PAGES))


def _unlimited(context: PageLimitContext) -> bool:
    """用户选了「不限篇幅」：不裁、不测量（``mode_page_limit(0)`` 折成 10 只是渲染保护）。"""
    return bool(getattr(context, "page_limit_is_unlimited", False))


def _measure(document, context: PageLimitContext) -> tuple[int, tuple]:
    """真渲染一次 PDF：返回（自然需要几页, 绘制日志）。与导出 PDF 是同一趟排版。"""
    pdf = build_resume_pdf(
        document,
        template=context.template,
        page_limit=_limit_of(context),
        font_scale=context.font_scale,
        format_config=context.format_config,
        margin_mm=context.margin_mm,
        include_photo=context.include_photo,
        language=context.language,
    )
    needed = pdf.pages_needed if pdf.pages_needed is not None else pdf.pages
    return int(needed or 1), tuple(pdf.spans or ())


def _find_cut(spans: tuple, limit: int) -> CutDescriptor | None:
    """第一条落在**页数上限之后**的可裁块（绘制顺序即阅读顺序）。"""
    for span in spans:
        page = int(getattr(span, "page", 0) or 0)
        if page <= limit:
            continue
        kind = str(getattr(span, "kind", "") or "")
        if kind not in _CUTTABLE_KINDS:
            continue
        section = str(getattr(span, "section", "") or "")
        if not section:
            continue
        return CutDescriptor(
            kind=kind,
            section=section,
            object_id=getattr(span, "object_id", None),
            point_index=getattr(span, "point_index", None),
            text_preview=str(getattr(span, "text", "") or ""),
        )
    return None


def _is_body_item(item) -> bool:
    """这条 item 会不会在正文块里印出来（与 ``document_plan._body_blocks`` 同一判据）。"""
    if isinstance(item, TextItem):
        return not item.hidden and bool(str(item.text or "").strip())
    return str(getattr(item, "placement", "") or "") == "body"


def _item_text(item) -> str:
    """item 的近似纸面文字：只用于**核对**裁点，不参与排版计算。"""
    if isinstance(item, TextItem):
        return str(item.text or "")
    label = str(getattr(item, "label", "") or "")
    if isinstance(item, ListItem):
        return label + " ".join(str(value or "") for value in item.values)
    if isinstance(item, AuthorsItem):
        return label + " ".join(str(getattr(author, "name", "") or "") for author in item.authors)
    return label + str(getattr(item, "value", "") or "")


def _squeeze(text: str) -> str:
    """去掉全部空白再比：折行、缩进、全角空格都不该让裁点定位失败。"""
    return "".join(str(text or "").split())


def _text_matches(item_text: str, preview: str) -> bool:
    """裁点文字与 item 文字是否同一条（``spans.text`` 只截前 120 字，故双向包含）。"""
    left, right = _squeeze(item_text), _squeeze(preview)
    if not left or not right:
        return False
    return right in left or left in right


def _locate_item(entry: ResumeEntry, cut: CutDescriptor) -> int | None:
    """在条目里定位裁点那一**条**（返回 ``entry.items`` 的下标）。

    ``spans.point_index`` 是"本批 bullets 内的序号"（连续 bullet 段才会从 0 重新计数），
    直接当 ``items`` 下标会错位，因此先用它做候选、再用文字双向核对；核对不通过就退回
    纯文字定位。两者都失败时返回 None（调用方退到"该条目及其后"，仍是整块裁）。
    """
    body = [index for index, item in enumerate(entry.items) if _is_body_item(item)]
    if not body:
        return None
    preview = cut.text_preview
    if cut.point_index is not None and 0 <= int(cut.point_index) < len(body):
        candidate = body[int(cut.point_index)]
        if not preview or _text_matches(_item_text(entry.items[candidate]), preview):
            return candidate
    for index in body:
        if _text_matches(_item_text(entry.items[index]), preview):
            return index
    return None


def _section_slice(section: ResumeSection, entries: list[ResumeEntry]) -> list[ResumeSection]:
    """裁后的板块：还有条目就留下（只留标题等于留了个空壳），否则整个丢掉。"""
    return [section.model_copy(update={"entries": entries})] if entries else []


def _finish(document: ResumeDocument, sections: list[ResumeSection]) -> ResumeDocument | None:
    """收尾：空条目/空板块归一化后仍要有内容，否则整份不裁（**裁空保护**）。"""
    if not sections:
        return None
    normalized = normalize_document(document.model_copy(update={"sections": sections}))
    return normalized if normalized.sections else None


def _cut_document(document: ResumeDocument, cut: CutDescriptor) -> ResumeDocument | None:
    """按裁点整块裁掉尾部；返回裁后文档，定位不到或会裁空时返回 None。"""
    sections = list(document.sections)
    index = next((i for i, section in enumerate(sections) if section.key == cut.section), None)
    if index is None:
        return None
    section = sections[index]
    head = sections[:index]

    if cut.kind == "section":
        return _finish(document, head)

    entries = list(section.entries)
    entry_index = (
        next((i for i, entry in enumerate(entries) if entry.id == cut.object_id), None)
        if cut.object_id
        else None
    )
    if entry_index is None:
        return None
    kept = entries[:entry_index]

    if cut.kind == "entry":
        return _finish(document, head + _section_slice(section, kept))

    entry = entries[entry_index]
    item_index = _locate_item(entry, cut)
    if item_index is None:
        # 定位不到那一条要点：退到"该条目及其后"。仍是整块裁，绝不切半句。
        logger.info(
            "篇幅上限：裁点 %s 在条目 %s 里定位不到，按整条裁掉",
            cut.header_value(),
            cut.object_id,
        )
        return _finish(document, head + _section_slice(section, kept))
    items = list(entry.items)[:item_index]
    if items:
        kept = kept + [entry.model_copy(update={"items": items})]
    return _finish(document, head + _section_slice(section, kept))


def truncate_document_to_page_limit(
    document: Any,
    context: PageLimitContext,
) -> TruncationResult:
    """按篇幅上限裁掉**尾部整块内容**（单趟：一次 PDF 测量 + 一刀）。

    ``document`` 接受 v1 模型 / v1 dict / v2 dict（渲染器本来就接受这三样）：内部统一
    ``coerce_document`` 成 v2 再改，裁后以 v2 dict 返回——四个渲染器对 v2 dict 的处理与
    "先 coerce 再渲染"逐字相同，所以裁与不裁走的是同一套排版。

    返回的 ``document`` 在"不需要裁"/"测不出页数"/"定位不到裁点"/"会裁空"这四种情况下是
    **原对象本身**，调用方据此知道文件内容没有被改动（``truncated`` 为假）。
    """
    if _unlimited(context):
        return TruncationResult(document=document)
    limit = _limit_of(context)
    model = coerce_document(
        document,
        language=normalize_language(getattr(context, "language", None)),
        format_config=context.format_config,
    )
    try:
        needed, spans = _measure(model, context)
    except ResumePDFError:
        # 没有中文字体等：测不出页数 ≠ 装得下，也不该凭空报溢出（与 docx 的既有口径一致）。
        logger.warning("篇幅上限：无法渲染测量页数，本次不裁剪", exc_info=True)
        return TruncationResult(document=document)
    if needed <= limit:
        return TruncationResult(document=document, pages_needed=needed)
    cut = _find_cut(spans, limit)
    if cut is None:
        logger.info("篇幅上限：需要 %s 页但找不到裁点，本次不裁剪", needed)
        return TruncationResult(document=document, pages_needed=needed)
    truncated = _cut_document(model, cut)
    if truncated is None:
        logger.info("篇幅上限：裁点 %s 会裁空内容，本次不裁剪", cut.header_value())
        return TruncationResult(document=document, pages_needed=needed)
    return TruncationResult(
        document=document_to_json(truncated),
        pages_needed=needed,
        truncated=True,
        cut=cut,
    )


def _build_docx(document: Any, context: PageLimitContext):
    """建一份 Word 产物（延迟 import：本模块的纯函数测试不必拉起 python-docx）。"""
    from ..docx_exporter import build_resume_docx

    return build_resume_docx(
        document,
        template=context.template,
        page_limit=_limit_of(context),
        font_scale=context.font_scale,
        format_config=context.format_config,
        margin_mm=context.margin_mm,
        include_photo=context.include_photo,
        language=context.language,
    )


def truncate_for_format(
    document: Any,
    context: PageLimitContext,
    *,
    export_format: str,
    max_rounds: int = MAX_DOCX_ROUNDS,
) -> TruncationResult:
    """按目标格式裁剪：pdf / json 直通，其余格式裁一次，Word 再收敛（最多 3 轮）。

    Word 的 ``pages`` 是连续流估算（±1），裁过之后仍可能报超限，所以用下一个裁点再裁一刀
    重建；**最多 ``max_rounds`` 轮**，仍超就保留内容（不许死循环、不许把条目删空），由
    ``docx.overflow`` 如实回 ``X-Resume-Overflow: true``。
    """
    if export_format in ("pdf", "json"):
        # pdf 由 fit.py 内部真渲染 + truncate_pdf 兜底（不再多测一次）；json 是数据交付物。
        return TruncationResult(document=document)
    first = truncate_document_to_page_limit(document, context)
    if export_format != "docx" or _unlimited(context):
        return first

    limit = _limit_of(context)
    rounds = max(1, int(max_rounds))
    current = first
    built = None
    builds = 0
    for _ in range(rounds):
        built = _build_docx(current.document, context)
        builds += 1
        pages = built.pages
        if pages is None or int(pages) <= limit:
            break
        if builds >= rounds:
            # 最后一轮：再裁一刀也不会重建，那一刀只会让 ``document`` 与 ``docx`` 对不上。
            # 保留内容并把 overflow 如实带回去，由界面提示"Word 里可能多出半页"。
            break
        further = truncate_document_to_page_limit(current.document, context)
        if not further.truncated:
            # 没有更早的裁点了（或再裁就空了）：保留现有内容，只把 overflow 如实带回去。
            break
        current = replace(
            current,
            document=further.document,
            truncated=True,
            cut=further.cut or current.cut,
        )
    return replace(current, docx=built, rounds=builds)


__all__ = [
    "CutDescriptor",
    "MAX_DOCX_ROUNDS",
    "PageLimitContext",
    "TruncationResult",
    "truncate_document_to_page_limit",
    "truncate_for_format",
]
