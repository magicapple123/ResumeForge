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
    tokens_of,
)
from .resume_visibility import is_hidden_entry

_MAX_EVIDENCE = 20
# 单页文本最多回 5 万字（schema 上限 20 万；正常一页远小于此）。
_MAX_PAGE_CHARS = 50_000


def _hidden_lines(content: ResumeContent) -> list[str]:
    lines: list[str] = []
    for section in (
        content.education,
        content.experience,
        content.campus_experience,
        content.projects,
        content.skills,
        content.awards,
    ):
        for item in section:
            if not is_hidden_entry(item):
                continue
            for value in item.model_dump(exclude_none=True).values():
                if isinstance(value, str) and value.strip():
                    lines.append(value)
                elif isinstance(value, list):
                    lines.extend(str(entry) for entry in value if str(entry).strip())
    return lines


def _hidden_leak_issue(content: ResumeContent, extracted_tokens: set[str]) -> CheckIssue | None:
    hidden_tokens = [token for line in _hidden_lines(content) for token in tokens_of(line)]
    leaked = [token for token in hidden_tokens if token in extracted_tokens]
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
    *, format_name: str, expected: list[str], extracted: list[tuple[int, str]]
) -> tuple[list[CheckIssue], list[dict]]:
    diffs = compare_text_order(expected, extracted)
    if not diffs:
        return [], []
    missing = [diff for diff in diffs if diff["kind"] == "missing"]
    issues: list[CheckIssue] = []
    if missing:
        tokens = [diff["token"] for diff in missing]
        issues.append(
            CheckIssue(
                id="",
                layer="product",
                severity="blocker",
                code=f"product_{format_name}_text_missing",
                title_key="preflight.issue.product_text_missing",
                detail=f"产物里找不到 {len(missing)} 处正文文本",
                impact="下载到的文件缺少这些字，招聘方看不到",
                locator=CheckLocator(scope="export"),
                fix=CheckFix(
                    action="open_preview_exact", payload={}, label_key="preflight.fix.preview_exact"
                ),
                evidence=tokens[:_MAX_EVIDENCE],
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
    content: ResumeContent,
    *,
    template: str,
    page_limit: int,
    font_scale: str,
    format_config: dict | None,
    language: str,
    formats: list[str],
) -> tuple[list[CheckIssue], list[dict], list[dict]]:
    """产物层：返回 (问题, machine_text, order_diffs)。只处理被点名的格式。"""
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
            extracted_tokens: set[str] = set()
            for _page, text in pages:
                extracted_tokens.update(tokens_of(text))
            leak = _hidden_leak_issue(content, extracted_tokens)
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
                format_name="pdf", expected=expected, extracted=pages
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
                format_name="docx", expected=expected, extracted=[(1, text)]
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
