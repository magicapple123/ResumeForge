# SPDX-License-Identifier: Apache-2.0
"""Verified claim context for interview prompts."""

import json

from sqlalchemy.orm import Session

from ...models.claim import ClaimRecord, can_enter_final
from .. import trash


def _claims_json(db: Session) -> str:
    """已确认的事实台账基线，序列化后进题库/思路提示词。

    只用 ``已确认`` 状态：它们是可以进入正式材料的唯一事实来源，与生成链路一致。
    """
    claims = [
        item
        for item in db.query(ClaimRecord).filter(trash.live_only(ClaimRecord)).all()
        if can_enter_final(item.verification_status)
    ]
    if not claims:
        return ""
    return json.dumps(
        [
            {
                "title": item.title,
                "category": item.category,
                "subject": item.subject,
                "candidate_wording": item.candidate_wording,
                "responsibility_level": item.responsibility_level,
                "boundary": item.boundary,
                "interview_details": item.interview_details or {},
                "risk_notes": item.risk_notes or [],
            }
            for item in claims
        ],
        ensure_ascii=False,
    )
