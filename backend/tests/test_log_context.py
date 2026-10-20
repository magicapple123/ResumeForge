# SPDX-License-Identifier: Apache-2.0
"""RF-20：后台线程日志关联上下文（log_context）的守卫测试。

钉住三件事：
- LogContextFilter 把 task_id/dataset_id 注入每条 LogRecord，缺省 "-"；
- run_with_bound_context 显式复制启动方 contextvars（request_id 随行）、绑定
  任务关联值，且绑定值不泄漏回调用方；
- 真线程启动后（threading.Thread）上述性质在子线程内成立。
"""

import logging
import threading

from app.middleware.request_context import request_id_context
from app.runtime.log_context import (
    LogContextFilter,
    bind_log_context,
    bound_context,
    run_with_bound_context,
)


def _make_record(message: str) -> logging.LogRecord:
    return logging.LogRecord(
        name="test", level=logging.INFO, pathname=__file__, lineno=1,
        msg=message, args=(), exc_info=None,
    )


def test_filter_injects_defaults_when_context_is_empty():
    record = _make_record("hello")
    assert LogContextFilter().filter(record) is True
    assert record.task_id == "-"
    assert record.dataset_id == "-"


def test_filter_injects_bound_values_and_binds_do_not_leak():
    with bound_context(task_id=42, dataset_id="main"):
        record = _make_record("hello")
        LogContextFilter().filter(record)
        assert record.task_id == "42"
        assert record.dataset_id == "main"
    after = _make_record("after")
    LogContextFilter().filter(after)
    assert after.task_id == "-"
    assert after.dataset_id == "-"


def test_bind_log_context_token_can_reset():
    from app.runtime.log_context import _LOG_CONTEXT

    token = bind_log_context(task_id="7")
    try:
        record = _make_record("x")
        LogContextFilter().filter(record)
        assert record.task_id == "7"
    finally:
        _LOG_CONTEXT.reset(token)
    record = _make_record("after")
    LogContextFilter().filter(record)
    assert record.task_id == "-"


def test_run_with_bound_context_propagates_request_id_into_thread():
    # token 复位：contextvar 在主线程 set 后不 Reset 会泄漏给同进程后续用例
    # （串行全量下曾把 request_id 带进 test_runtime_maintenance 的断言）。
    token = request_id_context.set("req-abc")
    try:
        seen: dict[str, object] = {}

        def job() -> None:
            record = _make_record("in-thread")
            LogContextFilter().filter(record)
            seen["task_id"] = record.task_id
            seen["request_id"] = request_id_context.get()

        thread = threading.Thread(
            target=run_with_bound_context(job, task_id=9, dataset_id="ds-x")
        )
        thread.start()
        thread.join(timeout=5)
    finally:
        request_id_context.reset(token)
    assert not thread.is_alive()
    assert seen == {"task_id": "9", "request_id": "req-abc"}


def test_run_with_bound_context_without_bindings_still_propagates_context():
    token = request_id_context.set("req-xyz")  # 同上：主线程绑定必须复位
    try:
        seen: dict[str, object] = {}

        def job() -> None:
            record = _make_record("m")
            LogContextFilter().filter(record)
            seen["request_id"] = request_id_context.get()
            seen["dataset_id"] = record.dataset_id

        thread = threading.Thread(target=run_with_bound_context(job))
        thread.start()
        thread.join(timeout=5)
    finally:
        request_id_context.reset(token)
    assert seen == {"request_id": "req-xyz", "dataset_id": "-"}
