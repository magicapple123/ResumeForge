# SPDX-License-Identifier: Apache-2.0
"""Expected-dataset identity for HTTP requests, retained until streams finish."""

from __future__ import annotations

import logging
import re

from starlette.datastructures import Headers, MutableHeaders
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from ..runtime import dataset_scope
from ..runtime.dataset_scope import DatasetScopeError

logger = logging.getLogger(__name__)


def _mismatch_scope_token(lease: dataset_scope.DatasetLease | None) -> str | None:
    """409 响应里回写的"当前身份"token，让页面能自助重同步而不必整页刷新。

    与正常响应（``scoped_send``）取同一份身份：有租约用租约身份，没有就是当前身份。
    异常路径里再抛异常会把 409 变成 500，正好毁掉这里要修的那个问题，所以兜底成 None。
    """
    try:
        return dataset_scope.request_scope_token(lease.identity if lease is not None else None)
    except Exception:  # noqa: BLE001 - 见 docstring：错误路径不得二次失败
        logger.exception("无法读取当前数据集身份，409 响应不带 X-Dataset-Scope")
        return None


def _is_transition(path: str) -> bool:
    return path.startswith("/api/settings/datasets/") and (
        path.endswith("/activate") or path.endswith("/sample/load")
    )


def _is_memory_proposal_read(path: str, method: str) -> bool:
    # This route inspects an in-memory authorization record, not a DB session.
    # Its own get_proposal() validates dataset/generation. Keep it usable while
    # switching so a refused approval can still be observed as pending.
    return method in {"GET", "HEAD"} and bool(
        re.fullmatch(r"/api/assistant/write-proposals/[0-9a-f]{16}", path)
    )


class DatasetRequestMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        path = scope.get("path", "")
        if (
            scope["type"] != "http"
            or not path.startswith("/api/")
            or scope.get("method") == "OPTIONS"
        ):
            await self.app(scope, receive, send)
            return
        # R04：AI 任务名随请求上下文下发（provider 每次调用自动落用量账）。
        # 必须在 app 调用之前写入：sync 端点在线程池里跑（复制 context）、
        # SSE/后台线程由各自的上下文复制机制继承。
        from ..services.llm import usage_ledger

        usage_ledger.set_ambient_task(usage_ledger.task_for_path(path))
        headers = Headers(scope=scope)
        expected = headers.get("X-Dataset-Scope")
        method = scope.get("method", "GET")
        token = dataset_scope.expected_request_scope.set(expected)
        lease = None
        try:
            if (
                headers.get("X-ResumeForge-Client") == "browser"
                and method not in ("GET", "HEAD")
                and not expected
            ):
                raise DatasetScopeError("页面尚未确认数据集，请刷新后重试；本次操作未执行")
            if not _is_transition(path) and not _is_memory_proposal_read(path, method):
                try:
                    lease = dataset_scope.acquire_lease("http-request")
                except DatasetScopeError:
                    if path == "/api/resumes/generate" and expected is None:
                        # The legacy streaming endpoint already acquires its lease before snapshots
                        # and reports switch contention as its established SSE error event.
                        await self.app(scope, receive, send)
                        return
                    raise
                dataset_scope.validate_request_scope(lease.identity)
            else:
                dataset_scope.validate_request_scope()
            if path == "/api/dataset-scope" and method == "GET":
                identity = lease.identity if lease is not None else dataset_scope.current_identity()
                response = JSONResponse(
                    {
                        "scope": dataset_scope.request_scope_token(identity),
                        "dataset_id": identity.dataset_id,
                        "generation": identity.generation,
                    },
                    headers={
                        "X-Dataset-Scope": dataset_scope.request_scope_token(identity),
                        "Cache-Control": "no-store",
                    },
                )
                await response(scope, receive, send)
                return

            async def scoped_send(message: Message) -> None:
                if message["type"] == "http.response.start":
                    MutableHeaders(scope=message)["X-Dataset-Scope"] = (
                        dataset_scope.request_scope_token(
                            lease.identity if lease is not None else None
                        )
                    )
                await send(message)

            await self.app(scope, receive, scoped_send)
        except DatasetScopeError as exc:
            # 前端据此区分「token 过期」与「真有任务在跑」：只有前者能自动重同步后重试一次。
            current_token = _mismatch_scope_token(lease)
            logger.warning(
                "dataset scope mismatch path=%s expected=%s current=%s detail=%s",
                path,
                expected,
                current_token,
                exc.public_message,
            )
            headers = {"X-Dataset-Scope": current_token} if current_token else None
            await JSONResponse(
                {"detail": exc.public_message, "code": "dataset_scope_changed"},
                status_code=409,
                headers=headers,
            )(scope, receive, send)
        finally:
            if lease is not None:
                lease.release()
            dataset_scope.expected_request_scope.reset(token)
