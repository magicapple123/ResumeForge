"""简历风险扫描（R-08 查重/敏感词/夸大/深挖风险点 + R-09 合规校验）：编排入口与门面。

**只提示、绝不改写**：这里产出的是给用户看的一组风险点与建议，任何一条规则都不会回写
``ResumeContent``——正文只能由用户自己改。

模块分工（PR-18 豁免拆分批，纯搬迁无行为变化）：

1. **本地确定性规则**（不依赖模型，始终运行）在 ``resume_risk_rules.py``：
   - 查重：同一要点在简历里重复出现（含高度相似）。
   - 敏感词：身份证号 / 银行卡号 / 精确出生日期 / 住址 / 薪资等；模式集中在
     ``services/privacy.py``（与 R-17 隐私脱敏共用一份名单）。
   - 夸大：绝对化表述（「精通」「全球第一」）与 ≥100% 的量化。
   - 深挖风险点：正文里的强主张措辞（主导 / 独立完成 / 从 0 到 1 …）+ 事实台账里
     LED/OWNER 承担的强主张联动（读 boundary/risk_notes/interview_details，把
     「这条会被追问什么」回填成 follow_up，**只读不写台账**）。
   - 合规：保密 / 未公开 / 涉密等 NDA 相关表述。

2. **可选 LLM 增强**：配置了模型时，额外让模型找一批「面试会被追问」的深挖点；
   未配置或调用失败时静默降级为本地规则（notes 里说明），不阻断。出站输入走
   **最小化脱敏**（``resume_risk_outbound.py``，PR-11 隐私关键路径），模型返回经
   受限规范化，畸形结构一律降级而不是让整个扫描失败。

本文件保留扫描编排（``scan_resume_risks``）并对既有公开名字做 re-export——消费方
（``api/resume_risk.py`` 与测试）的 import 路径与 ``__all__`` 契约不变。
"""

from __future__ import annotations

import logging

from ...models.claim import ClaimRecord
from ...schemas.resume import ResumeContent
from ...schemas.resume_risk import RiskPoint, RiskScanOut
from ...services.llm.base import BaseLLMProvider, LLMError
from ...services.llm.structured_output import parse_json_object
from .resume_risk_outbound import _build_enhancement_messages, _normalize_enhancement_points
from .resume_risk_rules import (
    EXAGGERATION_PHRASES,
    # 仅测试经本门面 import（契约保持，编排自身不使用）。
    MAX_DUPLICATE_RISKS,  # noqa: F401
    STRONG_CLAIM_PHRASES,
    scan_local,
)

logger = logging.getLogger(__name__)


async def _llm_deep_dive(
    provider: BaseLLMProvider, resume: ResumeContent, claims: list[ClaimRecord]
) -> tuple[list[RiskPoint], list[str]]:
    """可选模型增强：出站走最小化消息，返回 (深挖点, 截断类提示)。

    消息构造集中在 :func:`resume_risk_outbound._build_enhancement_messages`
    （隐私边界唯一出口）；模型返回经 :func:`resume_risk_outbound._normalize_enhancement_points`
    受限规范化，畸形结构抛 :class:`LLMError` 由调用方降级。
    """
    messages = _build_enhancement_messages(resume, claims)
    raw = await provider.chat(messages, thinking=False)
    data = parse_json_object(raw, label="风险深挖")
    return _normalize_enhancement_points(data)


async def scan_resume_risks(
    resume: ResumeContent,
    claims: list[ClaimRecord],
    provider: BaseLLMProvider | None = None,
    *,
    resume_id: int = 0,
) -> RiskScanOut:
    """风险扫描入口：本地规则始终运行，配置了模型时追加可选增强（失败自动降级）。"""
    notes: list[str] = []
    points = scan_local(resume, claims, notes=notes)
    llm_used = False
    if provider is not None:
        try:
            extra, warnings = await _llm_deep_dive(provider, resume, claims)
            points.extend(extra)
            notes.extend(warnings)
            llm_used = True
        except LLMError as exc:
            notes.append(f"AI 增强未完成，已使用本地规则结果：{exc}")
            logger.warning("风险扫描模型增强失败，降级为本地规则：%s", exc)
        except Exception as exc:  # 意外内部异常同样降级，绝不让扫描整体 500。
            notes.append("AI 增强未完成，已使用本地规则结果（模型返回内容异常）")
            # 只记异常类型与简短描述，不落完整 prompt / 响应原文。
            logger.warning(
                "风险扫描模型增强发生意外异常，已降级：%s: %s",
                type(exc).__name__,
                str(exc)[:200],
            )
    summary: dict[str, int] = {}
    for point in points:
        summary[point.category] = summary.get(point.category, 0) + 1
    return RiskScanOut(
        resume_id=resume_id,
        points=points,
        summary=summary,
        llm_used=llm_used,
        notes=notes,
    )


__all__ = [
    "EXAGGERATION_PHRASES",
    "STRONG_CLAIM_PHRASES",
    "scan_local",
    "scan_resume_risks",
]
