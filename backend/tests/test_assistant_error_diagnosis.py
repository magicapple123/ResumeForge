# SPDX-License-Identifier: Apache-2.0
"""T31：只读错误诊断工具 ``diagnose_recent_errors`` 的守卫。

a. 真实格式的 422 日志样例能解析出白名单字段（时间/级别/logger/异常类名/HTTP 状态/路由模板/request_id）；
b. 投毒：手机号 / ``sk-`` Key / 照片 data URL 出现在日志行里，返回的所有字段逐字段都不含原串；
c. 不返回日志 message 原文与 traceback 自由文本；
d. 日志文件删除 / 文件日志关闭 / 格式不符 → 返回「日志不可用」且不抛错；
e. ``writes=False`` / ``permission=READ_ONLY`` / ``preview=None``；DB 源只读枚举字段，
   ``ai_task.error`` / ``failure_detail`` / 网申填写值等自由文本一律不出现在结果里。
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from pathlib import Path

from app import database
from app.models.ai_task import AiTask
from app.models.apply import ApplyTask, ApplyTaskItem
from app.models.web_form_record import WebFormFillRecord
from app.services.assistant_tools import error_diagnosis as diagnosis
from app.services.assistant_tools import execute_tool, get_tool
from app.services.assistant_tools._types import ToolPermission
from app.services.assistant_tools.error_diagnosis import HTTP_STATUS_NOTES

# 结果白名单字段（任务书口径）：日志 message 原文 / traceback / 请求体都不能出现。
ENTRY_FIELDS = {
    "ts",
    "level",
    "logger",
    "error_class",
    "http_status",
    "route_template",
    "request_id",
    "source",
    "count",
    "error_note",
    "next_action",
}

PHONE = "13800000000"
API_KEY = "sk-proj-abcdefghijklmnopqrstuvwxyz0123456789"
DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="


def _ts(minutes_ago: float = 2) -> str:
    moment = datetime.now() - timedelta(minutes=minutes_ago)
    return moment.strftime("%Y-%m-%d %H:%M:%S,") + f"{moment.microsecond // 1000:03d}"


def _write_log(tmp_path, lines: list[str]) -> Path:
    log_dir = tmp_path / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / "backend.log"
    log_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return log_path


def _patch_log(monkeypatch, path, *, enabled: bool = True) -> None:
    monkeypatch.setattr(diagnosis, "_log_file_path", lambda: path)
    monkeypatch.setattr(diagnosis, "_log_file_enabled", lambda: enabled)


def _run(arguments: dict) -> str:
    with database.SessionLocal() as session:
        return execute_tool(session, "diagnose_recent_errors", arguments).text


def _payload(arguments: dict) -> dict:
    return json.loads(_run(arguments))


def _seed_db_sources(db_session) -> None:
    """三个 DB 源各造一条失败记录；自由文本字段写入"毒串"，断言它们不出现在结果里。"""
    db_session.add(
        AiTask(
            kind="webform_fill",
            status="failed",
            label="网申填充",
            error="SECRET_AI_TASK_ERROR_TEXT",
            payload={"jd": "SECRET_PAYLOAD"},
        )
    )
    task = ApplyTask(kind="apply", status="completed")
    db_session.add(task)
    db_session.flush()
    db_session.add(
        ApplyTaskItem(
            task_id=task.id,
            status="failed",
            failure_category="login_required",
            failure_step="opening",
            failure_detail="SECRET_APPLY_DETAIL https://example.com/apply?phone=" + PHONE,
        )
    )
    db_session.add(
        WebFormFillRecord(
            url="https://example.com/form?phone=" + PHONE,
            page_title="SECRET_PAGE_TITLE",
            items=[{"field": "phone", "value": PHONE, "status": "failed"}],
            failed=2,
            unverified=1,
            page_snapshot=[{"label": "手机号", "value": PHONE}],
        )
    )
    db_session.commit()


# ===== a. 真实格式的 422 日志样例 =====


def test_parses_a_real_format_422_log_sample(db_session, tmp_path, monkeypatch):
    """按 ``application._LOG_FORMAT`` 的真实格式解析：多行 traceback + status/path。"""
    lines = [
        f"{_ts(3)} ERROR [app.application] [request_id=8d6c82aad494487cb770a4f2e0f00966] "
        f"未处理的请求异常 status=422 path=/api/resumes/123/preflight",
        "Traceback (most recent call last):",
        '  File "D:\\ResumeForge\\backend\\app\\application.py", line 361, in unhandled_exception',
        '    raise ValueError("bad")',
        "pydantic_core._pydantic_core.ValidationError: 1 validation error for PreflightRequest",
    ]
    _patch_log(monkeypatch, _write_log(tmp_path, lines))
    payload = _payload({"since_minutes": 60, "scope": "all"})
    assert payload["log_status"] == "ok"
    log_entries = [entry for entry in payload["entries"] if entry["source"] == "logs"]
    assert log_entries, "样例日志没有被解析出任何条目"
    entry = next(item for item in log_entries if item["http_status"] == 422)
    assert entry["level"] == "ERROR"
    assert entry["logger"] == "app.application"
    assert entry["error_class"] == "ValidationError"
    assert entry["route_template"] == "/api/resumes/:id/preflight"
    assert entry["request_id"] == "8d6c82aad494487cb770a4f2e0f00966"
    assert "参数校验失败" in entry["error_note"]
    assert entry["next_action"]


def test_global_validation_handler_line_is_visible_in_every_business_scope(
    db_session, tmp_path, monkeypatch
):
    """全局 422 handler 的 warning 行在任何业务 scope 下都要查得到（T31 补全）。

    这行日志挂在 ``app.application`` 上，不属于 export/apply/webform/assistant 任何一条
    业务线；不放行跨 scope 的话，「导出被 422 拦下」在 scope=export 里永远看不到，工具只能
    回「最近没有异常」。
    """
    lines = [
        f"{_ts(2)} WARNING [app.application] [request_id=0123456789abcdef0123456789abcdef] "
        "校验失败 status=422 path=/api/resumes/123/export type=extra_forbidden",
    ]
    _patch_log(monkeypatch, _write_log(tmp_path, lines))
    for scope in ("all", "export", "apply", "webform", "assistant"):
        payload = _payload({"since_minutes": 60, "scope": scope})
        log_entries = [item for item in payload["entries"] if item["source"] == "logs"]
        assert len(log_entries) == 1, f"scope={scope} 下没查到全局 422 日志"
        entry = log_entries[0]
        assert entry["level"] == "WARNING"
        assert entry["logger"] == "app.application"
        assert entry["http_status"] == 422
        assert entry["route_template"] == "/api/resumes/:id/export"
        assert entry["request_id"] == "0123456789abcdef0123456789abcdef"
        # 说明与建议动作只能来自常量表（HTTP_STATUS_NOTES），不能取自日志原文。
        assert entry["error_note"] == HTTP_STATUS_NOTES[422][0]
        assert entry["next_action"] == HTTP_STATUS_NOTES[422][1]


# ===== b. 投毒：敏感原串不得出现在任何字段 =====
def test_poisoned_log_values_never_reach_the_result(db_session, tmp_path, monkeypatch):
    lines = [
        f"{_ts(2)} WARNING [app.services.assistant.assistant_web_search] "
        f"[request_id=deadbeefdeadbeefdeadbeefdeadbeef] 搜索失败 phone={PHONE} key={API_KEY} "
        f"avatar={DATA_URL}",
        f"{_ts(1)} ERROR [app.services.apply.task_runner] "
        f"[request_id=cafebabecafebabecafebabecafebabe] 投递失败 status=422 path=/api/jobs/{PHONE}",
        # 全局 422 handler 的行也投毒：路径带查询串里的手机号、类型后面跟着 Key 与照片 data URL。
        f"{_ts(0.5)} WARNING [app.application] "
        f"[request_id=feedfacefeedfacefeedfacefeedface] 校验失败 status=422 "
        f"path=/api/claims?page=0&phone={PHONE} type=extra_forbidden key={API_KEY} avatar={DATA_URL}",
        '  File "x.py", line 1, in boom',
        "RuntimeError: boom",
    ]
    _patch_log(monkeypatch, _write_log(tmp_path, lines))
    payload = _payload({"since_minutes": 60})
    text = json.dumps(payload, ensure_ascii=False)
    # 投毒行必须真的被解析到（否则"没泄漏"只是因为压根没读这条），再断言逐字段干净。
    assert any(entry["http_status"] == 422 for entry in payload["entries"]), "422 日志行没被解析"
    for secret in (PHONE, API_KEY, DATA_URL, "iVBORw0KGgo"):
        assert secret not in text, f"敏感原串泄漏到结果：{secret[:24]}"
    for entry in payload["entries"]:
        assert set(entry) <= ENTRY_FIELDS, f"出现白名单之外的字段：{set(entry) - ENTRY_FIELDS}"
        for field_name, value in entry.items():
            assert PHONE not in str(value), (entry, field_name)
            assert API_KEY not in str(value), (entry, field_name)
            assert DATA_URL not in str(value), (entry, field_name)


# ===== c. 不返回日志 message 原文 / traceback =====


def test_log_message_and_traceback_text_are_not_returned(db_session, tmp_path, monkeypatch):
    marker = "LOG_MESSAGE_MARKER_7f2a"
    lines = [
        f"{_ts(2)} ERROR [app.services.llm.openai_compat] "
        f"[request_id=deadbeefdeadbeefdeadbeefdeadbeef] 模型调用失败 {marker}",
        "Traceback (most recent call last):",
        '  File "D:\\ResumeForge\\backend\\app\\services\\llm\\openai_compat.py", line 558',
        f"RuntimeError: {marker} traceback body",
    ]
    _patch_log(monkeypatch, _write_log(tmp_path, lines))
    text = _run({"since_minutes": 60})
    assert marker not in text, "日志 message / traceback 原文进入了工具结果"
    payload = json.loads(text)
    entry = next(item for item in payload["entries"] if item["source"] == "logs")
    assert entry["error_class"] == "RuntimeError"
    assert entry["error_note"] == "运行时异常"


# ===== d. 日志不可用：不抛错 =====


def test_missing_disabled_or_broken_log_is_reported_not_raised(db_session, tmp_path, monkeypatch):
    _patch_log(monkeypatch, tmp_path / "missing" / "backend.log", enabled=True)
    missing = _payload({"since_minutes": 60})
    assert "日志不可用" in missing["log_status"]

    _patch_log(monkeypatch, tmp_path / "whatever.log", enabled=False)
    disabled = _payload({"since_minutes": 60})
    assert disabled["log_status"] == "日志不可用（文件日志已关闭）"

    broken_path = tmp_path / "broken.log"
    broken_path.write_text("this is not a backend log line\nnor this one\n", encoding="utf-8")
    _patch_log(monkeypatch, broken_path)
    broken = _payload({"since_minutes": 60})
    assert "日志不可用" in broken["log_status"]


# ===== e. 只读规格 + DB 源只取枚举字段 =====


def test_diagnose_recent_errors_is_registered_as_read_only():
    tool = get_tool("diagnose_recent_errors")
    assert tool is not None
    assert tool.writes is False
    assert tool.permission is ToolPermission.READ_ONLY
    assert tool.preview is None


def test_db_sources_only_expose_enumerated_fields(db_session, tmp_path, monkeypatch):
    _seed_db_sources(db_session)
    _patch_log(monkeypatch, _write_log(tmp_path, []), enabled=False)
    payload = _payload({"since_minutes": 60, "scope": "all"})
    sources = {entry["source"] for entry in payload["entries"]}
    assert {"ai_task", "apply_record", "web_form_record"} <= sources
    text = json.dumps(payload, ensure_ascii=False)
    for secret in (
        "SECRET_AI_TASK_ERROR_TEXT",
        "SECRET_PAYLOAD",
        "SECRET_APPLY_DETAIL",
        "SECRET_PAGE_TITLE",
        PHONE,
    ):
        assert secret not in text, f"DB 源自由文本泄漏：{secret}"
    classes = {entry["error_class"] for entry in payload["entries"]}
    assert {"task_failed", "login_required", "webform_failed", "webform_unverified"} <= classes


def test_scope_and_limit_are_respected(db_session, tmp_path, monkeypatch):
    _seed_db_sources(db_session)
    _patch_log(monkeypatch, _write_log(tmp_path, []), enabled=False)
    scoped = _payload({"since_minutes": 60, "scope": "apply"})
    assert {entry["source"] for entry in scoped["entries"]} == {"apply_record"}
    limited = _payload({"since_minutes": 60, "limit": 1})
    assert len(limited["entries"]) == 1
    assert limited["total_groups"] > 1
    assert limited["truncated"] is True
