# SPDX-License-Identifier: Apache-2.0
"""简历质量工具（T29）：质量检测 / ATS 匹配 / 统一检查 / 版本对比，全部只读。

四条能力都是**本地确定性**的，不调远端模型、不改任何数据：

- ``run_resume_quality_check``：只走 ``resume_risk_rules.scan_local``（五类本地规则）。
  **绝不**走 ``resume_risk.scan_resume_risks``——那条编排会在有模型时做远端增强；
- ``check_ats_match``：走 ``ats_check.check_ats``（本地启发式），结果强制带免责文案；
- ``get_resume_preflight``：走 ``resume.preflight.run_preflight``（内容/排版/产物三层
  本地规则，包含真实渲染的产物层），按「必须解决 / 需核对 / 排版建议」分组；
- ``compare_resume_versions``：走 ``document_versions.compare_versions``（本地 diff）。

返回一律**截断**：摘要 + 每组前 5 条明细，不把整份简历/整段原文塞进对话上下文。
"""

from __future__ import annotations

import json

from sqlalchemy.orm import Session

from ...models.claim import ClaimRecord
from ...models.job import Job
from ...schemas.job import JobOut
from ...schemas.preflight import PreflightRequest, PreflightSnapshot
from ...schemas.versions import VersionCompareOut
from .. import trash
from ..ats_check import check_ats
from ..profile.profile_relevance import build_job_prompt_text
from ..resume.document_versions import VersionNotFound, compare_versions
from ..resume.preflight import run_preflight
from ..resume.resume_delivery import canonical_content_sha256
from ..resume.resume_risk_rules import scan_local
from ._shared import MAX_JOB_RESULT_CHARS, _trim, int_argument
from ._types import ToolResult
from .document_support import (
    MAX_RESULT_CHARS,
    document_for,
    record_or_error,
    render_settings,
)

# 每个工具最多返回多少条明细（T29 要求 N ≤ 5）。
MAX_ITEMS = 5
# 单段自由文本（命中原文/建议/位置）的截断上限。
MAX_TEXT_CHARS = 200
# 版本对比最多返回多少行正文差异。
MAX_DIFF_LINES = 20
# 排版差异每一类（增/删/改）最多返回多少个键。
MAX_LAYOUT_KEYS = 10

RISK_CATEGORY_LABELS = {
    "duplicate": "查重",
    "sensitive": "敏感信息",
    "exaggeration": "夸大表述",
    "deep_dive": "面试深挖风险",
    "compliance": "合规保密",
}
PREFLIGHT_SEVERITY_LABELS = {"blocker": "必须解决", "verify": "需核对", "suggestion": "排版建议"}


def _clip(value: object, limit: int = MAX_TEXT_CHARS) -> str:
    """工具结果里的自由文本统一截断（整段原文不进上下文）。"""
    return _trim(str(value or ""), limit)


def _preflight_snapshot(db: Session, record, document: dict, settings: dict) -> PreflightSnapshot:
    """与制作台「检查简历」同一份快照指纹（先看正文，再看生效版式）。"""
    from .document_tools import _render_config_digest

    return PreflightSnapshot(
        content_sha256=canonical_content_sha256(document),
        render_config_sha256=_render_config_digest(settings),
        template=settings["template"],
        page_limit=settings["page_limit"],
        font_scale=settings["font_scale"],
        language=settings["language"],
        document_mode="long_cv" if getattr(record, "document_mode", "") == "long_cv" else "resume",
    )


def _tool_run_resume_quality_check(db: Session, arguments: dict) -> ToolResult:
    """简历质量检测（本地规则五类，不调模型、不改正文）。"""
    record = record_or_error(db, arguments)
    document = document_for(db, record)
    claims = db.query(ClaimRecord).filter(trash.live_only(ClaimRecord)).all()
    notes: list[str] = []
    # 只调本地确定性规则；远端增强编排 scan_resume_risks 绝不在这里出现。
    points = scan_local(document, claims, notes=notes)
    summary = {category: 0 for category in RISK_CATEGORY_LABELS}
    for point in points:
        summary[point.category] = summary.get(point.category, 0) + 1
    top = points[:MAX_ITEMS]
    payload = {
        "resume_id": record.id,
        "title": record.title,
        "revision": int(record.revision or 0),
        "total": len(points),
        "returned": len(top),
        "summary": summary,
        "category_labels": RISK_CATEGORY_LABELS,
        "points": [
            {
                "category": point.category,
                "category_label": RISK_CATEGORY_LABELS.get(point.category, point.category),
                "severity": point.severity,
                "text": _clip(point.text),
                "location": _clip(point.location),
                "suggestion": _clip(point.suggestion),
                "follow_up": [_clip(item, 120) for item in (point.follow_up or [])[:3]],
            }
            for point in top
        ],
        "truncated": len(points) > len(top),
        "notes": [_clip(note, 160) for note in notes[:MAX_ITEMS]],
        "reading": (
            f"本地规则扫出 {len(points)} 条风险点（按类别计：{summary}；前 {len(top)} 条已列出），"
            "只提示不改正文，未调用模型增强"
        ),
    }
    return ToolResult(
        text=json.dumps(payload, ensure_ascii=False, default=str)[:MAX_RESULT_CHARS],
        summary=f"检测了简历「{record.title}」：{len(points)} 条风险点（本地规则）",
        link="/resumes",
    )


def _tool_check_ats_match(db: Session, arguments: dict) -> ToolResult:
    """某份简历对某个岗位的 ATS 本地估算（不打开网页、不调模型）。"""
    record = record_or_error(db, arguments)
    job_id = int_argument(arguments, "job_id", "需要提供岗位 id（可以先用 list_jobs 查）")
    job = trash.get_live(db, Job, job_id)
    if job is None:
        raise ValueError(f"岗位 {job_id} 不存在或已被删除")
    document = document_for(db, record)
    jd_text = build_job_prompt_text(JobOut.model_validate(job), MAX_JOB_RESULT_CHARS)
    result = check_ats(document, jd_text=jd_text, resume_id=record.id)
    top_issues = result.issues[:MAX_ITEMS]
    score_note = (
        "关键词分项不参与计分：这份岗位原文里没有可比对的目标词，总分显示为未知"
        if result.score is None
        else "总分是三个分项按 0.4/0.4/0.2 加权的本地估计"
    )
    payload = {
        "resume_id": record.id,
        "title": record.title,
        "job": {"id": job.id, "title": job.title, "company": job.company},
        "score": result.score,
        "subscores": result.subscores,
        "coverage_ratio": result.coverage_ratio,
        "supplementary_coverage_ratio": result.supplementary_coverage_ratio,
        "summary": result.summary,
        # 强制免责文案：这是本地启发式估计，不是真实 ATS 的解析结果。
        "disclaimer": result.disclaimer,
        "matched_keywords": [str(word) for word in result.matched_keywords[:MAX_ITEMS]],
        "missing_keywords": [str(word) for word in result.missing_keywords[:MAX_ITEMS]],
        "issues": [
            {
                "category": issue.category,
                "severity": issue.severity,
                "title": _clip(issue.title),
                "detail": _clip(issue.detail),
                "suggestion": _clip(issue.suggestion),
            }
            for issue in top_issues
        ],
        "total_issues": len(result.issues),
        "truncated": len(result.issues) > len(top_issues),
        "reading": (
            f"ATS 本地估算：总分 {result.score if result.score is not None else '未知'}，"
            f"分项 {result.subscores}；{score_note}；{result.disclaimer}"
        ),
    }
    return ToolResult(
        text=json.dumps(payload, ensure_ascii=False, default=str)[:MAX_RESULT_CHARS],
        summary=f"估算了简历「{record.title}」对岗位「{job.title}」的 ATS 适配度",
        link="/resumes",
    )


def _tool_get_resume_preflight(db: Session, arguments: dict) -> ToolResult:
    """统一检查（内容/排版/产物三层本地规则，按严重度分组）。"""
    record = record_or_error(db, arguments)
    document = document_for(db, record)
    settings = render_settings(db, record)
    snapshot = _preflight_snapshot(db, record, document, settings)
    result = run_preflight(
        document,
        # 面板默认三层；product 层真的渲染一遍 PDF 再读回来，全程本地、不调模型。
        request=PreflightRequest(layers=["content", "layout", "product"]),
        snapshot=snapshot,
        template=settings["template"],
        page_limit=settings["page_limit"],
        font_scale=settings["font_scale"],
        language=settings["language"],
        format_config=settings["format_config"],
    )
    groups: dict[str, list[dict]] = {severity: [] for severity in PREFLIGHT_SEVERITY_LABELS}
    for issue in result.issues:
        bucket = groups.setdefault(issue.severity, [])
        if len(bucket) >= MAX_ITEMS:
            continue
        bucket.append(
            {
                "code": issue.code,
                "title_key": issue.title_key,
                "detail": _clip(issue.detail),
                "impact": _clip(issue.impact),
                "locator": issue.locator.model_dump(exclude_none=True),
            }
        )
    group_payload = [
        {
            "severity": severity,
            "label": label,
            "count": int(result.summary.get(severity, 0)),
            "returned": len(groups.get(severity, [])),
            "truncated": int(result.summary.get(severity, 0)) > len(groups.get(severity, [])),
            "items": groups.get(severity, []),
        }
        for severity, label in PREFLIGHT_SEVERITY_LABELS.items()
    ]
    payload = {
        "resume_id": record.id,
        "title": record.title,
        "revision": int(record.revision or 0),
        "summary": result.summary,
        "layers_run": list(result.layers_run),
        "disclaimer": result.disclaimer,
        "groups": group_payload,
        "reading": (
            "统一检查（本地规则，不改正文）："
            + "，".join(
                f"{label} {result.summary.get(severity, 0)} 条"
                for severity, label in PREFLIGHT_SEVERITY_LABELS.items()
            )
            + "；每组最多列出前 5 条"
        ),
    }
    return ToolResult(
        text=json.dumps(payload, ensure_ascii=False, default=str)[:MAX_RESULT_CHARS],
        summary=f"检查了简历「{record.title}」：{payload['reading']}",
        link="/resumes",
    )


def _tool_compare_resume_versions(db: Session, arguments: dict) -> ToolResult:
    """对比同一份简历的两个命名版本（正文行差异 + 排版项增删改，全部截断）。"""
    record = record_or_error(db, arguments)
    from_version = int_argument(
        arguments, "from_version", "需要提供起始版本 id（先用 list_versions 查）"
    )
    to_version = int_argument(
        arguments, "to_version", "需要提供目标版本 id（先用 list_versions 查）"
    )
    try:
        data = compare_versions(db, record, from_version, str(to_version))
        compare = VersionCompareOut.model_validate(data)
    except VersionNotFound as exc:
        raise ValueError(f"版本不存在或不属于这份简历：{exc}") from None
    diff = compare.content
    changed_lines = [line for line in diff.lines if line.type != "unchanged"]
    shown_lines = changed_lines[:MAX_DIFF_LINES]
    layout_dump = compare.layout.model_dump()
    # 值类型显式放宽成 object：同一张表里既有 list[str]（增删改项）又有 bool（equal）。
    # 计数仍读收窄前的 layout_items，保持"截断后长度"的原口径不变。
    layout_items = {
        key: [str(item) for item in layout_dump.get(key, [])[:MAX_LAYOUT_KEYS]]
        for key in ("added", "removed", "changed")
    }
    layout: dict[str, object] = {**layout_items}
    layout["equal"] = bool(layout_dump.get("equal", False))
    layout_truncation = {
        key: len(layout_dump.get(key, [])) > MAX_LAYOUT_KEYS
        for key in ("added", "removed", "changed")
    }
    shown_changes = compare.changes[:MAX_ITEMS]
    payload = {
        "resume_id": record.id,
        "title": record.title,
        "from": {"id": compare.base_id, "name": compare.base_name},
        "to": {"id": compare.against_id, "name": compare.against_name},
        "stats": diff.stats.model_dump(),
        "content_diff": {
            "lines": [{"type": line.type, "text": _clip(line.text, 240)} for line in shown_lines],
            "total_changed": len(changed_lines),
            "truncated": len(changed_lines) > len(shown_lines),
        },
        "layout": layout,
        "layout_truncated_keys": [key for key, truncated in layout_truncation.items() if truncated],
        "changes": [
            {
                "path": _clip(change.path, 120),
                "kind": change.kind,
                "scope": change.scope,
                "section_title": _clip(change.section_title, 80),
                "entry_label": _clip(change.entry_label, 80),
                "item_label": _clip(change.item_label, 80),
                "old_value": _clip(change.old_value),
                "new_value": _clip(change.new_value),
            }
            for change in shown_changes
        ],
        "changes_total": len(compare.changes),
        "changes_truncated": bool(compare.changes_truncated)
        or len(compare.changes) > len(shown_changes),
        "reading": (
            f"对比「{compare.base_name}」→「{compare.against_name}」："
            f"正文差 +{diff.stats.added}/-{diff.stats.removed} 行；"
            f"排版增 {len(layout_items['added'])} / 删 {len(layout_items['removed'])}"
            f" / 改 {len(layout_items['changed'])} 个键；"
            f"字段级变更 {len(compare.changes)} 条（列出前 {len(shown_changes)} 条）"
        ),
    }
    return ToolResult(
        text=json.dumps(payload, ensure_ascii=False, default=str)[:MAX_RESULT_CHARS],
        summary=f"对比了简历「{record.title}」的版本「{compare.base_name}」与「{compare.against_name}」",
        link="/resumes",
    )


__all__ = [
    "MAX_ITEMS",
    "MAX_TEXT_CHARS",
    "RISK_CATEGORY_LABELS",
    "_tool_check_ats_match",
    "_tool_compare_resume_versions",
    "_tool_get_resume_preflight",
    "_tool_run_resume_quality_check",
]
