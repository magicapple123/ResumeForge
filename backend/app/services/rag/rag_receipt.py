# SPDX-License-Identifier: Apache-2.0
"""#30 生成任务的「本次检索回执」：进程内注册表 + 人话文案（零迁移）。

**为什么放进程内而不是加列**：已拍板「#30 零迁移」，而前端走的是
`GET /resumes/generate/tasks/{id}` 轮询（不消费 SSE），所以"这次用没用上语义检索"
必须随轮询响应回来。生成任务本身只存在于当前进程（重启后由回收链路收尾），用一张
有界 LRU 就够，不引入数据库列、不污染 `options` / `context_snapshot` 的既有语义。

**保留窗口**：任务终态后保留 30 分钟，够结果卡审计与"生成后一行"读取；过期即回收，
不随进程存活时间无限增长（上限 64 条，超出淘汰最旧）。

**这个模块只做展示侧的事**：生成链仍只读 `SelectionBoost` 的 boost/extra_terms；
回执写不进去（回调异常）也不会影响生成结果。
"""

from __future__ import annotations

import threading
import time
from collections import OrderedDict
from collections.abc import Mapping
from typing import Any

#: 终态后保留时长；够弹窗轮询到终态并把审计行渲染出来。
_TTL_SECONDS = 30 * 60
#: 上限：每个进程最多记 64 个任务的回执，防止长时间运行后无限增长。
_MAX_ENTRIES = 64

_LOCK = threading.Lock()
_RECEIPTS: OrderedDict[int, tuple[float, dict[str, Any]]] = OrderedDict()


def record_rag_receipt(task_id: int, payload: Mapping[str, Any]) -> None:
    """记下某个生成任务的检索回执（同 id 覆盖：一次任务只跑一次检索）。"""
    with _LOCK:
        _RECEIPTS[int(task_id)] = (time.monotonic(), dict(payload))
        while len(_RECEIPTS) > _MAX_ENTRIES:
            _RECEIPTS.popitem(last=False)


def get_rag_receipt(task_id: int) -> dict[str, Any] | None:
    """取回执；不存在或已过期返回 None（调用方按"没有这一行"渲染）。"""
    with _LOCK:
        item = _RECEIPTS.get(int(task_id))
        if item is None:
            return None
        stored_at, payload = item
        if time.monotonic() - stored_at > _TTL_SECONDS:
            _RECEIPTS.pop(int(task_id), None)
            return None
        return dict(payload)


def clear_rag_receipts() -> None:
    """测试用：清空注册表，避免用例之间共享任务回执。"""
    with _LOCK:
        _RECEIPTS.clear()


def rag_receipt_message(payload: Mapping[str, Any]) -> str:
    """写进任务进度行的回执文案（协议值，前端阶段条按短语映射，不翻译）。

    只回答"这次检索怎么了"；结构化状态（state/hit_count/impacts）另走
    `GenerateTaskOut.rag`，两者同源，不会互相矛盾。
    """
    state = str(payload.get("state") or "")
    hit_count = int(payload.get("hit_count") or 0)
    if state == "hit":
        return f"语义检索：命中 {hit_count} 条相关经历"
    if state == "off":
        return "语义检索未启用：本次仅按关键词匹配"
    if state == "empty":
        return "语义检索已启用，但索引为空"
    if state == "miss":
        return "语义检索已启用，本次无命中"
    if state == "fallback":
        return f"语义检索超时，已回退关键词匹配（{int(payload.get('elapsed_ms') or 0)} ms）"
    return ""


def record_retrieval(task: Any, session: Any, payload: Mapping[str, Any]) -> None:
    """接到 `prepare_selection_boost(on_retrieval=...)` 上：写回执 + 写进度行。

    在生成开始前调用，所以用户不必等整篇生成完才知道"这次没检索"；随后的 progress
    事件会覆盖 `message`，但结构化回执照旧可读（前端徽标用它）。
    """
    record_rag_receipt(int(task.id), payload)
    message = rag_receipt_message(payload)
    if not message:
        return
    task.message = message
    session.commit()


def append_rag_note(
    rationale: str,
    *,
    task_id: int | None = None,
    payload: Mapping[str, Any] | None = None,
) -> str:
    """把可用审计的一行并进「生成说明」（rationale，随记录持久化）。

    只记两种值得留痕的情况：**命中**（语义检索真的参与了选材）与**超时回退**
    （用户看到的质量下降有解释）。off/miss/empty 不写：默认关闭的用户每天都生成，
    在生成说明里堆一行"未启用"只会变成噪音，页面上的三处展示已经说清楚了。
    """
    data = payload if payload is not None else None
    if data is None and task_id is not None:
        data = get_rag_receipt(task_id)
    if not data:
        return rationale
    state = str(data.get("state") or "")
    note = ""
    if state == "hit":
        titles = "、".join(
            str(item.get("title") or "").strip()
            for item in data.get("impacts") or ()
            if str(item.get("title") or "").strip()
        )
        note = f"语义检索：命中 {int(data.get('hit_count') or 0)} 条相关经历"
        if titles:
            note = f"{note}（{titles[:120]}）"
    elif state == "fallback":
        note = f"语义检索超时，已回退关键词匹配（{int(data.get('elapsed_ms') or 0)} ms）"
    if not note:
        return rationale
    return f"{rationale}\n\n{note}".strip() if rationale.strip() else note


__all__ = [
    "append_rag_note",
    "clear_rag_receipts",
    "get_rag_receipt",
    "rag_receipt_message",
    "record_rag_receipt",
    "record_retrieval",
]
