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

import pytest
from app.runtime.log_redact import log_exception_redacted, redact_sensitive_text
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
