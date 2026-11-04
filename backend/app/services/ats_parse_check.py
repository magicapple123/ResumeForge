# SPDX-License-Identifier: Apache-2.0
"""ATS 的**产物解析检查**（真实 PDF 能不能被读出来）。

真实 ATS 失败的头号原因不是关键词，而是**解析**：扫描件、图片化导出、双栏、特殊符号都会让
简历变乱序文字甚至空文本。这一层不看结构化 ``content``，而是真的渲染一遍 PDF、用 pypdf 把
文字层读回来，再和原文比对——测的是"用户交出去的那份文件"，不是"数据库里那份数据"。

四项检查（全部纯本地、确定性，不调模型）：

1. 文本可提取性：提取字符数 / 原文字符数；
2. 关键字段可提取：姓名 / 手机 / 邮箱 / 学校 / 公司；
3. 阅读顺序：复用 ``product_text.compare_text_order`` 的 ``out_of_order`` 差异；
4. 字符丢失率：联系方式里 ``.`` / ``@`` 这类字符丢失即视为"联系方式失效"。

**不是强制流程**：这里即时渲染到内存、用完即弃，不要求用户先导出一次、也不落盘。渲染不可
用（缺中文字体、渲染超预算）时返回空列表并记一条 debug 日志——ATS 检查本身必须仍然可用。
"""

from __future__ import annotations

import logging

from ..schemas.ats import AtsIssue
from ..schemas.resume import ResumeContent
from ..schemas.resume_generation import LONG_CV_MAX_PAGES
from .pdf_exporter.fit import build_resume_pdf
from .resume.document_view import header_text
from .resume.product_text import (
    compare_text_order,
    expected_lines,
    extract_pdf_text,
    normalize_text,
)

logger = logging.getLogger(__name__)

# 提取字符占原文的比例：低于下限视为"文本层为空"（图片型 PDF），低于上限视为"有缺失"。
_EMPTY_TEXT_RATIO = 0.15
_TEXT_LOSS_RATIO = 0.7
# 乱序 token 达到这个数量才报"阅读顺序错乱"：PDF 的换行本来就会造成零星的顺序抖动。
_MIN_OUT_OF_ORDER = 3
_MAX_EVIDENCE = 5


def _blank(value: str) -> bool:
    return not value or not value.strip()


def _key_fields(resume: ResumeContent | dict) -> list[tuple[str, str]]:
    """关键字段的 (标签, 值) 清单；空值不收。"""
    if isinstance(resume, dict):
        labels = (("name", "姓名"), ("phone", "手机"), ("email", "邮箱"))
        return [
            (label, header_text(resume, key))
            for key, label in labels
            if header_text(resume, key).strip()
        ]
    fields: list[tuple[str, str]] = [
        ("姓名", resume.name),
        ("手机", resume.phone),
        ("邮箱", resume.email),
        ("学校", resume.education[0].school if resume.education else ""),
        ("公司", resume.experience[0].company if resume.experience else ""),
    ]
    return [(label, value) for label, value in fields if not _blank(value)]


def _paper_lines(resume: ResumeContent | dict) -> list[str]:
    """纸面顺序的文本行：走文档计划（模板里各分区的真实先后），拿不到就退回字段顺序。

    为什么要文档计划而不是 `expected_lines` 的模型分支：模型分支按字段硬编码顺序排列
    （个人总结在教育经历之前），与模板实际排出来的顺序不同，直接拿来比顺序会把**每一份
    正常简历**都判成"阅读顺序错乱"。
    """
    try:
        from .resume.document_html import coerce_document, paper_document
        from .resume.document_plan import build_document_plan, plan_to_text

        plan = build_document_plan(paper_document(coerce_document(resume)))
        return plan_to_text(plan)
    except Exception as exc:  # noqa: BLE001 - 文档结构异常时退回字段顺序，不阻断检测
        logger.debug("ATS 解析检查：文档计划不可用（%s），退回字段顺序", type(exc).__name__)
        return expected_lines(resume)


def _render_text(resume: ResumeContent | dict) -> list[tuple[int, str]] | None:
    """渲染 PDF 并抽回每页文字；渲染不可用时返回 None（调用方按"不检查"处理）。"""
    try:
        pdf = build_resume_pdf(resume, page_limit=LONG_CV_MAX_PAGES)
    except Exception as exc:  # noqa: BLE001 - 缺字体/超预算/内容非法都不该让 ATS 检测失败
        logger.debug("ATS 解析检查跳过：PDF 渲染不可用（%s）", type(exc).__name__)
        return None
    pages = extract_pdf_text(pdf.content)
    if not pages:
        logger.debug("ATS 解析检查跳过：PDF 文本抽取不可用")
        return None
    return pages


def _extractability_issue(source_chars: int, extracted_chars: int) -> AtsIssue | None:
    if source_chars <= 0:
        return None
    ratio = extracted_chars / source_chars
    percent = round(ratio * 100)
    if ratio < _EMPTY_TEXT_RATIO:
        return AtsIssue(
            category="format",
            severity="high",
            title="PDF 文本层为空",
            detail=(
                f"生成的 PDF 只提取到 {extracted_chars} 个字符（原文 {source_chars} 个），"
                "文本层接近空，ATS 会把这份简历读成空文件"
            ),
            evidence=[f"提取率 {percent}%"],
            suggestion="导出时用文字层导出的 PDF，不要用「打印成图片」或扫描件转成的 PDF。",
        )
    if ratio < _TEXT_LOSS_RATIO:
        return AtsIssue(
            category="format",
            severity="medium",
            title="PDF 文本有缺失",
            detail=(
                f"生成的 PDF 只提取到原文 {percent}% 的字符，"
                "部分内容不在文本层里，ATS 读到的简历是不完整的"
            ),
            evidence=[f"提取率 {percent}%"],
            suggestion="减少文本框与图形转文字，正文尽量用普通段落排版后再导出。",
        )
    return None


def _missing_field_issue(
    extracted_normalized: str, fields: list[tuple[str, str]]
) -> AtsIssue | None:
    """关键字段在提取文本里找不到：联系方式单列成 high，其余合并成 medium。"""
    lost_contact: list[str] = []
    lost_other: list[str] = []
    for label, value in fields:
        if normalize_text(value) in extracted_normalized:
            continue
        (lost_contact if label in {"手机", "邮箱"} else lost_other).append(label)
    if lost_contact:
        return AtsIssue(
            category="format",
            severity="high",
            title="PDF 联系方式不可提取",
            detail=(
                f"{'、'.join(lost_contact)}在 PDF 文本层里找不到，"
                "联系方式一旦丢失，ATS 与 HR 都无法联系到候选人"
            ),
            evidence=lost_contact,
            suggestion="把手机号与邮箱写成纯文本（不要放进图片、图标或艺术字里）后再导出。",
        )
    if lost_other:
        return AtsIssue(
            category="format",
            severity="medium",
            title="PDF 关键字段不可提取",
            detail=(
                f"{'、'.join(lost_other)}在 PDF 文本层里找不到，"
                "ATS 按这些字段建立候选人档案，缺失会导致字段为空"
            ),
            evidence=lost_other,
            suggestion="关键字段用普通文本排版，不要放进表格单元格外或作为背景文字。",
        )
    return None


def _order_issue(diffs: list[dict]) -> AtsIssue | None:
    """阅读顺序：产物里的顺序与结构化内容的顺序不一致（双栏/文本框常见）。"""
    out_of_order = [diff for diff in diffs if diff.get("kind") == "out_of_order"]
    if len(out_of_order) < _MIN_OUT_OF_ORDER:
        return None
    tokens = [str(diff.get("token", "")) for diff in out_of_order[:_MAX_EVIDENCE]]
    return AtsIssue(
        category="format",
        severity="medium",
        title="PDF 阅读顺序可能错乱",
        detail=(
            f"有 {len(out_of_order)} 处内容在 PDF 文本层里的顺序与版面顺序不一致，"
            "双栏或文本框排版会让 ATS 把段落读串"
        ),
        evidence=tokens,
        suggestion="改用单栏线性排版，或把双栏内容拆成上下两段后再导出。",
    )


def parse_check_issues(resume: ResumeContent | dict) -> list[AtsIssue]:
    """检查"导出的 PDF 能否被解析"，返回问题清单（不可用时为空）。"""
    lines = _paper_lines(resume)
    source_normalized = normalize_text("".join(lines))
    if not source_normalized:
        return []
    pages = _render_text(resume)
    if pages is None:
        return []
    extracted_normalized = normalize_text("".join(text for _page, text in pages))
    extractability = _extractability_issue(len(source_normalized), len(extracted_normalized))
    if extractability is not None and extractability.title == "PDF 文本层为空":
        # 文本层为空时字段与顺序必然全丢，报三条只会让用户以为是三个问题。
        return [extractability]
    issues: list[AtsIssue] = []
    if extractability is not None:
        issues.append(extractability)
    field_issue = _missing_field_issue(extracted_normalized, _key_fields(resume))
    if field_issue is not None:
        issues.append(field_issue)
    order_issue = _order_issue(compare_text_order(lines, pages))
    if order_issue is not None:
        issues.append(order_issue)
    return issues


__all__ = ["parse_check_issues"]
