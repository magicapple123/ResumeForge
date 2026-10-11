"""写工具的两阶段授权：结构化提案 → 用户批准 → 一次性核销执行（RF-01）。

安全性质（全部由测试钉住，见 ``tests/test_assistant_authorization.py``）：

- 提案 token 永不进入模型消息：模型只知道"有一个提案等待用户确认"；
- 批准走 REST 端点，执行用的是**存储的参数**——模型文本声称"用户已确认"
  不产生任何授权（没有提案 id 时 approve 直接 404）；
- 一次批准最多一次执行尝试（token 一次性核销，与状态置位同锁完成）；
- 授权绑定数据集：切换数据集后未核销的提案一律失效；
- 提案只存进程内存（单用户本地应用），重启即失效，不落库——重启后前端对
  pending 提案查询得到 404，按"提案已失效"展示。

与架构契约的两处已记录偏差：
- 状态机增加 ``"failed"``：批准后的执行尝试失败时如实标记（契约的 Literal
  只有 executed/rejected，无法表达"确认过但没写成"）；
- token 不回传前端：批准端点在同一请求内完成"批准→核销→执行"，token 只在
  服务端内存流转，比"回传一次"更收敛。
"""
from __future__ import annotations

import hashlib
import json
import secrets
import threading
from datetime import datetime, timedelta
from typing import Any, Literal

from pydantic import BaseModel, Field

from ...models.profile import utcnow
from ...runtime import dataset_scope
from .policy import ToolExecutionContext

# 提案有效期（秒）：足够用户读完差异卡片，又不会让"半小时前的弹窗"还能写库。
PROPOSAL_TTL_SECONDS = 300

ProposalStatus = Literal["pending", "approved", "executed", "expired", "rejected", "failed"]


class FieldChange(BaseModel):
    """一个字段的变更：``before``/``after`` 为 None 分别表示新增/删除。"""

    field: str
    before: str | None = None
    after: str | None = None


class WritePreview(BaseModel):
    """写工具执行前展示给用户的结构化预览（由工具注册的 ``preview`` 生成）。"""

    target: str
    scope: str
    changes: list[FieldChange] = Field(default_factory=list)


class WriteProposalOut(BaseModel):
    proposal_id: str
    tool_name: str
    dataset_id: str
    preview: WritePreview
    created_at: str
    expires_at: str
    status: ProposalStatus


class WriteProposalError(Exception):
    """提案流程错误。message 可直接展示；status_code 用于 API 映射（默认 409）。"""

    def __init__(self, message: str, status_code: int = 409) -> None:
        super().__init__(message)
        self.status_code = status_code


def arguments_digest(arguments: dict) -> str:
    """参数摘要：canonical JSON（排序键）的 sha256。防"批准后参数被换"。"""
    canonical = json.dumps(arguments, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


class _ProposalRecord:
    """进程内提案记录（含不对外暴露的 token 与核销标记）。"""

    def __init__(self, ctx: ToolExecutionContext, tool_name: str, arguments: dict, preview: WritePreview) -> None:
        created = utcnow()
        self.proposal_id = secrets.token_hex(8)
        self.tool_name = tool_name
        self.arguments = dict(arguments)
        self.arguments_digest = arguments_digest(arguments)
        self.dataset_id = ctx.dataset_id
        self.preview = preview
        self.created_at = created
        self.expires_at = created + timedelta(seconds=PROPOSAL_TTL_SECONDS)
        self.status: ProposalStatus = "pending"
        self.token: str = ""
        self.token_consumed: bool = False
        self.result_summary: str = ""

    def out(self) -> WriteProposalOut:
        return WriteProposalOut(
            proposal_id=self.proposal_id,
            tool_name=self.tool_name,
            dataset_id=self.dataset_id,
            preview=self.preview,
            created_at=self.created_at.isoformat(),
            expires_at=self.expires_at.isoformat(),
            status=self.status,
        )

    def expired(self, now: datetime | None = None) -> bool:
        return (now or utcnow()) >= self.expires_at


_PROPOSALS: dict[str, _ProposalRecord] = {}
_LOCK = threading.Lock()


def _get_locked(proposal_id: str) -> _ProposalRecord:
    record = _PROPOSALS.get(proposal_id)
    if record is None:
        raise WriteProposalError("提案不存在或已失效", status_code=404)
    return record


def _ensure_usable_locked(record: _ProposalRecord) -> None:
    """惰性过期 + 数据集归属校验（调用方必须已持有 _LOCK）。"""
    if record.status == "pending" and record.expired():
        record.status = "expired"
    if record.status in {"expired"} or (record.status != "pending" and record.expired()):
        raise WriteProposalError("提案已过期，请让助手重新发起", status_code=409)
    if record.dataset_id != dataset_scope.current_dataset_id():
        raise WriteProposalError("数据集已切换，本提案失效", status_code=409)


def create_proposal(
    ctx: ToolExecutionContext, tool_name: str, arguments: dict, preview: WritePreview
) -> WriteProposalOut:
    """登记一条待确认的写入提案（不执行任何写入）。"""
    record = _ProposalRecord(ctx, tool_name, arguments, preview)
    with _LOCK:
        _PROPOSALS[record.proposal_id] = record
        return record.out()


def get_proposal(proposal_id: str) -> WriteProposalOut:
    """读取提案当前状态（前端卡片刷新用；不存在按 404 处理）。"""
    with _LOCK:
        record = _get_locked(proposal_id)
        if record.status == "pending" and record.expired():
            record.status = "expired"
        return record.out()


def approve_proposal(proposal_id: str) -> dict[str, Any]:
    """用户批准：校验后原子置 approved 并签发一次性 token。

    返回 ``{"token", "tool_name", "arguments"}``，由调用方（REST 端点）接着
    ``consume`` 核销并执行。token 不进模型消息，也不需要回传前端。
    """
    with _LOCK:
        record = _get_locked(proposal_id)
        _ensure_usable_locked(record)
        if record.status != "pending":
            raise WriteProposalError(f"提案当前状态为 {record.status}，不能批准", status_code=409)
        record.status = "approved"
        record.token = secrets.token_hex(16)
        return {"token": record.token, "tool_name": record.tool_name, "arguments": dict(record.arguments)}


def reject_proposal(proposal_id: str) -> WriteProposalOut:
    """用户拒绝：pending → rejected（终态，不可复活）。"""
    with _LOCK:
        record = _get_locked(proposal_id)
        _ensure_usable_locked(record)
        if record.status != "pending":
            raise WriteProposalError(f"提案当前状态为 {record.status}，不能拒绝", status_code=409)
        record.status = "rejected"
        return record.out()


def consume(proposal_id: str, token: str) -> tuple[str, dict]:
    """一次性核销：token 匹配、状态 approved、未核销、未过期、同数据集缺一不可。

    核销标记与校验在同一把锁内完成——并发二次核销必然失败。返回
    ``(tool_name, arguments)``（**存储的参数**，不是模型重给的参数）。
    """
    with _LOCK:
        record = _get_locked(proposal_id)
        if record.status != "approved":
            raise WriteProposalError(f"提案当前状态为 {record.status}，不能执行", status_code=409)
        if record.token_consumed:
            raise WriteProposalError("该提案已执行过，不能重复执行", status_code=409)
        if not token or not secrets.compare_digest(token, record.token):
            raise WriteProposalError("提案令牌不匹配", status_code=409)
        if record.expired():
            record.status = "expired"
            raise WriteProposalError("提案已过期，请让助手重新发起", status_code=409)
        if record.dataset_id != dataset_scope.current_dataset_id():
            raise WriteProposalError("数据集已切换，本提案失效", status_code=409)
        record.token_consumed = True
        return record.tool_name, dict(record.arguments)


def verify_arguments(proposal_id: str, arguments: dict) -> None:
    """校验执行参数与存储摘要一致（端点用存储参数执行，这里防内部误用）。"""
    with _LOCK:
        record = _get_locked(proposal_id)
        if arguments_digest(arguments) != record.arguments_digest:
            raise WriteProposalError("执行参数与批准的提案不一致", status_code=409)


def mark_executed(proposal_id: str, summary: str = "") -> WriteProposalOut:
    with _LOCK:
        record = _get_locked(proposal_id)
        record.status = "executed"
        record.result_summary = summary
        return record.out()


def mark_failed(proposal_id: str, error: str = "") -> WriteProposalOut:
    with _LOCK:
        record = _get_locked(proposal_id)
        record.status = "failed"
        record.result_summary = error
        return record.out()


def reset_store() -> None:
    """清空提案存储（仅测试用）。"""
    with _LOCK:
        _PROPOSALS.clear()
