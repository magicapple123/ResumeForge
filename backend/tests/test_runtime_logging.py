"""RF-20：runtime 日志有界与故障不拖死主功能的守卫测试。

钉住四件事：
- 默认（log_json_format=False）日志格式逐字节不变：formatter 的格式串就是现行
  ``_LOG_FORMAT``；
- 开启 log_json_format 后输出 JSON 行，含 time/level/logger/message/task_id/
  dataset_id/request_id 结构化字段；
- 应用内文件 handler 是 RotatingFileHandler 且有界（5MB×5）——stdout 重定向的
  runtime/*.log 是启动器侧的已知限制（scripts 归 RF-21/维护者）；
- 磁盘不可写（handler 创建失败）与运行中 emit 失败都不影响 API 响应。
"""

import json
import logging
from logging.handlers import RotatingFileHandler

import pytest
from app import application
from app.main import app
from fastapi.testclient import TestClient


def test_default_formatter_keeps_legacy_text_format_byte_for_byte():
    """默认关闭 JSON：现行文本格式逐字节不变（有测试钉住）。"""
    formatter = application._build_formatter()
    assert isinstance(formatter, logging.Formatter)
    assert not isinstance(formatter, application.JsonLogFormatter)
    assert formatter._fmt == application._LOG_FORMAT


def test_json_formatter_emits_structured_fields_with_thread_context():
    from app.runtime.log_context import LogContextFilter, bound_context

    formatter = application.JsonLogFormatter()
    with bound_context(task_id="42", dataset_id="main"):
        record = logging.LogRecord(
            name="app.test", level=logging.WARNING, pathname=__file__, lineno=1,
            msg="生成阶段 %s", args=("渲染",), exc_info=None,
        )
        # 生产链路里字段由 handler 上的 LogContextFilter 注入，格式化发生在其后。
        LogContextFilter().filter(record)
    payload = json.loads(formatter.format(record))
    assert payload["level"] == "WARNING"
    assert payload["logger"] == "app.test"
    assert payload["message"] == "生成阶段 渲染"
    assert payload["task_id"] == "42"
    assert payload["dataset_id"] == "main"
    assert payload["request_id"] == "-"
    assert "time" in payload


def test_build_formatter_switches_to_json_when_enabled(monkeypatch: pytest.MonkeyPatch):
    class _FakeSettings:
        log_json_format = True

    monkeypatch.setattr(application, "get_settings", lambda: _FakeSettings())
    assert isinstance(application._build_formatter(), application.JsonLogFormatter)


def test_file_handler_is_bounded_rotating(tmp_path, monkeypatch: pytest.MonkeyPatch):
    """应用内文件日志必须滚动有界；stdout 重定向（runtime/*.log）不在本侧管辖。"""
    monkeypatch.setattr(application, "_file_log_handler", None)
    handler = application.attach_file_log_handler(tmp_path)
    assert isinstance(handler, RotatingFileHandler)
    assert handler.maxBytes == application._LOG_FILE_MAX_BYTES == 5 * 1024 * 1024
    assert handler.backupCount == application._LOG_FILE_BACKUP_COUNT == 5
    # 清理：从根 logger 摘掉并还原全局标记，避免污染同进程的其它用例。
    logging.getLogger().removeHandler(handler)
    handler.close()
    monkeypatch.setattr(application, "_file_log_handler", None)


def test_unwritable_log_dir_does_not_break_startup(tmp_path, monkeypatch: pytest.MonkeyPatch):
    """磁盘不可写：放弃文件日志（返回 None）、绝不抛异常，控制台输出照常。"""
    blocking = tmp_path / "logs"
    blocking.write_text("not a directory", encoding="utf-8")  # mkdir(exist_ok=True) 会失败
    monkeypatch.setattr(application, "_file_log_handler", None)
    handler = application.attach_file_log_handler(blocking)
    assert handler is None
    monkeypatch.setattr(application, "_file_log_handler", None)


class _BrokenStream:
    """模拟磁盘满：write 一律抛 OSError（StreamHandler.emit 内部会走 handleError 吞掉）。"""

    def write(self, *_args, **_kwargs):
        raise OSError("disk full")

    def flush(self) -> None:
        pass


def test_broken_log_handler_does_not_break_api_response():
    """日志系统故障不拖死主功能：handler 写盘失败时，应用照常启动、照常响应。

    启动自检的日志行会触发坏 handler（模拟磁盘不可写/轮转失败的 emit 路径），
    logging 的 handleError 契约保证异常不上抛；这里钉住这一性质对 API 的效果。
    """
    broken = logging.StreamHandler(_BrokenStream())
    root = logging.getLogger()
    root.addHandler(broken)
    try:
        with TestClient(app) as client:
            response = client.get("/api/health")
            assert response.status_code == 200
            assert response.json()["status"] == "ok"
            # 同进程内并发再发一次：失败 handler 常驻也不影响后续请求。
            follow_up = client.get("/api/health")
    finally:
        root.removeHandler(broken)
    assert follow_up.status_code == 200


def test_logging_path_makes_no_network_calls(monkeypatch: pytest.MonkeyPatch):
    """不默认发外部遥测：日志全链路（formatter/filter/handler.emit）无网络调用。

    钉法：给 socket.connect 装上哨兵——日志系统在记录、格式化与故障处理路径上
    任何一步尝试建连都会让本测试变红。"""
    import socket

    def _deny_connect(self, *_args, **_kwargs):
        raise AssertionError("日志路径尝试发起网络连接（违反全离线承诺）")

    monkeypatch.setattr(socket.socket, "connect", _deny_connect)
    record = logging.LogRecord(
        name="app.test", level=logging.INFO, pathname=__file__, lineno=1,
        msg="离线日志", args=(), exc_info=None,
    )
    assert application.LogContextFilter().filter(record) is True
    assert application.JsonLogFormatter().format(record)
    broken = logging.StreamHandler(_BrokenStream())
    broken.emit(record)  # handleError 吞掉写盘异常，同样不触网
