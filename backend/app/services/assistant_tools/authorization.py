# SPDX-License-Identifier: Apache-2.0
"""写工具的两阶段授权：结构化提案 → 用户批准 → 一次性核销执行（RF-01 / T01）。

安全性质（全部由测试钉住，见 tests/test_assistant_authorization.py 与
tests/test_assistant_proposals_endpoint.py）：

- 提案 token 永不进入模型消息：模型只知道"有一个提案等待用户确认"；
- 批准走 REST 端点，执行用的是**存储的参数**——模型文本声称"用户已确认"
  不产生任何授权（没有提案 id 时 approve 直接 404）；
- 一次批准最多一次执行尝试（token 一次性核销）；
- 授权绑定数据集：切换数据集后未核销的提案一律失效；
- 提案落库（T01 单一事实源）：状态可跨轮读取、跨重启如实显示。重启后 pending/approved
  一律置 expired（启动时清理），前端查询得到终态，按"已失效"展示。

持久化在 proposal_store.py；派生回写与状态注入在 proposal_writeback.py。本模块保留
对外 API 与数据模型（WritePreview / WriteProposalOut / 错误类型），并委托给存储层。
"""

from __future__ import annotations

import hashlib
import json
from typing import Any, Literal, cast

from pydantic import BaseModel, Field

from . import proposal_store

# 提案有效期（秒）：足够用户读完差异卡片，又不会让"半小时前的弹窗"还能写库。
# 测试会 monkeypatch 这个常量；存储层在创建时实时读取（见 proposal_store._ttl_seconds）。
PROPOSAL_TTL_SECONDS = 1800

ProposalStatus = Literal[
    "pending", "approved", "executed", "expired", "rejected", "failed", "unknown"
]


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
    # 执行结果摘要（工具 handler 的 ToolResult.summary）。只有 executed 之后才有值：
    # 前端据此在卡片上如实说明"改了什么"，以及写工具自动留下的撤销点版本名。
    result_summary: str = ""


class WriteProposalError(Exception):
    """提案流程错误。message 可直接展示；status_code 用于 API 映射（默认 409）。"""

    def __init__(self, message: str, status_code: int = 409) -> None:
        super().__init__(message)
        self.status_code = status_code


def arguments_digest(arguments: dict) -> str:
    """参数摘要：canonical JSON（排序键）的 sha256。防"批准后参数被换"。"""
    canonical = json.dumps(arguments, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _out(view: proposal_store.ProposalView) -> WriteProposalOut:
    return WriteProposalOut(
        proposal_id=view.proposal_id,
        tool_name=view.tool_name,
        dataset_id=view.dataset_id,
        preview=WritePreview(**view.preview),
        created_at=view.created_at.isoformat(),
        expires_at=view.expires_at.isoformat(),
        # 存储层把状态当普通字符串保存（列是 TEXT），合法取值由本模块的
        # ProposalStatus 与写入路径共同保证，这里显式收窄而不是全链路放宽成 str。
        status=cast("ProposalStatus", view.status),
        result_summary=view.result_summary,
    )


def create_proposal(
    ctx: Any,
    tool_name: str,
    arguments: dict,
    preview: WritePreview,
    *,
    conversation_id: int | None = None,
    message_id: int | None = None,
    batch_id: str | None = None,
    db: Any = None,
    factory: Any = None,
) -> WriteProposalOut:
    """登记一条待确认的写入提案（不执行任何写入）。"""
    view = proposal_store.create(
        ctx,
        tool_name,
        arguments,
        preview,
        conversation_id=conversation_id,
        message_id=message_id,
        batch_id=batch_id,
        db=db,
        factory=factory,
    )
    return _out(view)


def get_proposal(proposal_id: str, *, db: Any = None, factory: Any = None) -> WriteProposalOut:
    """读取提案当前状态（前端卡片刷新用；不存在按 404；作用域不一致 409）。"""
    return _out(proposal_store.get(proposal_id, db=db, factory=factory))


def approve_proposal(proposal_id: str, *, db: Any = None, factory: Any = None) -> dict[str, Any]:
    """用户批准：校验后原子置 approved 并签发一次性 token。

    返回 ``{"token", "tool_name", "arguments"}``，由调用方（REST 端点）接着
    ``consume`` 核销并执行。token 不进模型消息，也不需要回传前端。
    """
    return proposal_store.approve(proposal_id, db=db, factory=factory)


def reject_proposal(proposal_id: str, *, db: Any = None, factory: Any = None) -> WriteProposalOut:
    """用户拒绝：pending → rejected（终态，不可复活）。"""
    return _out(proposal_store.reject(proposal_id, db=db, factory=factory))


def consume(
    proposal_id: str, token: str, *, db: Any = None, factory: Any = None
) -> tuple[str, dict]:
    """一次性核销：token 匹配、状态 approved、同数据集缺一不可。

    返回 ``(tool_name, arguments)``（**存储的参数**，不是模型重给的参数）。
    """
    return proposal_store.consume(proposal_id, token, db=db, factory=factory)


def verify_arguments(proposal_id: str, arguments: dict, *, factory: Any = None) -> None:
    """校验执行参数与存储摘要一致（端点用存储参数执行，这里防内部误用）。"""
    proposal_store.verify_arguments(proposal_id, arguments, factory=factory)


def ensure_target_unchanged(db: Any, proposal_id: str, tool: Any) -> None:
    """批准前重查目标（T01）：预览重算的指纹与创建时不一致就 409，绝不用旧快照执行。"""
    proposal_store.ensure_target_unchanged(db, proposal_id, tool)


def mark_executed(proposal_id: str, summary: str = "", *, factory: Any = None) -> WriteProposalOut:
    return _out(proposal_store.mark_executed(proposal_id, summary, factory=factory))


def mark_failed(proposal_id: str, error: str = "", *, factory: Any = None) -> WriteProposalOut:
    return _out(proposal_store.mark_failed(proposal_id, error, factory=factory))


def mark_unknown(proposal_id: str, summary: str = "", *, factory: Any = None) -> WriteProposalOut:
    """标记"执行结果未知"（提交阶段失败，PR-03）。

    终态：approve 只认 pending、consume 只认 approved，unknown 天然阻断一切再次执行——
    "结果未知"绝不自动二次写入。
    """
    return _out(proposal_store.mark_unknown(proposal_id, summary, factory=factory))


def reset_store() -> None:
    """清空提案与 token（仅测试用）。"""
    proposal_store.reset_store()


__all__ = [
    "PROPOSAL_TTL_SECONDS",
    "FieldChange",
    "ProposalStatus",
    "WritePreview",
    "WriteProposalError",
    "WriteProposalOut",
    "approve_proposal",
    "arguments_digest",
    "consume",
    "create_proposal",
    "ensure_target_unchanged",
    "get_proposal",
    "mark_executed",
    "mark_failed",
    "mark_unknown",
    "reject_proposal",
    "reset_store",
    "verify_arguments",
]
