"""异常落日志前的脱敏工具（PR-20 审计项：日志脱敏白名单）。

背景：``logger.exception`` 会把整条 traceback（含 ``raise ... from exc`` 链上的
异常原文）渲染进日志。业务层把模型输出的 ``ValidationError`` 链在 LLMError 之后
（如 ``services/job/job_analysis.py``），而 Pydantic 的错误消息里带
``input_value=<原始输入>``——那就是模型返回的岗位描述/简历原文。审计指出这类内容
会随 ``logger.exception`` 原样落盘。

这里提供两层：

- ``redact_sensitive_text(text)``：对**已渲染成文本**的异常做模式清洗——遮掉
  ``input_value=`` 载荷、API Key、token/password 赋值与 base64 照片。纯函数，
  可独立复用与测试；
- ``log_exception_redacted(logger, msg, *args)``：``logger.exception`` 的脱敏
  替代——把 traceback 渲染成文本、清洗后再落日志。traceback 结构（调用栈与
  异常类型名）保留，排障能力不打折；遮掉的内容以「已脱敏」占位提示。

实现边界（如实说明）：

- 这是**文本级模式清洗**，不是白名单式重放。``input_value``/密钥/照片是能稳定
  识别的形态；异常消息里自由拼进的任意长文无法可靠识别，靠上游约束——模型输出
  校验失败时业务层抛的是**固定中文文案**的 ``LLMError``（原文只出现在链上的
  ``ValidationError`` 里），所以清洗 ``input_value`` 即覆盖主路径；
- 仓库另有两条脱敏实现：``services/privacy.py`` 的 ``redact``（结构化
  ``ResumeContent`` 遮罩，导出用）与风险扫描的敏感模式识别。它们的输入是结构化
  对象而非异常文本，无法直接复用；占位符沿用同一惯例（``***`` / 「已脱敏」），
  不新增第二套语义。
"""

from __future__ import annotations

import logging
import re
import sys
import traceback
from types import TracebackType

# 占位符：与 services/privacy.py 的 MASK 同一惯例（三颗星不泄漏长度信息）。
MASK = "***"
# 中文占位：在 traceback 里出现时明确表示"这里有一段被遮掉的内容"。
REDACTED_PLACEHOLDER = "[已脱敏]"

# Pydantic v2 的错误消息形态：``input_value=<repr>, input_type=<type>``。
# repr 不会跨行（字符串里的换行会被转义成 \n），单行非贪婪到 ", input_type=" 即可。
_INPUT_VALUE_RE = re.compile(r"input_value=(?P<value>.*?), input_type=")

# base64 图片/照片 data URL：长 base64 载荷整段遮掉。
_DATA_URL_RE = re.compile(r"data:(?:image|application)/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]{24,}")

# OpenAI 风格 API Key（sk- 前缀，含 sk-proj- 等变体）。
_API_KEY_RE = re.compile(r"\bsk-[A-Za-z0-9_-]{12,}\b")

# 显式的敏感赋值形态：password=xxx / token: xxx / api_key = "xxx" / Bearer xxx。
_SECRET_ASSIGN_RE = re.compile(
    r"(?i)\b(password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|token|authorization)"
    r"(\s*[=:]\s*)[\"']?[^\s\"',;&<>]{4,}"
)
_BEARER_RE = re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._-]{12,}")


def redact_sensitive_text(text: str) -> str:
    """对一段（可能含 traceback 的）日志文本做敏感信息清洗，返回新文本。

    清洗的形态：Pydantic ``input_value`` 载荷、base64 照片、``sk-`` API Key、
    ``Bearer`` 凭证与 password/token/secret/api_key 的赋值键值对。没有敏感内容时
    返回与输入等价的文本（不无损、不重排）。
    """

    def _mask_input_value(match: re.Match[str]) -> str:
        return f"input_value='{REDACTED_PLACEHOLDER}', input_type="

    cleaned = _INPUT_VALUE_RE.sub(_mask_input_value, text)
    cleaned = _DATA_URL_RE.sub(f"data:image/*;base64,{MASK}", cleaned)
    cleaned = _API_KEY_RE.sub("sk-" + MASK, cleaned)
    cleaned = _BEARER_RE.sub("Bearer " + MASK, cleaned)
    # 赋值形态只遮值、保留键名与分隔符（排障时仍知道是哪个字段敏感）。
    cleaned = _SECRET_ASSIGN_RE.sub(lambda m: f"{m.group(1)}{m.group(2)}{MASK}", cleaned)
    return cleaned


def log_exception_redacted(logger: logging.Logger, msg: str, *args: object) -> None:
    """``logger.exception`` 的脱敏替代：traceback 渲染成文本、清洗后落日志。

    用法与 ``logger.exception`` 一致——必须在 ``except`` 块里调用（依赖
    ``sys.exc_info()``）。要点：

    - 不走 ``exc_info`` 通道：改把 traceback 先渲染成文本、清洗，再作为消息体
      落盘。这样敏感内容**在进入任何 handler/formatter 之前**就被遮掉；
    - traceback 结构（调用栈、异常类型与链式 `` caused by `` 段）保留；
    - 不在异常上下文里调用时退化为普通 ``logger.error``，不崩、不输出垃圾。
    """
    exc_info = _current_exc_info()
    if exc_info is None:
        logger.error(msg, *args)
        return
    rendered = "".join(traceback.format_exception(*exc_info))
    # 消息与 traceback 分两个参数传，避免拼接文本里的 % 被二次格式化。
    logger.error("%s\n%s", (msg % args) if args else msg, redact_sensitive_text(rendered))


def _current_exc_info() -> tuple[type[BaseException], BaseException, TracebackType | None] | None:
    """取当前异常三元组；无异常上下文时返回 None。"""
    exc_type, exc_value, tb = sys.exc_info()
    if exc_type is None or exc_value is None:
        return None
    return exc_type, exc_value, tb


__all__ = ["MASK", "REDACTED_PLACEHOLDER", "log_exception_redacted", "redact_sensitive_text"]
