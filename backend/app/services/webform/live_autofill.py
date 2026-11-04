# SPDX-License-Identifier: Apache-2.0
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

from ..diagnostics import record_event
from .engine import ApplyOutcome, FormEngine
from .engine.recovery import REASON_WRITE_ERROR
from .repeated_fields import split_repeated_key
from .service import FillSelection, apply_fill, build_preview, default_selections
from .service.fill import SETTLE_RECHECK_SECONDS
from .session import Snapshot
from .webform_copy import ui_text

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
    # 整页自动填写失败时的稳定原因码（见下方的 REASON_* ）。空串 = 没失败。
    # 与 #39 的 apply 失败同口径：界面按码办事，长句只作补充说明。
    reason: str = ""


# 整页自动填写失败的稳定码（与 #39「step / target / reason」同口径）。
# **两类失败必须分开**：页面读不出来是用户该刷新；我们自己的编程错误（签名漂移、
# 属性改名）是开发该修的——把它降级成"请刷新页面重试"会让同一个 bug 再查半天。
AUTOFILL_STEP = "filling"
AUTOFILL_TARGET = "page"
REASON_PAGE_UNREADABLE = "page_unreadable"
REASON_INTERNAL = "internal_error"


@dataclass(frozen=True)
class AutoFillResult:
    total: int
    completed: int
    filled: int
    failed: int
    form_control_total: int = 0
    recognized_total: int = 0
    # 因当前方案未包含对应板块而**没填**的字段数，以及第一个板块的显示名。
    # 跳过清单要能说清"是范围挡住的，不是你资料里没有"（需求 3 / 问题 8）。
    filtered_skipped: int = 0
    filtered_section: str = ""


def _fillable_items(
    controls: list[Any],
    data: dict[str, str],
    engine: FormEngine,
    *,
    relaxed: bool = False,
    custom_labels: dict[str, str] | None = None,
    filtered_fields: dict[str, str] | None = None,
) -> tuple[Snapshot, list[Any], int, str]:
    """Build the same rule/default selection set as the main webform page.

    The floating-ball action is a shortcut, not a second matcher. Reusing
    build_preview and default_selections keeps conflict handling,
    low-confidence rows, and date formatting on the same path as the main UI.

    后两个返回值是"因当前方案未包含板块而跳过"的字段数与板块名——不返回它，用户就只
    看到"没填"，不知道是范围挡住的（需求 3 的静默漏填验收项）。
    """
    snapshot = Snapshot(id="live-autofill", controls=controls)
    report = build_preview(
        snapshot,
        data,
        engine=engine,
        relaxed=relaxed,
        custom_labels=custom_labels,
    )
    selected = {item.index for item in default_selections(report)}
    skipped, section = _filtered_skips(report, filtered_fields)
    return snapshot, [item for item in report.items if item.index in selected], skipped, section


def _filtered_skips(
    report: Any, filtered_fields: dict[str, str] | None
) -> tuple[int, str]:
    """（因范围被跳过的字段数, 第一个被挡板块的显示名）。

    只数 ``missing_data``（认得出字段、资料里没值）里属于组外板块的那些：
    ``unrecognized`` 与 ``blocked`` 跟范围无关，算进去会把"没认出来"说成"方案没包含"。
    这个统计与 ``live.py`` 的空态分支同源（都按基础字段名对板块）。
    """
    if not filtered_fields:
        return 0, ""
    count = 0
    section = ""
    for pending in getattr(report, "missing_data", ()):
        base = split_repeated_key(getattr(pending, "field", "") or "")[0]
        name = filtered_fields.get(base)
        if not name:
            continue
        count += 1
        if not section:
            section = name
    return count, section


def fill_current_page(
    client: Any,
    data: dict[str, str],
    *,
    engine: FormEngine | None = None,
    on_progress: Callable[[AutoFillProgress], None] | None = None,
    should_stop: Callable[[], bool] | None = None,
    delay_seconds: float = 0.03,
    relaxed: bool = False,
    custom_labels: dict[str, str] | None = None,
    locale: str | None = None,
    filtered_fields: dict[str, str] | None = None,
) -> AutoFillResult:
    """读取当前页并逐个写入可安全识别的空控件。

    统一走一次 ``apply_fill``，避免每个字段重复获取锁和建立 CDP 往返；结果仍按字段顺序
    推送给悬浮球，短暂延迟只发生在后台工作线程。
    """
    engine = engine or FormEngine()
    controls = engine.read_controls(client)
    snapshot, items, filtered_skipped, filtered_section = _fillable_items(
        controls,
        data,
        engine,
        relaxed=relaxed,
        custom_labels=custom_labels,
        filtered_fields=filtered_fields,
    )
    total = len(items)
    form_control_total = len(controls)
    record_event(
        "webform.autofill_start",
        form_control_total=form_control_total,
        recognized_total=total,
    )
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
            message=(
                ui_text(locale, "autofill.recognizing")
                if total
                else ui_text(locale, "autofill.nothing")
            ),
        )
    )
    outcomes_by_index: dict[int, ApplyOutcome] = {}
    try:
        selections = [
            FillSelection(index=item.index, field=item.field, value=item.value) for item in items
        ]
        outcomes_by_index = {
            outcome.index: outcome
            for outcome in apply_fill(
                client,
                snapshot,
                selections,
                engine=engine,
                # 整页填充收尾复读一次：组件事后还原的"伪已填"在这条路上要被如实降级。
                settle_recheck=SETTLE_RECHECK_SECONDS,
            )
        }
    except Exception as error:  # noqa: BLE001 - 整批失败时报告每项失败，避免永久停在进行中
        logger.warning("当前页面自动填写批次失败：%s", error)
        outcomes_by_index = {
            item.index: ApplyOutcome(
                item.index,
                item.field,
                "failed",
                type(error).__name__,
                reason=REASON_WRITE_ERROR,
            )
            for item in items
        }

    for item in items:
        if should_stop is not None and should_stop():
            break
        outcome = outcomes_by_index.get(item.index)
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
                current_label=item.field_label,
                message=ui_text(
                    locale,
                    "note.autofillFilled"
                    if outcome and outcome.status == "filled"
                    else "note.autofillUnconfirmed",
                ),
            )
        )
        if delay_seconds > 0 and (should_stop is None or not should_stop()):
            time.sleep(delay_seconds)

    state = "cancelled" if should_stop is not None and should_stop() else "done"
    # 成功率分母是页面全部可安全读取的控件，而不是规则恰好识别出的那一小部分。
    rate_note = (
        ui_text(locale, "autofill.rate", percent=round(filled * 100 / form_control_total))
        if form_control_total
        else ""
    )
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
    reason_counts: dict[str, int] = {}
    for outcome in outcomes_by_index.values():
        if outcome.reason:
            reason_counts[outcome.reason] = reason_counts.get(outcome.reason, 0) + 1
    record_event(
        "webform.autofill_done",
        form_control_total=form_control_total,
        recognized_total=total,
        completed=completed,
        filled=filled,
        failed=failed,
        state=state,
        reason_counts=reason_counts,
    )
    return AutoFillResult(
        total=total,
        completed=completed,
        filled=filled,
        failed=failed,
        form_control_total=form_control_total,
        recognized_total=total,
        filtered_skipped=filtered_skipped,
        filtered_section=filtered_section,
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


__all__ = [
    "AUTOFILL_STEP",
    "AUTOFILL_TARGET",
    "REASON_INTERNAL",
    "REASON_PAGE_UNREADABLE",
    "AutoFillProgress",
    "AutoFillResult",
    "AutoFillWorker",
    "fill_current_page",
]
