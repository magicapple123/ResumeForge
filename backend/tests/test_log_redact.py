"""日志脱敏守卫（PR-20：日志脱敏白名单测试）。

钉住一件事：**异常进日志之前必须脱敏**。``logger.exception`` 会把整条 traceback
（含 ``raise ... from exc`` 链上的异常原文）渲染进日志——Pydantic ``ValidationError``
的消息里带 ``input_value=<原始输入>``，即模型返回的岗位描述/简历原文；异常消息里
也可能直接拼进密钥。这些都不能原样落盘。

测试用**真实异常对象**（真实 Pydantic ValidationError、真实 Exception）驱动
``log_exception_redacted``，断言渲染后的日志文本：
- 不含敏感原文（API Key、密码/token 赋值、简历原文标记、身份证号、base64 照片）；
- 仍保留 traceback 结构（Traceback/异常类型名），排障能力不打折。
"""

import logging
import time
from collections.abc import Iterator
from contextlib import contextmanager
from types import SimpleNamespace

import pytest
from app.models.apply import ApplyTask
from app.runtime import log_redact
from app.runtime.log_redact import (
    REDACT_FAILURE_PLACEHOLDER,
    REDACTED_PLACEHOLDER,
    RedactExceptionFilter,
    log_exception_redacted,
    redact_sensitive_text,
)
from app.services.apply.task_runner import TaskRunner
from app.services.browser.cdp_client import CdpClient
from pydantic import BaseModel, ValidationError

# 简历原文里才会出现的低频标记：出现在日志里就等于原文落盘。
RESUME_MARKER = "昼阳科技项目复盘原文-第3段"
PROMPT_MARKER = "系统提示词原文片段：请以资深HR视角改写"
ID_CARD = "110101199003078915"
API_KEY = "sk-proj-abcdefghij0123456789ABCDEFGHIJ"
TOKEN_VALUE = "ghp_16C7e42F292c6912E7710c838347Ae178B4a"
PASSWORD_VALUE = "Sup3rSecret!"
PHOTO_B64 = "data:image/png;base64," + "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=" * 4


class _ModelOutput(BaseModel):
    """模拟模型输出校验模型：拿非 dict 输入去校验，input_value 会带全部原文。"""

    summary: str


def _sensitive_text() -> str:
    """一份带敏感原文的"模型返回"：简历原文标记 + 身份证号 + base64 照片。"""
    return f"{RESUME_MARKER}；身份证 {ID_CARD}；照片 {PHOTO_B64}；{PROMPT_MARKER}"


def _capture_redacted_exception(
    caplog: pytest.LogCaptureFixture, exc: BaseException, message: str
) -> str:
    """模拟 API 层的 except 块：在异常上下文里走 log_exception_redacted。"""

    def trigger() -> None:
        try:
            raise exc
        except BaseException:  # noqa: BLE001 - 测试故意复现"异常落日志"的场景
            log_exception_redacted(logging.getLogger("test.log_redact"), message)

    with caplog.at_level(logging.ERROR, logger="test.log_redact"):
        trigger()
    return caplog.text


def test_validation_error_input_value_never_reaches_log(caplog: pytest.LogCaptureFixture) -> None:
    """Pydantic ValidationError（input_value 含模型返回原文）脱敏后不泄漏原文。"""
    try:
        _ModelOutput.model_validate(_sensitive_text())
    except ValidationError as exc:
        validation_error = exc

    text = _capture_redacted_exception(caplog, validation_error, "简历生成发生内部错误")

    assert RESUME_MARKER not in text
    assert ID_CARD not in text
    assert PHOTO_B64 not in text
    assert PROMPT_MARKER not in text
    # 脱敏痕迹与 traceback 结构仍在：排障时知道"这里有内容被遮掉了"。
    assert "已脱敏" in text
    assert "Traceback" in text
    assert "ValidationError" in text


def test_chained_validation_error_is_redacted_end_to_end(caplog: pytest.LogCaptureFixture) -> None:
    """``raise ... from ValidationError`` 链式场景：链上的原文也进不了日志。"""
    try:
        try:
            _ModelOutput.model_validate(_sensitive_text())
        except ValidationError as validation_error:
            raise RuntimeError("模型返回的岗位分析字段不完整，请重试") from validation_error
    except RuntimeError as runtime_error:
        chained = runtime_error

    text = _capture_redacted_exception(caplog, chained, "岗位需求解读发生内部错误")

    assert RESUME_MARKER not in text
    assert ID_CARD not in text
    assert PHOTO_B64 not in text
    assert "RuntimeError" in text


def test_api_key_and_assignments_are_masked(caplog: pytest.LogCaptureFixture) -> None:
    """异常消息里直接携带的密钥形态（API key、token/password 赋值）一律打码。"""
    exc = Exception(f"调用模型失败 api_key={API_KEY} token={TOKEN_VALUE} password={PASSWORD_VALUE}")

    text = _capture_redacted_exception(caplog, exc, "AI 助手模型调用失败")

    assert API_KEY not in text
    assert TOKEN_VALUE not in text
    assert PASSWORD_VALUE not in text
    # 键名保留（排障时仍知道哪个字段敏感）、值统一遮掉。
    assert "api_key=" in text
    assert "token=" in text
    assert "password=" in text


def test_redact_sensitive_text_is_a_pure_function() -> None:
    """``redact_sensitive_text`` 可独立复用：输入原文、输出脱敏文本。"""
    raw = f"input_value='{RESUME_MARKER}', input_type=str，密钥 {API_KEY}"
    cleaned = redact_sensitive_text(raw)
    assert RESUME_MARKER not in cleaned
    assert API_KEY not in cleaned
    assert cleaned != raw


def test_plain_exception_without_secrets_keeps_message_intact(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """没有敏感内容的普通异常只做脱敏、不损信息：异常消息仍然可见。"""
    text = _capture_redacted_exception(
        caplog, OSError(2, "No such file or directory: 'resume.docx'"), "模板导入分析发生内部错误"
    )

    # OSError(2, ...) raise 时按 errno 具体化为 FileNotFoundError：类型名仍在。
    assert "FileNotFoundError" in text


def test_outside_except_block_logs_plain_message(caplog: pytest.LogCaptureFixture) -> None:
    """不在异常上下文里调用时退化为普通 error 日志，不崩、不输出垃圾。"""
    with caplog.at_level(logging.ERROR, logger="test.log_redact"):
        log_exception_redacted(logging.getLogger("test.log_redact"), "普通错误 %s", "A1")
    assert "普通错误 A1" in caplog.text


# ===== 全局 handler 级脱敏（PR-20 对称项）=====


class _RedactingCapture(logging.Handler):
    """生产 handler 的替身：挂上全局脱敏 filter，捕获渲染后的日志行与原始 record。"""

    def __init__(self) -> None:
        super().__init__(level=logging.DEBUG)
        self.addFilter(RedactExceptionFilter())
        self.setFormatter(logging.Formatter("%(message)s"))
        self.lines: list[str] = []
        self.records: list[logging.LogRecord] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.records.append(record)
        self.lines.append(self.format(record))


@contextmanager
def _production_style_capture(logger_name: str) -> Iterator[_RedactingCapture]:
    """模拟生产装配：给指定 logger 挂一个带全局脱敏 filter 的捕获 handler。"""
    logger = logging.getLogger(logger_name)
    capture = _RedactingCapture()
    original_level = logger.level
    logger.setLevel(logging.DEBUG)
    logger.addHandler(capture)
    try:
        yield capture
    finally:
        logger.removeHandler(capture)
        logger.setLevel(original_level)


def _chained_sensitive_error() -> RuntimeError:
    """``raise ... from ValidationError``：链上带 input_value 原文的异常。"""
    try:
        _ModelOutput.model_validate(_sensitive_text())
    except ValidationError as validation_error:
        try:
            raise RuntimeError("模型返回的岗位分析字段不完整，请重试") from validation_error
        except RuntimeError as runtime_error:
            return runtime_error
    raise AssertionError("unreachable")  # pragma: no cover - _ModelOutput 校验必失败


def test_global_filter_redacts_plain_logger_exception() -> None:
    """handler 级 filter 兜底：普通 ``logger.exception`` 全局脱敏，无需逐点改 30 处调用。"""
    log = logging.getLogger("test.log_redact.global")
    with _production_style_capture("test.log_redact.global") as capture:
        try:
            raise _chained_sensitive_error()
        except RuntimeError:
            log.exception("简历生成发生内部错误")
    text = "\n".join(capture.lines)
    assert RESUME_MARKER not in text
    assert ID_CARD not in text
    assert PHOTO_B64 not in text
    assert PROMPT_MARKER not in text
    # 脱敏痕迹与 traceback 结构仍在：排障能力不打折。
    assert "已脱敏" in text
    assert "Traceback" in text
    assert "RuntimeError" in text
    # exc_info 保留不清：既有测试（caplog 断言 exc_info）与外部工具依赖它；
    # 防回归点——formatter 都优先走已清洗的 exc_text，不重渲染原文。
    assert capture.records[0].exc_info is not None
    assert capture.records[0].exc_text is not None
    assert RESUME_MARKER not in capture.records[0].exc_text


def test_filter_cleans_each_record_once_across_handlers(monkeypatch: pytest.MonkeyPatch) -> None:
    """同一条 record 流经多个 handler 只清洗一次（性能敏感路径避免重复脱敏）。"""
    original_redact = log_redact.redact_sensitive_text
    calls: list[int] = []

    def counting_redact(text: str) -> str:
        calls.append(1)
        return original_redact(text)

    monkeypatch.setattr(log_redact, "redact_sensitive_text", counting_redact)
    log = logging.getLogger("test.log_redact.once")
    with _production_style_capture("test.log_redact.once") as own_capture:
        root_capture = _RedactingCapture()
        root_logger = logging.getLogger()
        root_logger.addHandler(root_capture)
        try:
            try:
                raise _chained_sensitive_error()
            except RuntimeError:
                log.exception("多 handler 场景")
        finally:
            root_logger.removeHandler(root_capture)
    assert len(calls) == 1
    assert len(own_capture.lines) == 1
    assert len(root_capture.lines) == 1
    assert RESUME_MARKER not in "\n".join(own_capture.lines + root_capture.lines)


def test_filter_redacts_precached_exc_text_without_exc_info() -> None:
    """无 exc_info 但带预渲染 traceback（跨进程队列等）的 record 也原地清洗。"""
    record = logging.LogRecord(
        name="test.log_redact.cached",
        level=logging.ERROR,
        pathname=__file__,
        lineno=1,
        msg="跨进程异常",
        args=(),
        exc_info=None,
    )
    record.exc_text = f"input_value='{RESUME_MARKER}', input_type=str"
    assert RedactExceptionFilter().filter(record) is True
    assert RESUME_MARKER not in record.exc_text
    assert REDACTED_PLACEHOLDER in record.exc_text


def test_redactor_failure_falls_back_to_discarding_exception_text(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """脱敏器自身抛错：丢弃异常文本并落占位，绝不因脱敏打断业务日志。"""

    def exploding_redact(_text: str) -> str:
        raise RuntimeError("redact_sensitive_text 注入失败")

    monkeypatch.setattr(log_redact, "redact_sensitive_text", exploding_redact)
    log = logging.getLogger("test.log_redact.fallback")
    with _production_style_capture("test.log_redact.fallback") as capture:
        try:
            raise _chained_sensitive_error()
        except RuntimeError:
            log.exception("业务日志必须照常落盘")
    text = "\n".join(capture.lines)
    assert RESUME_MARKER not in text
    assert REDACT_FAILURE_PLACEHOLDER in text
    assert "业务日志必须照常落盘" in text


def test_drill_contract_error_log_is_redacted_end_to_end(client, monkeypatch) -> None:
    """冒烟（drill.py「生成面试深挖契约」调用点）：模型炸出敏感 ValidationError，
    经真实路由 → ``logger.exception`` → 全局 filter，日志里只有脱敏痕迹。"""
    import app.api.drill as drill_api

    fake_claim = SimpleNamespace(id=1, title="主张", subject="主题")

    async def exploding_plan(*_args, **_kwargs):
        raise _chained_sensitive_error()

    monkeypatch.setattr(drill_api, "select_claims", lambda _db, _ids, _n: [fake_claim])
    monkeypatch.setattr(drill_api, "llm_is_configured", lambda _config: True)
    monkeypatch.setattr(drill_api, "create_provider", lambda _config: object())
    monkeypatch.setattr(drill_api, "generate_plan", exploding_plan)

    with _production_style_capture("app.api.drill") as capture:
        response = client.post("/api/drill", json={})

    assert response.status_code == 502
    text = "\n".join(capture.lines)
    assert RESUME_MARKER not in text
    assert ID_CARD not in text
    assert PHOTO_B64 not in text
    assert "已脱敏" in text
    assert "Traceback" in text


def test_profile_parse_error_log_is_redacted_end_to_end(client, monkeypatch) -> None:
    """冒烟（profile.py「个人资料 AI 识别」调用点）：敏感异常脱敏，API 照常回退本地解析。"""
    import app.api.profile as profile_api

    async def exploding_extract(*_args, **_kwargs):
        raise _chained_sensitive_error()

    monkeypatch.setattr(profile_api, "llm_is_configured", lambda _config: True)
    monkeypatch.setattr(profile_api, "create_provider", lambda _config: object())
    monkeypatch.setattr(profile_api, "extract_profile_text", exploding_extract)

    with _production_style_capture("app.api.profile") as capture:
        response = client.post(
            "/api/profile/parse-text",
            json={"text": "Name: Li Ming\nWork Position: Backend Engineer"},
        )

    # 脱敏绝不打断业务：接口照常返回本地解析草稿。
    assert response.status_code == 200
    text = "\n".join(capture.lines)
    assert RESUME_MARKER not in text
    assert ID_CARD not in text
    assert "已脱敏" in text


class _SmokeCdp(CdpClient):
    """最小 no-op 客户端：顶层异常在 registry.all() 就发生，client 不会被用到。"""

    def list_targets(self):
        return []

    def new_tab(self, url: str = "about:blank") -> str:
        return "target-1"

    def send(self, method, params=None, *, timeout=None):
        return {}

    def evaluate(self, expression, *, timeout=None):
        return None

    def set_file_input(self, selector, files, *, timeout=None):
        return None

    def navigate(self, url, *, timeout=None):
        return {}

    def close(self):
        return None


def test_task_runner_top_level_error_log_is_redacted_end_to_end(db_session) -> None:
    """冒烟（apply task_runner 工作线程顶层兜底调用点）：线程异常的日志脱敏，
    任务照常置失败、线程干净退出——全局 filter 不改变任何既有行为。"""
    task = ApplyTask(
        kind="collect",
        status="pending",
        total=5,
        config={"keywords": ["后端"], "per_task_limit": 5},
    )
    db_session.add(task)
    db_session.commit()

    class _SensitiveBrokenRegistry:
        def all(self):
            raise _chained_sensitive_error()

        def for_job(self, _job):  # pragma: no cover - 不应走到这里
            raise AssertionError("不应走到这里")

    runner = TaskRunner(
        registry=_SensitiveBrokenRegistry(),
        client_factory=lambda _config: _SmokeCdp(),
        sleeper=lambda _seconds: None,
        clock=lambda: 0.0,
        poll_interval=0.01,
    )
    with _production_style_capture("app.services.apply.task_runner") as capture:
        runner.start(task.id)
        deadline = time.monotonic() + 5.0
        while runner.is_running() and time.monotonic() < deadline:
            time.sleep(0.01)

    db_session.expire_all()
    stored = db_session.get(ApplyTask, task.id)
    assert stored.status == "failed"
    assert runner.is_running() is False
    text = "\n".join(capture.lines)
    assert RESUME_MARKER not in text
    assert ID_CARD not in text
    assert "已脱敏" in text
    assert "任务执行发生内部错误" in text
