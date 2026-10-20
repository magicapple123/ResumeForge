# SPDX-License-Identifier: Apache-2.0
"""OperationBudget 的契约测试（RF-02，架构文档 §2.2）。

预算是"由多段网络调用组成的业务操作"的总 deadline + 协作式取消：纯墙钟、
不依赖事件循环、child() 与父共享取消事件且不得超过父。这里逐条钉住契约。
"""
import threading
import time

import pytest
from app.runtime.operation_budget import OperationBudget, OperationCancelled


def test_raise_if_stopped_passes_while_budget_is_fresh():
    budget = OperationBudget.start(5)
    budget.raise_if_stopped()  # 不抛
    assert budget.remaining() > 4.5
    assert not budget.is_expired()
    assert not budget.is_cancelled()


def test_expired_budget_raises_with_a_timeout_message():
    budget = OperationBudget.start(0.01)
    time.sleep(0.05)  # 超时用例：预算必须真的到期（毫秒级小预算）
    assert budget.is_expired()
    with pytest.raises(OperationCancelled, match="超时"):
        budget.raise_if_stopped()


def test_cancel_is_idempotent_and_classified_as_user_cancel():
    budget = OperationBudget.start(0.01)
    budget.cancel()
    budget.cancel()  # 幂等：重复 cancel 不抛、状态不变
    assert budget.is_cancelled()
    # 取消与过期同时成立时按"用户取消"归类，而不是超时。
    time.sleep(0.05)
    with pytest.raises(OperationCancelled, match="取消"):
        budget.raise_if_stopped()


def test_child_never_outlives_its_parent_and_shares_the_cancel_event():
    parent = OperationBudget.start(5)
    child = parent.child(max_seconds=0.5)
    assert child.deadline < parent.deadline

    # 父预算更短时，child 不得越过父的 deadline。
    short_parent = OperationBudget.start(0.01)
    assert short_parent.child(max_seconds=100).deadline == short_parent.deadline

    # child 与父共享同一个取消事件：父取消，全部 child 立即被停。
    parent.cancel()
    assert child.is_cancelled()
    with pytest.raises(OperationCancelled, match="取消"):
        child.raise_if_stopped()


def test_accepts_an_injected_cancel_event():
    event = threading.Event()
    budget = OperationBudget.start(5, cancel_event=event)
    event.set()
    with pytest.raises(OperationCancelled, match="取消"):
        budget.raise_if_stopped()


def test_rejects_non_positive_seconds():
    with pytest.raises(ValueError):
        OperationBudget.start(0)
    with pytest.raises(ValueError):
        OperationBudget.start(-1)
