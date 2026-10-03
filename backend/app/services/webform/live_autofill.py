"""专用浏览器的当前页面自动填充。

这个模块只负责两件事：把当前页面重新读成控件、按现有表单引擎逐项写入。
会话生命周期和悬浮球状态仍由 ``live.py`` / ``live_control.py`` 编排，避免把实时
监听继续堆进一个文件。
"""
from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from .engine import ApplyOutcome, FieldMapping, FormEngine
from ..diagnostics import record_event
from .fields import FIELD_LABELS
from .repeated_fields import field_label_for_key, split_repeated_key
from .service import FillSelection, apply_fill
from .session import Snapshot

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class AutoFillProgress:
    """逐项填充时推给悬浮球的一帧进度。"""

    state: str
    total: int
    completed: int
    filled: int
    failed: int
    form_control_total: int = 0
    recognized_total: int = 0
    current_label: str = ""
    message: str = ""


@dataclass(frozen=True)
class AutoFillResult:
    total: int
    completed: int
    filled: int
    failed: int
    form_control_total: int = 0
    recognized_total: int = 0


def _label(mapping: FieldMapping) -> str:
    base = split_repeated_key(mapping.field)[0]
    return field_label_for_key(mapping.field, FIELD_LABELS.get(base, base or mapping.field))


def _fillable_mappings(controls: list[Any], data: dict[str, str], engine: FormEngine) -> list[FieldMapping]:
    matched = engine.match_fields(controls, data)
    result: list[FieldMapping] = []
    for mapping in matched.mappings:
        # 当前页面已有不同值时不覆盖；已有相同值也不必重复触发站点联动。
        if mapping.control.is_filled():
            continue
        result.append(mapping)
    return result


def fill_current_page(
    client: Any,
    data: dict[str, str],
    *,
    engine: FormEngine | None = None,
    on_progress: Callable[[AutoFillProgress], None] | None = None,
    should_stop: Callable[[], bool] | None = None,
    delay_seconds: float = 0.03,
) -> AutoFillResult:
    """读取当前页并逐个写入可安全识别的空控件。

    统一走一次 ``apply_fill``，避免每个字段重复获取锁和建立 CDP 往返；结果仍按字段顺序
    推送给悬浮球，短暂延迟只发生在后台工作线程。
    """
    engine = engine or FormEngine()
    controls = engine.read_controls(client)
    mappings = _fillable_mappings(controls, data, engine)
    total = len(mappings)
    form_control_total = len(controls)
    record_event(
        "webform.autofill_start",
        form_control_total=form_control_total,
        recognized_total=total,
    )
    snapshot = Snapshot(id="live-autofill", controls=controls)
    completed = filled = failed = 0

    def report(progress: AutoFillProgress) -> None:
        if on_progress is not None:
            on_progress(progress)

    report(
        AutoFillProgress(
            state="filling" if total else "done",
            total=total,
            completed=0,
            filled=0,
            failed=0,
            form_control_total=form_control_total,
            recognized_total=total,
            message="正在识别当前页面…" if total else "当前页面没有可自动填写的空字段",
        )
    )
    outcomes_by_index: dict[int, ApplyOutcome] = {}
    try:
        selections = [
            FillSelection(index=item.control.index, field=item.field, value=item.value)
            for item in mappings
        ]
        outcomes_by_index = {
            outcome.index: outcome
            for outcome in apply_fill(client, snapshot, selections, engine=engine)
        }
    except Exception as error:  # noqa: BLE001 - 整批失败时报告每项失败，避免永久停在进行中
        logger.warning("当前页面自动填写批次失败：%s", error)
        outcomes_by_index = {
            item.control.index: ApplyOutcome(
                item.control.index, item.field, "failed", type(error).__name__
            )
            for item in mappings
        }

    for mapping in mappings:
        if should_stop is not None and should_stop():
            break
        outcome = outcomes_by_index.get(mapping.control.index)
        completed += 1
        if outcome is not None and outcome.status == "filled":
            filled += 1
        else:
            failed += 1
        report(
            AutoFillProgress(
                state="filling",
                total=total,
                completed=completed,
                filled=filled,
                failed=failed,
                form_control_total=form_control_total,
                recognized_total=total,
                current_label=_label(mapping),
                message=("已填入" if outcome and outcome.status == "filled" else "这一项未能确认，请稍后核对"),
            )
        )
        if delay_seconds > 0 and (should_stop is None or not should_stop()):
            time.sleep(delay_seconds)

    state = "cancelled" if should_stop is not None and should_stop() else "done"
    # 成功率分母是页面全部可安全读取的控件，而不是规则恰好识别出的那一小部分。
    rate_note = f"（成功率 {round(filled * 100 / form_control_total)}%）" if form_control_total else ""
    report(
        AutoFillProgress(
            state=state,
            total=total,
            completed=completed,
            filled=filled,
            failed=failed,
            message=(
                f"已完成 {filled}/{form_control_total} 个表单框{rate_note}（识别并尝试 {total} 个），请回到页面核对"
                if state == "done"
                else "已停止当前自动填写"
            ),
            form_control_total=form_control_total,
            recognized_total=total,
        )
    )
    record_event(
        "webform.autofill_done",
        form_control_total=form_control_total,
        recognized_total=total,
        completed=completed,
        filled=filled,
        failed=failed,
        state=state,
    )
    return AutoFillResult(
        total=total,
        completed=completed,
        filled=filled,
        failed=failed,
        form_control_total=form_control_total,
        recognized_total=total,
    )


class AutoFillWorker:
    """每个实时页面一个单槽后台工作线程，避免自动填写阻塞焦点监听。"""

    def __init__(self, run: Callable[[int], None]) -> None:
        self._run = run
        self._pending: int | None = None
        self._active = False
        self._closed = False
        self._lock = threading.Lock()
        self._wake = threading.Event()
        self._thread = threading.Thread(target=self._loop, name="webform-autofill", daemon=True)

    def start(self) -> None:
        self._thread.start()

    def request(self, sequence: int) -> bool:
        with self._lock:
            if self._closed or self._active or self._pending is not None:
                return False
            self._pending = sequence
        self._wake.set()
        return True

    def close(self) -> None:
        with self._lock:
            self._closed = True
            self._pending = None
        self._wake.set()
        self._thread.join(timeout=1.0)

    def _loop(self) -> None:
        while True:
            self._wake.wait()
            self._wake.clear()
            with self._lock:
                if self._closed:
                    return
                sequence, self._pending = self._pending, None
                self._active = sequence is not None
            if sequence is None:
                continue
            try:
                self._run(sequence)
            finally:
                with self._lock:
                    self._active = False


__all__ = ["AutoFillProgress", "AutoFillResult", "AutoFillWorker", "fill_current_page"]
