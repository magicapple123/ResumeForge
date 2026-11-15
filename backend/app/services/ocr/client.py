# SPDX-License-Identifier: Apache-2.0
"""DeepSeek OCR 工具端点的 HTTP 客户端（``POST /v1/tools/ocr``）。

为什么单独一层：这是**同步长连接**（上传 + 逐页识别 + 返回，最长 180 秒），与
``search/deepseek.py`` 的短请求语义完全不同——它不能重试（重试一次就是两倍页数
计费），也不能在事件循环里直接调（会卡住整个后端）。调用方负责把它放进线程池。

响应形状（官方文档）：识别期间服务端会持续发送换行保活，之后一次性发送一个 JSON
对象；换行是**前导空白**，所以整段响应可以直接 ``json.loads``。识别已经开始（HTTP
200）之后仍可能失败，此时响应体是 ``{"error": {...}}`` 而不是结果——这一条必须判，
否则失败会被当成"0 页的识别成功"。
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any

import httpx

logger = logging.getLogger(__name__)

OCR_ENDPOINT = "https://api.deepseek.com/v1/tools/ocr"
# 官方只有这两个 purpose。``text_recognition`` 对没有图片的 Word/PPT 直接抽文字，
# 其余文件逐页识别；``rich_layout_recognition`` 一律逐页识别（带坐标 token）。
OCR_PURPOSES = ("text_recognition", "rich_layout_recognition")
DEFAULT_PURPOSE = "text_recognition"

# 单次识别的服务端上限是 180 秒（含上传、识别与结果返回）；客户端留一点余量，
# 否则会在结果到达前自己先断开，白花一次识别费用。
_TOTAL_TIMEOUT_SECONDS = 200.0
_CONNECT_TIMEOUT_SECONDS = 10.0
_MAX_FILE_BYTES = 100 * 1024 * 1024

# 状态码 → (原因码, 是否值得稍后重试)。408 是"上传太慢"，重试通常也没用（同一网络）。
_STATUS_REASONS: dict[int, tuple[str, bool]] = {
    400: ("bad_request", False),
    401: ("unauthorized", False),
    402: ("insufficient_balance", False),
    403: ("forbidden", False),
    408: ("upload_timeout", False),
    413: ("file_too_large", False),
    429: ("too_many_recognitions", True),
    500: ("submit_failed", True),
    503: ("service_busy", True),
    504: ("timeout", True),
}

# 响应体里的 error.message 是给开发者看的英文；这里按关键片段归成因，供 UI 说人话。
_MESSAGE_REASONS: tuple[tuple[str, str], ...] = (
    ("password", "password_protected"),
    ("more than 1000 pages", "too_many_pages"),
    ("100 MiB", "file_too_large"),
    ("did not finish", "timeout"),
    ("temporarily unavailable", "service_busy"),
    ("Internal Server Error", "submit_failed"),
    ("could not be parsed", "unparsable"),
    ("format is not supported", "unparsable"),
    ("image could not be decoded", "unparsable"),
)


class OcrError(RuntimeError):
    """OCR 不可用或识别失败。``code`` 是机器可读原因，``retryable`` 供调用方决定是否提示重试。"""

    def __init__(self, code: str, *, detail: str = "", retryable: bool = False) -> None:
        super().__init__(detail or code)
        self.code = code
        self.detail = detail
        self.retryable = retryable


@dataclass(frozen=True)
class OcrPage:
    index: int
    text: str
    finish_reason: str


@dataclass(frozen=True)
class OcrResult:
    request_id: str
    purpose: str
    page_count: int
    pages: tuple[OcrPage, ...]

    @property
    def text(self) -> str:
        """逐页文本按页序拼接（页间空行分隔，便于本地规则把段落切开）。"""
        return "\n\n".join(page.text.strip() for page in self.pages if page.text.strip())

    @property
    def truncated_pages(self) -> tuple[int, ...]:
        """``finish_reason == "length"`` 的页码（1 起始）：那一页输出被截断，需要提示。"""
        return tuple(page.index + 1 for page in self.pages if page.finish_reason == "length")


def _reason_from_message(message: str) -> str:
    lowered = (message or "").lower()
    for needle, reason in _MESSAGE_REASONS:
        if needle.lower() in lowered:
            return reason
    return "recognition_failed"


def _raise_for_status(status: int, body: Any) -> None:
    reason, retryable = _STATUS_REASONS.get(status, (f"http_{status}", False))
    detail = ""
    if isinstance(body, dict):
        error = body.get("error")
        if isinstance(error, dict):
            detail = str(error.get("message") or "")
    raise OcrError(reason, detail=detail, retryable=retryable)


def _parse_body(response: httpx.Response) -> dict[str, Any]:
    # 保活换行是前导空白，``json.loads`` 直接能吃掉；不要先 strip 掉再判空，
    # 也不要用 ``response.json()``（某些代理会带 BOM，报错信息更难读）。
    try:
        body = json.loads(response.text or "{}")
    except ValueError as exc:
        raise OcrError("bad_json", retryable=True) from exc
    if not isinstance(body, dict):
        raise OcrError("bad_json", retryable=True)
    return body


def _to_result(body: dict[str, Any], purpose: str) -> OcrResult:
    raw_pages = body.get("pages")
    pages: list[OcrPage] = []
    for position, item in enumerate(raw_pages if isinstance(raw_pages, list) else []):
        if not isinstance(item, dict):
            continue
        index = item.get("index")
        pages.append(
            OcrPage(
                index=int(index) if isinstance(index, int) else position,
                text=str(item.get("text") or ""),
                finish_reason=str(item.get("finish_reason") or "stop"),
            )
        )
    page_count = body.get("page_count")
    return OcrResult(
        request_id=str(body.get("id") or ""),
        purpose=str(body.get("purpose") or purpose),
        page_count=int(page_count) if isinstance(page_count, int) else len(pages),
        pages=tuple(pages),
    )


def recognize_document(
    raw: bytes,
    filename: str,
    api_key: str,
    *,
    purpose: str = DEFAULT_PURPOSE,
    content_type: str = "",
    timeout: float = _TOTAL_TIMEOUT_SECONDS,
) -> OcrResult:
    """识别一份文档或图片，返回逐页文本。

    同步阻塞调用：调用方必须放进线程池（``run_in_threadpool``）。失败一律抛
    :class:`OcrError`，由上层决定"回落视觉模型"还是"直接报错给用户"。
    """
    if not api_key:
        raise OcrError("missing_key")
    if purpose not in OCR_PURPOSES:
        raise OcrError("bad_purpose", detail=purpose)
    if not raw:
        raise OcrError("empty_file")
    if len(raw) > _MAX_FILE_BYTES:
        raise OcrError("file_too_large")

    timeout_config = httpx.Timeout(
        timeout, connect=min(_CONNECT_TIMEOUT_SECONDS, timeout), write=timeout, pool=5.0
    )
    files = {
        "file": (
            filename or "document.pdf",
            raw,
            content_type or "application/octet-stream",
        )
    }
    try:
        with httpx.Client(timeout=timeout_config, follow_redirects=False) as client:
            response = client.post(
                OCR_ENDPOINT,
                data={"purpose": purpose},
                files=files,
                headers={"Authorization": f"Bearer {api_key}", "Accept": "application/json"},
            )
    except httpx.TimeoutException as exc:
        raise OcrError("timeout", retryable=True) from exc
    except httpx.RequestError as exc:
        logger.warning("OCR 请求无法连接：%s", type(exc).__name__)
        raise OcrError("network", retryable=True) from exc

    body = _parse_body(response)
    if response.status_code != 200:
        _raise_for_status(response.status_code, body)
    if "error" in body:
        # 识别已开始（200）之后失败：响应体是 error 对象，不是结果。
        error = body.get("error") if isinstance(body.get("error"), dict) else {}
        assert isinstance(error, dict)
        message = str(error.get("message") or "")
        raise OcrError(_reason_from_message(message), detail=message, retryable=True)

    result = _to_result(body, purpose)
    _record_usage(result, purpose)
    logger.info(
        "OCR 完成 page_count=%s truncated=%s chars=%s",
        result.page_count,
        len(result.truncated_pages),
        len(result.text),
    )
    return result


def _record_usage(result: OcrResult, purpose: str) -> None:
    """把这次识别的页数记进外部用量（T16：只记数量，不折算金额）。

    为什么放在这一层：``recognize_document`` 是**所有** OCR 调用的唯一收口（简历扫描页、
    资料箱、面试材料图片、后台逐页任务都走它），在这里记一次就不会漏，也不会重复。
    记账失败绝不能影响识别结果——``record_external_usage`` 自己吞掉存储异常，这里再
    兜一层，防止未来改动把它变成硬失败。
    """
    pages = result.page_count or len(result.pages)
    if pages <= 0:
        return
    try:
        from ..usage_counters import KIND_OCR, record_external_usage

        record_external_usage(
            KIND_OCR,
            pages,
            source=f"ocr:{purpose}",
            dedupe_key=f"ocr:{result.request_id}" if result.request_id else None,
        )
    except Exception:  # noqa: BLE001 - 记账是旁路，任何异常都不该反写到识别结果
        logger.warning("OCR 用量记账失败 pages=%s", pages, exc_info=True)


__all__ = [
    "DEFAULT_PURPOSE",
    "OCRPurposes",
    "OCR_ENDPOINT",
    "OCR_PURPOSES",
    "OcrError",
    "OcrPage",
    "OcrResult",
    "recognize_document",
]

# 别名：部分调用方按"协议名"引用，保留一个稳定的名字。
OCRPurposes = OCR_PURPOSES
