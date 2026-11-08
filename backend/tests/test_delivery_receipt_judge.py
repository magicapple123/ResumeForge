# SPDX-License-Identifier: Apache-2.0
"""T08 投递交付单：三态矩阵、优先级与待人工步骤映射（纯函数部分）。

从 test_delivery_receipt.py 拆出：500 行预算（test_file_size_budget）与表驱动用例的
可读性都要求纯函数断言与 DB 集成断言分开。DB/接口路径的用例仍在原文件。
"""

from typing import get_args

import pytest
from app.schemas.delivery_receipt import ReceiptState
from app.services.delivery_receipt import (
    HUMAN_STEP_CAPTCHA_REQUIRED,
    HUMAN_STEP_CONFIRM_IN_BROWSER,
    HUMAN_STEP_FILL_REQUIRED_FIELD,
    HUMAN_STEP_LOGIN_REQUIRED,
    HUMAN_STEP_ORDER,
    HUMAN_STEP_REUPLOAD_RESUME,
    REASON_ARTIFACT_MISSING,
    REASON_DOUBTS_PRESENT,
    REASON_PAGE_LIMIT,
    REASON_SNAPSHOT_MISSING,
    RECEIPT_STATES,
    STATE_HAS_DOUBTS,
    STATE_READY,
    STATE_WAITING_HUMAN,
    human_steps,
    judge_receipt,
)

# ===== 1. 三态矩阵（纯函数）=====

# (snapshot_present, artifact_required, artifact_sha256, pages, page_limit, steps, doubts)
_STATE_CASES = [
    # 卡在人手上：无快照 / export 缺产物 / 待人工步骤（单因子，冲突组合留给优先级用例）
    ((False, True, None, None, None, (), 0), STATE_WAITING_HUMAN, [REASON_SNAPSHOT_MISSING]),
    ((True, True, None, None, None, (), 0), STATE_WAITING_HUMAN, [REASON_ARTIFACT_MISSING]),
    (
        (True, True, "a" * 64, None, None, ("captcha_required",), 0),
        STATE_WAITING_HUMAN,
        ["captcha_required"],
    ),
    (
        (True, False, None, None, None, ("login_required",), 0),
        STATE_WAITING_HUMAN,
        ["login_required"],
    ),
    # 有疑点：台账疑点 / 页数超限 / 两者并存
    ((True, True, "a" * 64, None, None, (), 1), STATE_HAS_DOUBTS, [REASON_DOUBTS_PRESENT]),
    ((True, True, "a" * 64, 2, 1, (), 0), STATE_HAS_DOUBTS, [REASON_PAGE_LIMIT]),
    (
        (True, True, "a" * 64, 3, 1, (), 2),
        STATE_HAS_DOUBTS,
        [REASON_DOUBTS_PRESENT, REASON_PAGE_LIMIT],
    ),
    # 可验收：apply 无产物不算缺件；页数未知/等于/不限都不算超限
    ((True, False, None, None, None, (), 0), STATE_READY, []),
    ((True, True, "a" * 64, None, None, (), 0), STATE_READY, []),
    ((True, True, "a" * 64, 1, 1, (), 0), STATE_READY, []),
    ((True, True, "a" * 64, 9, 0, (), 0), STATE_READY, []),
    ((True, True, "a" * 64, 9, None, (), 0), STATE_READY, []),
    ((True, True, "a" * 64, None, 1, (), 0), STATE_READY, []),
]


@pytest.mark.parametrize(
    ("facts", "expected_state", "expected_reasons"),
    _STATE_CASES,
    ids=[f"case-{index}" for index in range(len(_STATE_CASES))],
)
def test_state_matrix(facts, expected_state, expected_reasons):
    snapshot_present, artifact_required, artifact_sha256, pages, page_limit, steps, doubts = facts
    result = judge_receipt(
        snapshot_present=snapshot_present,
        artifact_sha256=artifact_sha256,
        artifact_required=artifact_required,
        pages=pages,
        page_limit=page_limit,
        human_steps=steps,
        doubts_count=doubts,
    )
    assert (result.state, result.state_reasons) == (expected_state, expected_reasons)


def test_waiting_human_beats_doubts():
    """优先级：还有人工步骤/缺产物时不能被"有疑点"盖住。

    只改判定顺序（先判 doubts）时这条精确变红；矩阵刻意不混冲突组合，所以只有它红。
    """
    missing = judge_receipt(snapshot_present=True, artifact_sha256=None, doubts_count=3)
    assert missing.state == STATE_WAITING_HUMAN
    assert missing.state_reasons == [REASON_ARTIFACT_MISSING]
    with_steps = judge_receipt(
        snapshot_present=True,
        artifact_sha256="a" * 64,
        human_steps=(HUMAN_STEP_CAPTCHA_REQUIRED,),
        doubts_count=3,
        pages=5,
        page_limit=1,
    )
    assert with_steps.state == STATE_WAITING_HUMAN
    assert with_steps.state_reasons == [HUMAN_STEP_CAPTCHA_REQUIRED]


# ===== 2. 待人工步骤映射（纯函数）=====


def test_human_steps_table():
    assert human_steps(failure_category="captcha_required") == [HUMAN_STEP_CAPTCHA_REQUIRED]
    assert human_steps(failure_reason="login_required") == [HUMAN_STEP_LOGIN_REQUIRED]
    assert human_steps(failure_target="resume_upload") == [HUMAN_STEP_REUPLOAD_RESUME]
    assert human_steps(failure_step="filling") == [HUMAN_STEP_FILL_REQUIRED_FIELD]
    assert human_steps(failure_step="verifying") == [HUMAN_STEP_CONFIRM_IN_BROWSER]
    # 同一码重复命中时去重；未登记的分类不猜。
    assert human_steps(failure_category="captcha_required", failure_reason="captcha_required") == [
        HUMAN_STEP_CAPTCHA_REQUIRED
    ]
    assert human_steps(failure_category="unknown", failure_reason="selector_missing") == []
    # 填充记录：填失败要补、填了没核对上要确认。
    assert human_steps(fill_failed=1) == [HUMAN_STEP_FILL_REQUIRED_FIELD]
    assert human_steps(fill_unverified=2) == [HUMAN_STEP_CONFIRM_IN_BROWSER]
    # answer_screening_questions 保留在词表，但当前没有稳定信号，不猜。
    assert "answer_screening_questions" not in human_steps(failure_category="profile_insufficient")
    assert list(HUMAN_STEP_ORDER) == [
        "captcha_required",
        "login_required",
        "reupload_resume",
        "answer_screening_questions",
        "fill_required_field",
        "confirm_in_browser",
    ]


def test_state_constants_match_schema_literal():
    assert tuple(get_args(ReceiptState)) == RECEIPT_STATES
