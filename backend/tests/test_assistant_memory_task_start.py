# SPDX-License-Identifier: Apache-2.0
"""助手记忆抽取：登记之后必须**真的把执行器拉起来**。

2026-11-13 用户反馈「整理助手记忆关不掉」：页头那条任务永远停在「生成中…」。
根因有两层，这一组钉的是后端那层——`schedule_extraction()` 只往 `ai_task` 表里插了一行
`pending`，从来没有调用 `runner.start()`（`POST /ai-tasks` 建完是调了的）。于是任务
永远不会跑：进度永远是空的、也不会自己进终态，前端怎么轮询都只能看到「生成中」。

用例用替身执行器：要验的是"有没有调用"，不是真的跑模型（跑模型要凭据、也不确定）。
"""

from __future__ import annotations

from typing import Any

import pytest
from app.services.assistant import memory_extract


class _RecordingRunner:
    """记录 start / mark_failed 的替身执行器。"""

    def __init__(self, *, fail_start: bool = False) -> None:
        self.calls: list[tuple[str, int]] = []
        self._fail_start = fail_start

    def start(self, task_id: int) -> None:
        if self._fail_start:
            raise RuntimeError("executor unavailable")
        self.calls.append(("start", task_id))

    def mark_failed(self, task_id: int, reason: str) -> None:
        self.calls.append(("failed", task_id))


@pytest.fixture(autouse=True)
def _always_schedulable(monkeypatch: pytest.MonkeyPatch) -> None:
    """跳过"空闲 5 分钟 + 有新消息 + 没有在跑的任务"的判定，只验登记后的动作。"""
    monkeypatch.setattr(memory_extract, "should_schedule", lambda db, conversation_id: True)


def _patch_runner(monkeypatch: pytest.MonkeyPatch, runner: _RecordingRunner) -> None:
    """`schedule_extraction` 在函数内部 `from ..ai_task_runner import get_ai_task_runner`，
    所以打在模块属性上即可生效。"""
    import app.services.ai_task_runner as runner_module

    monkeypatch.setattr(runner_module, "get_ai_task_runner", lambda: runner)


def test_schedule_extraction_starts_the_runner(db_session: Any, monkeypatch: pytest.MonkeyPatch):
    runner = _RecordingRunner()
    _patch_runner(monkeypatch, runner)

    task = memory_extract.schedule_extraction(db_session, 42)

    assert task is not None
    assert task.kind == "assistant_memory_extract"
    assert task.label == "整理助手记忆"
    assert runner.calls == [("start", task.id)], "登记完必须调用执行器，否则任务永远不跑"


def test_start_failure_does_not_leave_a_pending_ghost(
    db_session: Any, monkeypatch: pytest.MonkeyPatch
):
    """执行器起不来时：不能留一行永远 pending 的任务（页头会一直挂着它）。"""
    runner = _RecordingRunner(fail_start=True)
    _patch_runner(monkeypatch, runner)

    task = memory_extract.schedule_extraction(db_session, 43)

    assert task is not None
    assert runner.calls == [("failed", task.id)], "起不来就要当场收尾，而不是留个幽灵"


def test_schedule_skipped_does_not_touch_the_runner(
    db_session: Any, monkeypatch: pytest.MonkeyPatch
):
    """条件不满足时（返回 None）一个任务都不该登记，也不该惊动执行器。"""
    monkeypatch.setattr(memory_extract, "should_schedule", lambda db, conversation_id: False)
    runner = _RecordingRunner()
    _patch_runner(monkeypatch, runner)

    assert memory_extract.schedule_extraction(db_session, 44) is None
    assert runner.calls == []
