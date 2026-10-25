# SPDX-License-Identifier: Apache-2.0
"""统一检查的**编排层**（W11 / P0-04、R03）：同一快照、三层合并、稳定 id。

为什么需要一个独立的编排模块：内容 / 排版 / 产物三层的输入必须是**同一份**中间结果
（正文 + 生效版式 + 字体），否则用户会看到"内容层说好的、产物层说缺字"这种自相矛盾的
面板。这里按固定顺序跑层、统一算快照指纹、给每条问题算稳定 id，然后一次返回。

**稳定 id**：`sha1(code + 规范化 locator)` 的前 12 位。前端复检时按 id 比对
"上次有、这次没有 = 已解决"，所以 id 不能带时间戳、不能随请求次序变化。

**不做模型调用**：默认三层全部本地确定性；用户显式点名 `risk` 层时才跑本地风险规则，
并在响应里如实说明模型增强是否可用（没有配置模型 ≠ 这一层通过）。
"""

from __future__ import annotations

import hashlib
import time
from typing import cast

from ...models.claim import ClaimRecord
from ...schemas.ats import ATS_DISCLAIMER
from ...schemas.preflight import (
    CheckIssue,
    CheckLocator,
    FontCoverageOut,
    MachineTextPage,
    PreflightOut,
    PreflightRequest,
    PreflightRequestLayer,
    PreflightSnapshot,
    TextOrderDiff,
)
from ...schemas.resume import ResumeContent
from .format_capabilities import matrix
from .preflight_rules_content import content_issues
from .preflight_rules_layout import layout_issues
from .preflight_rules_product import product_issues
from .resume_template_format import FONT_KEY


def _stable_issue_id(issue: CheckIssue) -> str:
    """`code + 规范化 locator` 的短指纹（12 hex）。同一问题在两次检查里 id 一致。"""
    locator = issue.locator.model_dump(exclude_none=True, exclude_defaults=True)
    parts = [issue.code]
    for key in ("scope", "section", "object_id", "point_id", "field", "path", "page"):
        value = locator.get(key)
        if value not in (None, ""):
            parts.append(f"{key}={value}")
    digest = hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()
    return digest[:12]


def _finalize(issues: list[CheckIssue]) -> list[CheckIssue]:
    for issue in issues:
        if not issue.id:
            issue.id = _stable_issue_id(issue)
    # 排序稳定：blocker → verify → suggestion；同严重度保持各层自然顺序（Python sort 稳定）。
    order = {"blocker": 0, "verify": 1, "suggestion": 2}
    return sorted(issues, key=lambda issue: order.get(issue.severity, 9))


def run_preflight(
    content: ResumeContent,
    *,
    request: PreflightRequest,
    snapshot: PreflightSnapshot,
    template: str,
    page_limit: int,
    font_scale: str,
    language: str,
    format_config: dict,
    claims: list[ClaimRecord] | None = None,
    model_configured: bool = False,
    purpose: str = "edit",
    redact: bool = False,
) -> PreflightOut:
    """按请求的层跑检查并合并。调用方负责解析记录/草稿与快照指纹。

    purpose / redact 只影响内容层的 R03 规则：导出视角（purpose=export）才提示
    "联系方式脱敏未开启"；编辑态检查保持原样。
    """
    started = time.perf_counter()
    layers = set(request.layers)
    issues: list[CheckIssue] = []
    # 规则层产出的是松散 dict（PreflightOut 构造时由 pydantic 统一校验成模型），
    # 这里按 Out 模型声明局部类型；cast 只收窄，不改任何运行时值。
    font_coverage: FontCoverageOut | None = None
    machine_text: list[MachineTextPage] = []
    order_diffs: list[TextOrderDiff] = []
    layers_run: list[PreflightRequestLayer] = []

    if "content" in layers:
        issues.extend(
            content_issues(
                content,
                jd_text=request.jd_text,
                claims=claims,
                include_risk="risk" in layers,
                purpose=purpose,
                redact=redact,
            )
        )
        layers_run.append("content")
        if "risk" in layers:
            layers_run.append("risk")
            if not model_configured:
                # 如实说"没查成"，不返回"通过"（契约 §4.3）。
                issues.append(
                    CheckIssue(
                        id="",
                        layer="content",
                        severity="suggestion",
                        code="model_not_configured",
                        title_key="preflight.issue.model_not_configured",
                        detail="没有配置模型，事实风险的模型增强部分未运行（本地规则已跑）",
                        impact="本地规则不等于完整核查",
                        locator=CheckLocator(scope="document"),
                    )
                )

    if "layout" in layers:
        layout_list, raw_font_coverage = layout_issues(
            content,
            page_limit=page_limit,
            measure=request.measure.model_dump() if request.measure else None,
            font_name=format_config.get(FONT_KEY),
        )
        issues.extend(layout_list)
        font_coverage = cast("FontCoverageOut | None", raw_font_coverage)
        layers_run.append("layout")

    if "product" in layers:
        product_list, raw_machine_text, raw_order_diffs = product_issues(
            content,
            template=template,
            page_limit=page_limit,
            font_scale=font_scale,
            format_config=format_config,
            language=language,
            formats=list(request.product_formats),
        )
        issues.extend(product_list)
        machine_text = cast("list[MachineTextPage]", raw_machine_text)
        order_diffs = cast("list[TextOrderDiff]", raw_order_diffs)
        layers_run.append("product")

    finalized = _finalize(issues)
    summary: dict[str, int] = {"blocker": 0, "verify": 0, "suggestion": 0}
    for issue in finalized:
        summary[issue.severity] = summary.get(issue.severity, 0) + 1
    capabilities = matrix()
    return PreflightOut(
        snapshot=snapshot,
        issues=finalized[:200],
        summary=summary,
        capabilities=capabilities,
        disclaimer=ATS_DISCLAIMER,
        layers_run=layers_run,
        elapsed_ms=int((time.perf_counter() - started) * 1000),
        machine_text=machine_text,
        font_coverage=font_coverage,
        order_diffs=order_diffs,
    )


__all__ = ["run_preflight"]
