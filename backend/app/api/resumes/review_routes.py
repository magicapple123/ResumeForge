# SPDX-License-Identifier: Apache-2.0
"""简历待审变更预检（域⑦，RF-13）：编辑器里的 AI 改写 / 手填，落表单前先过闸门。

**纯审阅预检**：不落库、不改 content——只对调用方带来的每条候选变更跑一遍
**既有的三把准入闸门**（绝不在这里复制第二份准入逻辑，import 的就是原实现）：

1. ``has_placeholder``（models/claim.py）——含【待补】等未完成标记 → ``blocked``；
2. ``_unsupported_quantified_values``（resume_grounding_helpers.py）——量化结果
   不在来源资料证据中 → ``fact_check_needed``；
3. ``build_baseline``（services/claims.py）——台账已启用时，量化结果超出已确认
   基线、或命中未确认的候选表述 → ``fact_check_needed``。

verdict 三态：``ok`` / ``fact_check_needed`` / ``blocked``，理由随条目返回。
"""

import json

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ...database import get_db
from ...models.claim import has_placeholder, placeholder_hit
from ...schemas.resume import (
    ReviewChangeVerdictOut,
    ReviewPrepareOut,
    ReviewPrepareRequest,
)
from ...services.claims import build_baseline
from ...services.profile.profile_context import build_profile_prompt_data
from ...services.profile.profile_service import project_legacy_profile
from ...services.resume.resume_grounding_helpers import _unsupported_quantified_values
from ._shared import _get_live_resume

router = APIRouter()


def _verdict_for_change(change, profile_evidence: str, baseline) -> ReviewChangeVerdictOut:
    """对一条变更跑三把闸门，返回三态结论。优先级：blocked > fact_check_needed > ok。"""
    reasons: list[str] = []
    verdict = "ok"

    def escalate(level: str, reason: str) -> None:
        nonlocal verdict
        reasons.append(reason)
        # 优先级：blocked > fact_check_needed；已有 blocked 不被降级。
        if level == "blocked":
            verdict = "blocked"
        elif verdict != "blocked":
            verdict = "fact_check_needed"

    # 闸门 1：未完成标记（含【待补】）绝对进不了终稿 → blocked。
    if has_placeholder(change.after):
        escalate(
            "blocked",
            f"内容含未完成标记 {placeholder_hit(change.after)}，请先补全再写入",
        )

    # 闸门 2：量化结果必须能在来源资料证据里找到。
    unsupported = _unsupported_quantified_values(change.after, profile_evidence)
    if unsupported:
        escalate(
            "fact_check_needed",
            "量化结果 " + "、".join(unsupported) + " 在个人资料中找不到依据，建议先核实",
        )

    # 闸门 3：事实台账已启用时，越出已确认基线的内容要回台账核实。
    if baseline.baseline_text:
        beyond = _unsupported_quantified_values(change.after, baseline.baseline_text)
        if beyond:
            escalate(
                "fact_check_needed",
                "量化结果 " + "、".join(beyond) + " 超出台账已确认基线，建议回台账核实",
            )
    if baseline.blocked_wording:
        for wording in baseline.blocked_wording:
            if wording and wording in change.after:
                escalate(
                    "fact_check_needed",
                    "内容与台账中未确认的表述一致，建议先在台账确认这条主张",
                )
                break

    return ReviewChangeVerdictOut(path=change.path, verdict=verdict, reasons=reasons)


@router.post("/{resume_id}/review/prepare", response_model=ReviewPrepareOut)
def prepare_resume_review(
    resume_id: int, payload: ReviewPrepareRequest, db: Session = Depends(get_db)
) -> ReviewPrepareOut:
    """对一批待审变更做审阅预检，返回每条的三态结论；不落库、不改简历内容。"""
    # 记录必须存在且未删除：预检是针对"这份简历的这一栏"的编辑动作。
    _get_live_resume(db, resume_id)
    profile = project_legacy_profile(db)
    # 来源证据与生成链路同一份资料结构：量化结果校验的口径保持一致。
    profile_evidence = json.dumps(build_profile_prompt_data(profile), ensure_ascii=False)
    baseline = build_baseline(db)
    return ReviewPrepareOut(
        results=[
            _verdict_for_change(change, profile_evidence, baseline)
            for change in payload.changes
        ]
    )
