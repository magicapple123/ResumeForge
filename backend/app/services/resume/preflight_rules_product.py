# SPDX-License-Identifier: Apache-2.0
"""统一检查的**产物层**规则（W11 / P0-04、D08、D11、R03）。

这里真的渲染一遍 PDF/Word 再读回来——这是"产物检查"与"内容检查"唯一的分界：
内容层只能回答"结构化数据里有没有问题"，产物层回答"用户下载到的文件里到底有什么"。

三条硬口径：
1. **不新增导出闸门**：渲染失败只产出一条 blocker，不影响既有导出端点；
2. **隐藏对象不得泄漏**（W06）：投递产物里出现隐藏条目的任何 token 都是 blocker；
3. **双栏阅读顺序差异是已知近似**：`split` 的 PDF 顺序（左段完→右段）与草稿预览
   （上→下、左→右）结构性不同，顺序差异标 `verify`，只有**文本缺失**才是 blocker。
"""

from __future__ import annotations

from ...schemas.preflight import CheckFix, CheckIssue, CheckLocator
from ...schemas.resume import ResumeContent
from ..docx_exporter import build_resume_docx
from ..pdf_exporter import ResumePDFError
from ..pdf_exporter.fit import build_resume_pdf
from .product_text import (
    compare_text_order,
    expected_lines,
    extract_docx_text,
    extract_pdf_text,
    normalize_text,
)
from .resume_sections import DEFAULT_SECTION_ORDER
from .resume_visibility import is_hidden_entry

_MAX_EVIDENCE = 20
# 单页文本最多回 5 万字（schema 上限 20 万；正常一页远小于此）。
_MAX_PAGE_CHARS = 50_000
# 隐藏内容的"整值比对"下限（R-24 A）：单字 / 单个数字没有区分度。
_MIN_HIDDEN_LEAK_CHARS = 2


def _hidden_lines(content: ResumeContent | dict) -> list[str]:
    lines: list[str] = []
    if isinstance(content, dict):
        from .document_paths import item_value
        from .document_view import header_items, iter_entries

        for item in header_items(content):
            if item.get("placement") == "hidden" and item.get("key") != "photo":
                lines.append(str(item.get("value") or ""))
        for _key, entry in iter_entries(content):
            for item in entry.get("items") or []:
                hidden = (
                    entry.get("hidden") or item.get("hidden") or item.get("placement") == "hidden"
                )
                if hidden:
                    value = item_value(item)
                    if item.get("kind") == "authors":
                        lines.extend(str(author.get("name") or "") for author in value)
                    elif isinstance(value, list):
                        lines.extend(str(v) for v in value)
                    else:
                        lines.append(str(value))
                if item.get("kind") == "list":
                    lines.extend(str(v) for v in item.get("hidden_values") or [])
        return lines
    # 从正文分区表推导条目数组，**不要再手写第二份栏目清单**：W14 科研三栏目与
    # A4 资格证照都在 DEFAULT_SECTION_ORDER 里登记过，手写清单会让"隐藏的科研/证照
    # 条目泄漏到产物"这类 blocker 静默漏检。
    # 海象收窄：`isinstance(getattr(...), list)` 在过滤表达式里收窄不了元素类型，
    # 只有把取值绑到变量，元素才是 list。
    sections = [
        values
        for key in DEFAULT_SECTION_ORDER
        if isinstance(values := getattr(content, key, None), list)
    ]
    for section in sections:
        for item in section:
            if not is_hidden_entry(item):
                continue
            for value in item.model_dump(exclude_none=True).values():
                if isinstance(value, str) and value.strip():
                    lines.append(value)
                elif isinstance(value, list):
                    lines.extend(str(entry) for entry in value if str(entry).strip())
    return lines


def _hidden_leak_issue(
    content: ResumeContent | dict, extracted_text: str
) -> CheckIssue | None:
    """隐藏条目的文字是否**整值**出现在产物里（R-24 A）。

    上一版按 token 命中判定，而 `tokens_of` 把中文切成单字：隐藏「8 人」时，正文里
    "8 人团队"的「8」或「人」就让它报 blocker——这类误报比漏检更伤，用户会开始无视
    整块检查结果。现在的判据是**归一化后的整值子串**：
    · 归一化口径与 `normalize_text` 完全一致（去全部空白），否则 "8 人" 与 "8人"
      两副面孔会让判据时灵时不灵；
    · 整值长度 < 2（单字 / 单个数字）没有区分度，直接跳过——隐藏一个 "8" 而正文有
      "2021" 不是泄露；
    · 证据回**原文**（不回归一化后的串），用户要在纸面上找那句话。
    """
    paper = normalize_text(extracted_text)
    leaked: list[str] = []
    for line in _hidden_lines(content):
        value = normalize_text(line)
        if len(value) < _MIN_HIDDEN_LEAK_CHARS:
            continue
        if value in paper:
            leaked.append(line.strip())
    if not leaked:
        return None
    return CheckIssue(
        id="",
        layer="product",
        severity="blocker",
        code="product_hidden_leak",
        title_key="preflight.issue.product_hidden_leak",
        detail="投递产物里出现了已隐藏条目的文字",
        impact="隐藏条目必须只保留在编辑态与工程数据里，不能出现在投递文件",
        locator=CheckLocator(scope="export"),
        fix=CheckFix(action="unhide_entry", payload={}, label_key="preflight.fix.hidden_leak"),
        evidence=leaked[:_MAX_EVIDENCE],
    )


def _text_diff_issues(
    *,
    format_name: str,
    expected: list[str],
    extracted: list[tuple[int, str]],
    skip_missing: bool = False,
    font_missing: set[str] | None = None,
) -> tuple[list[CheckIssue], list[dict]]:
    """文本缺失 / 抽不到文本 / 顺序差异三类产物问题。

    两个由 R-24 引入的口径：
    · `skip_missing=True`（PDF 已超页）：正文本来就**被截断**了，此时再报"缺少 N 处正文"
      只是同一件事的第二遍叙述；只报 overflow，`garbled`（整页抽不到）仍然保留——
      它与超页无关，是真问题。
    · `font_missing` 非 None 表示字体覆盖已经检查过。某个字**字体里有、PDF 却抽不出来**
      是文本层问题（纸面可能是好的），降到 verify 并让用户去看精确预览；只有字体里
      也没有的字才是"纸面上就是个空白"的 blocker。
    """
    diffs = compare_text_order(expected, extracted)
    if not diffs:
        return [], []
    missing = [] if skip_missing else [diff for diff in diffs if diff["kind"] == "missing"]
    issues: list[CheckIssue] = []
    if missing:
        tokens = [diff["token"] for diff in missing]
        # 字体里没有这些字 → 纸面确实是空白（blocker）；字体里有 → 文本层问题（verify）。
        uncovered = (
            [token for token in tokens if font_missing is not None and set(token) & font_missing]
            if font_missing is not None
            else tokens
        )
        if uncovered:
            issues.append(
                CheckIssue(
                    id="",
                    layer="product",
                    severity="blocker",
                    code=f"product_{format_name}_text_missing",
                    title_key="preflight.issue.product_text_missing",
                    detail=f"产物里找不到 {len(uncovered)} 处正文文本",
                    impact="下载到的文件缺少这些字，招聘方看不到",
                    locator=CheckLocator(scope="export"),
                    fix=CheckFix(
                        action="open_preview_exact",
                        payload={},
                        label_key="preflight.fix.preview_exact",
                    ),
                    evidence=uncovered[:_MAX_EVIDENCE],
                )
            )
        covered = [token for token in tokens if token not in uncovered]
        if covered:
            issues.append(
                CheckIssue(
                    id="",
                    layer="product",
                    severity="verify",
                    code=f"product_{format_name}_text_unreadable",
                    title_key="preflight.issue.product_text_unreadable",
                    detail=f"有 {len(covered)} 处正文在产物里抽不到文本（字体本身包含这些字）",
                    impact="纸面可能正常，请用精确预览确认；机器解析可能读不到这几处",
                    locator=CheckLocator(scope="export"),
                    fix=CheckFix(
                        action="open_preview_exact",
                        payload={},
                        label_key="preflight.fix.preview_exact",
                    ),
                    evidence=covered[:_MAX_EVIDENCE],
                )
            )
    garbled = [diff for diff in diffs if diff["kind"] == "garbled"]
    if garbled:
        issues.append(
            CheckIssue(
                id="",
                layer="product",
                severity="verify",
                code=f"product_{format_name}_text_empty",
                title_key="preflight.issue.product_text_empty",
                detail="产物页面抽不到文本（可能是字体嵌入或渲染异常）",
                impact="机器读不到内容；请查看精确预览确认纸面是否正常",
                locator=CheckLocator(scope="export"),
                fix=CheckFix(
                    action="open_preview_exact", payload={}, label_key="preflight.fix.preview_exact"
                ),
            )
        )
    if any(diff["kind"] == "out_of_order" for diff in diffs):
        issues.append(
            CheckIssue(
                id="",
                layer="product",
                severity="verify",
                code=f"product_{format_name}_order_diff",
                title_key="preflight.issue.product_order_diff",
                detail="机器读取的文本顺序与结构化正文不同（双栏模板的已知近似）",
                impact="人工阅读不受影响；机器解析可能按列读取",
                locator=CheckLocator(scope="export"),
                fix=CheckFix(
                    action="open_preview_exact", payload={}, label_key="preflight.fix.preview_exact"
                ),
            )
        )
    return issues, diffs


def product_issues(
    content: ResumeContent | dict,
    *,
    template: str,
    page_limit: int,
    font_scale: str,
    format_config: dict | None,
    language: str,
    formats: list[str],
    font_coverage: dict | None = None,
) -> tuple[list[CheckIssue], list[dict], list[dict]]:
    """产物层：返回 (问题, machine_text, order_diffs)。只处理被点名的格式。

    `font_coverage` 是**版面层**已经算好的字体覆盖结果（`{"missing": {role: [chars]}}`）。
    产物层用它区分"纸面缺字"与"文本层抽不出"（R-24 D）：传 None = 没检查过，
    按老口径一律当缺字处理。
    """
    font_missing: set[str] | None = None
    if isinstance(font_coverage, dict) and font_coverage.get("checked"):
        font_missing = {
            char for chars in (font_coverage.get("missing") or {}).values() for char in chars or ()
        }
    expected = expected_lines(content, language=language)
    issues: list[CheckIssue] = []
    machine_text: list[dict] = []
    order_diffs: list[dict] = []

    if "pdf" in formats:
        try:
            pdf = build_resume_pdf(
                content,
                template=template,
                page_limit=page_limit,
                font_scale=font_scale,
                format_config=format_config,
                language=language,
            )
        except (ResumePDFError, ValueError) as exc:
            issues.append(
                CheckIssue(
                    id="",
                    layer="product",
                    severity="blocker",
                    code="product_pdf_render_failed",
                    title_key="preflight.issue.product_render_failed",
                    detail=str(exc)[:2000],
                    impact="无法生成 PDF；导出会直接失败",
                    locator=CheckLocator(scope="export"),
                    fix=CheckFix(
                        action="open_layout_analyze",
                        payload={},
                        label_key="preflight.fix.layout",
                    ),
                )
            )
        else:
            pages = extract_pdf_text(pdf.content)
            leak = _hidden_leak_issue(content, "".join(text for _page, text in pages))
            if leak is not None:
                issues.append(leak)
            if pdf.overflow:
                issues.append(
                    CheckIssue(
                        id="",
                        layer="product",
                        severity="blocker",
                        code="product_pdf_overflow",
                        title_key="preflight.issue.product_pdf_overflow",
                        detail=(
                            f"按当前设置约需 {pdf.pages_needed or pdf.pages} 页"
                            f"（上限 {page_limit} 页），PDF 已截断"
                        ),
                        impact="超出上限的内容不会出现在下载到的 PDF 里",
                        locator=CheckLocator(scope="export", page=pdf.pages),
                        fix=CheckFix(
                            action="add_page",
                            payload={"pages_needed": pdf.pages_needed or page_limit + 1},
                            label_key="preflight.fix.add_page",
                        ),
                    )
                )
            text_issues, diffs = _text_diff_issues(
                format_name="pdf",
                expected=expected,
                extracted=pages,
                # 超页时正文已被截断，"缺字"是同一件事的第二种说法——只报 overflow。
                skip_missing=bool(pdf.overflow),
                font_missing=font_missing,
            )
            issues.extend(text_issues)
            order_diffs.extend(diffs)
            machine_text = [{"page": page, "text": text[:_MAX_PAGE_CHARS]} for page, text in pages]

    if "docx" in formats:
        try:
            docx = build_resume_docx(
                content,
                template=template,
                page_limit=page_limit,
                font_scale=font_scale,
                format_config=format_config,
                language=language,
            )
        except (ResumePDFError, ValueError) as exc:
            issues.append(
                CheckIssue(
                    id="",
                    layer="product",
                    severity="blocker",
                    code="product_docx_render_failed",
                    title_key="preflight.issue.product_render_failed",
                    detail=str(exc)[:2000],
                    impact="无法生成 Word；导出会直接失败",
                    locator=CheckLocator(scope="export"),
                    fix=CheckFix(
                        action="open_layout_analyze",
                        payload={},
                        label_key="preflight.fix.layout",
                    ),
                )
            )
        else:
            text = extract_docx_text(docx.content)
            docx_issues, _diffs = _text_diff_issues(
                format_name="docx",
                expected=expected,
                extracted=[(1, text)],
                skip_missing=bool(docx.overflow),
                font_missing=font_missing,
            )
            issues.extend(docx_issues)
            if _diffs:
                order_diffs.extend(_diffs)
            if docx.overflow:
                issues.append(
                    CheckIssue(
                        id="",
                        layer="product",
                        severity="verify",
                        code="product_docx_overflow",
                        title_key="preflight.issue.product_docx_overflow",
                        detail=f"Word 估算超过所选 {page_limit} 页，会在 Word 里顺延",
                        impact="Word 不截断内容，只是页数与所选上限不同",
                        locator=CheckLocator(scope="export"),
                        fix=CheckFix(
                            action="add_page", payload={}, label_key="preflight.fix.add_page"
                        ),
                    )
                )
    return issues, machine_text, order_diffs


__all__ = ["product_issues"]
