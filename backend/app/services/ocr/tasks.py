# SPDX-License-Identifier: Apache-2.0
"""OCR 后台任务：立即返回任务号，页面轮询进度，**服务端不支持取消**。

为什么要任务化：OCR 的服务端上限是 180 秒（含上传、识别、返回），而前端请求预算档
``recognition`` 只有 90 秒。同步等结果必然在前端先超时，用户看到"失败"但钱已经花了。

为什么**不**做服务端取消（这是刻意的，不是没做完）：官方文档明确——断开连接不会中止
已经收到的识别，照常计费，并且免费并发名额仍被占用。给用户一个"取消"按钮只会造成
"点了取消还在扣钱"的错误预期。前端能做的只有"停止等待"（不再轮询），文案必须说清。

为什么逐页识别：一次请求拿回整份结果确实更快，但那样进度只能显示"已用时"。既然已经
做成后台任务，就按页发请求换取**真实页码进度**与"某页失败不影响其余页"——计费口径
相同（按页），只是多几次往返。最多 ``MAX_TASK_PAGES`` 页，防止一份上千页的 PDF 把
任务队列占满（OCR 账号并发上限 15，本应用只允许 ``MAX_ACTIVE_TASKS`` 个同时跑）。
"""

from __future__ import annotations

import io
import logging
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import TypedDict

from pypdf import PdfReader, PdfWriter

from .client import OcrError, recognize_document
from .policy import (
    OCR_EMPTY_PAGES_WARNING,
    OCR_PAGE_TRUNCATED_WARNING,
    OCR_USED_WARNING,
    OcrContext,
)
from .scan import user_message_for

logger = logging.getLogger(__name__)

# 单份任务最多识别多少页。1000 是服务端上限；这里取 200 是因为逐页往返的现实耗时
# （每页约 1–2 秒）已经把 200 页推到 5 分钟以上，再大就该拆分文件而不是继续排队。
MAX_TASK_PAGES = 200
# 同时运行的任务数：留出余量给正常请求，也避免撞上账号级 15 并发。
MAX_ACTIVE_TASKS = 2
# 内存里保留多少个任务的结果（单机单用户，够翻回上一次即可）。
MAX_KEPT_TASKS = 12


class OcrTaskPublic(TypedDict):
    """``OcrTask.public()`` 的返回形状（逐字段类型，供 API 层直接构造响应模型）。

    为什么不用 ``dict[str, object]``：``OcrTaskStatus(**task.public())`` 在那种注解下
    十个字段全部退化成 ``object``，类型检查形同失效（历史上有过这类假绿灯）。这里逐
    字段写清类型，路由层把它展开进 pydantic 模型时，字段名与类型都会被真的检查到。
    """

    task_id: str
    status: str
    total_pages: int
    pages_done: int
    elapsed_ms: int
    text: str
    warnings: list[str]
    error_code: str
    error_detail: str
    server_cancel_supported: bool


@dataclass
class OcrTask:
    id: str
    status: str = "running"
    total_pages: int = 0
    pages_done: int = 0
    started_at: float = field(default_factory=time.monotonic)
    finished_at: float | None = None
    text: str = ""
    warnings: list[str] = field(default_factory=list)
    error_code: str = ""
    error_detail: str = ""

    @property
    def elapsed_ms(self) -> int:
        end = self.finished_at if self.finished_at is not None else time.monotonic()
        return int((end - self.started_at) * 1000)

    def public(self) -> OcrTaskPublic:
        return {
            "task_id": self.id,
            "status": self.status,
            "total_pages": self.total_pages,
            "pages_done": self.pages_done,
            "elapsed_ms": self.elapsed_ms,
            "text": self.text,
            "warnings": list(self.warnings),
            "error_code": self.error_code,
            "error_detail": self.error_detail,
            "server_cancel_supported": False,
        }


_TASKS: dict[str, OcrTask] = {}
_LOCK = threading.Lock()


def _prune() -> None:
    """只保留最近完成的若干个任务（调用方持有 ``_LOCK``）。"""
    finished = [task for task in _TASKS.values() if task.status != "running"]
    if len(finished) <= MAX_KEPT_TASKS:
        return
    finished.sort(key=lambda task: task.started_at)
    for stale in finished[: len(finished) - MAX_KEPT_TASKS]:
        _TASKS.pop(stale.id, None)


def _active_count() -> int:
    return sum(1 for task in _TASKS.values() if task.status == "running")


def split_pdf_pages(raw: bytes) -> list[bytes]:
    """把 PDF 拆成单页 PDF 字节（逐页识别用）。

    失败抛 :class:`OcrError`（``unparsable``）：加密或损坏的文件在这里就该被拒，
    而不是发到服务端再花钱换一个 400。
    """
    try:
        reader = PdfReader(io.BytesIO(raw))
        if reader.is_encrypted and not reader.decrypt(""):
            raise OcrError("password_protected")
        pages: list[bytes] = []
        for page in reader.pages[:MAX_TASK_PAGES]:
            writer = PdfWriter()
            writer.add_page(page)
            buffer = io.BytesIO()
            writer.write(buffer)
            pages.append(buffer.getvalue())
        return pages
    except OcrError:
        raise
    except Exception as exc:  # noqa: BLE001 - 第三方解析器异常类型不固定
        logger.warning("PDF 分页失败：%s", type(exc).__name__)
        raise OcrError("unparsable", detail=type(exc).__name__) from exc


def _recognize_page(page_raw: bytes, name: str, ctx: OcrContext):
    """识别一页；**整页空文本重试一次**。

    服务端偶发把一页返回成空文本（实测 9 页里出现 1–2 页，紧接着重试即正常）。空页不仅
    让用户少一段内容，还照常计费，所以宁可多花一页的钱重试一次，也不要留一个静默的洞。
    """
    result = recognize_document(
        page_raw, name, ctx.api_key, purpose=ctx.purpose, content_type="application/pdf"
    )
    if result.text.strip():
        return result
    logger.info("OCR 第 %s 页返回空文本，重试一次", name)
    return recognize_document(
        page_raw, name, ctx.api_key, purpose=ctx.purpose, content_type="application/pdf"
    )


def _run(task: OcrTask, pages: list[bytes], filename: str, ctx: OcrContext) -> None:
    texts: list[str] = []
    truncated: list[int] = []
    empty: list[int] = []
    for index, page_raw in enumerate(pages, start=1):
        try:
            result = _recognize_page(page_raw, f"{filename}-p{index}.pdf", ctx)
        except OcrError as exc:
            with _LOCK:
                task.status = "failed"
                task.error_code = exc.code
                task.error_detail = user_message_for(exc)
                task.text = "\n\n".join(texts)
                task.finished_at = time.monotonic()
                # 失败的页也算"处理过"，进度条不会停在半路让人以为卡死。
                task.pages_done = index
            logger.warning("OCR 任务第 %s 页失败：%s", index, exc.code)
            return
        text = result.text.strip()
        if text:
            texts.append(text)
        else:
            empty.append(index)
        if result.truncated_pages:
            truncated.append(index)
        with _LOCK:
            task.pages_done = index

    warnings: list[str] = []
    if texts:
        warnings.append(OCR_USED_WARNING.format(pages=len(texts)))
    if truncated:
        pages_text = "、".join(str(page) for page in truncated)
        warnings.append(OCR_PAGE_TRUNCATED_WARNING.format(pages=pages_text))
    if empty:
        warnings.append(
            OCR_EMPTY_PAGES_WARNING.format(pages="、".join(str(page) for page in empty))
        )
    with _LOCK:
        task.text = "\n\n".join(texts)
        task.warnings = warnings
        task.status = "succeeded" if texts else "failed"
        if not texts:
            task.error_code = "empty_result"
            task.error_detail = user_message_for(OcrError("empty_result"))
        task.finished_at = time.monotonic()


def start_pdf_task(raw: bytes, filename: str, ctx: OcrContext) -> OcrTask:
    """创建并启动一个后台识别任务；分页失败直接抛 :class:`OcrError`。"""
    if not ctx.configured:
        raise OcrError("missing_key")
    with _LOCK:
        if _active_count() >= MAX_ACTIVE_TASKS:
            raise OcrError("too_many_tasks")
        pages = split_pdf_pages(raw)
        task = OcrTask(id=uuid.uuid4().hex[:12], total_pages=len(pages))
        _TASKS[task.id] = task
        _prune()
    thread = threading.Thread(
        target=_run, args=(task, pages, filename, ctx), name=f"ocr-{task.id}", daemon=True
    )
    thread.start()
    return task


def start_image_task(raw: bytes, filename: str, mime: str, ctx: OcrContext) -> OcrTask:
    """图片只有一页：同样走任务接口，前端不必为两种文件写两条路径。"""
    if not ctx.configured:
        raise OcrError("missing_key")
    with _LOCK:
        if _active_count() >= MAX_ACTIVE_TASKS:
            raise OcrError("too_many_tasks")
        task = OcrTask(id=uuid.uuid4().hex[:12], total_pages=1)
        _TASKS[task.id] = task
        _prune()

    def _run_image() -> None:
        try:
            result = recognize_document(
                raw, filename or "image.jpg", ctx.api_key, purpose=ctx.purpose, content_type=mime
            )
        except OcrError as exc:
            with _LOCK:
                task.status = "failed"
                task.error_code = exc.code
                task.error_detail = user_message_for(exc)
                task.pages_done = 1
                task.finished_at = time.monotonic()
            return
        text = result.text.strip()
        with _LOCK:
            task.text = text
            task.pages_done = 1
            task.status = "succeeded" if text else "failed"
            if not text:
                task.error_code = "empty_result"
                task.error_detail = user_message_for(OcrError("empty_result"))
            else:
                task.warnings = [OCR_USED_WARNING.format(pages=1)]
            task.finished_at = time.monotonic()

    threading.Thread(target=_run_image, name=f"ocr-{task.id}", daemon=True).start()
    return task


def get_task(task_id: str) -> OcrTask | None:
    with _LOCK:
        return _TASKS.get(task_id)


def reset_tasks() -> None:
    """仅测试用：清空任务表，避免用例之间互相看见。"""
    with _LOCK:
        _TASKS.clear()


__all__ = [
    "MAX_ACTIVE_TASKS",
    "MAX_TASK_PAGES",
    "OcrTask",
    "OcrTaskPublic",
    "get_task",
    "reset_tasks",
    "split_pdf_pages",
    "start_image_task",
    "start_pdf_task",
]
