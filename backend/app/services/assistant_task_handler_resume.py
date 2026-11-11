# SPDX-License-Identifier: Apache-2.0
"""#18A resume_batch_edit 的三个步骤：read / edit / save。

真实副作用：edit 用 provider 逐条改写目标文本并**写回简历文档**（同时留「助手修改前」
命名版本作撤销点）；save 只做落库确认（幂等，可从 resume_cursor 单独继续）。
"""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy.orm import Session

from ..models.agent_task import AgentTask, AgentTaskStep
from ..models.versions import VERSION_SOURCE_ASSISTANT, ResumeVersion
from . import assistant_task_handler_common as common
from .assistant_task_handler_common import (
    MAX_REWRITE_CHARS,
    MAX_REWRITE_ITEMS,
    StepResult,
    require_live_resume,
    run_async,
    task_params,
)
from .assistant_tools import document_support
from .resume import document_io

logger = logging.getLogger(__name__)


def _targets(document: dict, section: str) -> list[dict]:
    """目标文本项：指定板块（空 = 全部 entries 板块）里非空的文本项/长字段值。"""
    targets: list[dict] = []
    for raw in document.get("sections") or []:
        if not isinstance(raw, dict) or raw.get("kind") != "entries":
            continue
        key = str(raw.get("key") or "")
        if section and key != section:
            continue
        for entry in raw.get("entries") or []:
            if not isinstance(entry, dict) or entry.get("hidden"):
                continue
            for item in entry.get("items") or []:
                if not isinstance(item, dict) or item.get("hidden"):
                    continue
                if item.get("kind") == "text":
                    if str(item.get("text") or "").strip():
                        targets.append(item)
                else:
                    value = item.get("value")
                    if isinstance(value, str) and len(value.strip()) >= 8:
                        targets.append(item)
    return targets[:MAX_REWRITE_ITEMS]


def _read_value(item: dict) -> str:
    if item.get("kind") == "text":
        return str(item.get("text") or "")
    return str(item.get("value") or "")


def _write_value(item: dict, text: str) -> None:
    if item.get("kind") == "text":
        item["text"] = text
    else:
        item["value"] = text


async def _rewrite(provider: Any, instruction: str, text: str) -> str:
    messages = [
        {
            "role": "system",
            "content": (
                "你是简历改写助手。按用户给出的要求改写下面这段简历内容；"
                "只输出改写后的正文，不要解释、不要加标题、不要编造事实。"
            ),
        },
        {"role": "user", "content": f"改写要求：{instruction}\n\n原文：\n{text}"},
    ]
    rewritten = await provider.chat(messages, thinking=False)
    return str(rewritten or "").strip()[:MAX_REWRITE_CHARS]


def read_step(db: Session, task: AgentTask, _step: AgentTaskStep) -> StepResult:
    params = task_params(task)
    record = require_live_resume(db, params)
    document, _report = document_io.document_for_record(db, record)
    targets = _targets(document, str(params.get("section") or "").strip())
    if not targets:
        return StepResult(False, error="这份简历没有可批量改写的文本条目")
    return StepResult(
        True,
        {
            "resume_id": int(record.id),
            "entries": len(targets),
            "revision": int(record.revision or 0),
        },
    )


def edit_step(db: Session, task: AgentTask, _step: AgentTaskStep) -> StepResult:
    params = task_params(task)
    record = require_live_resume(db, params)
    instruction = str(params.get("instruction") or "").strip()
    if not instruction:
        return StepResult(False, error="任务参数缺少改写要求 instruction")
    provider = common.provider_for_task(db)
    if provider is None:
        return StepResult(False, error="尚未配置大模型，无法批量改写简历")
    document, _report = document_io.document_for_record(db, record)
    targets = _targets(document, str(params.get("section") or "").strip())
    if not targets:
        return StepResult(False, error="这份简历没有可批量改写的文本条目")
    rewritten = 0
    failed = 0
    for item in targets:
        original = _read_value(item)
        try:
            next_text = run_async(_rewrite(provider, instruction, original[:MAX_REWRITE_CHARS]))
        except Exception as exc:  # noqa: BLE001 - 单条失败不拖垮整批
            failed += 1
            logger.warning("批量改写单条失败：%s", exc)
            continue
        if next_text and next_text != original:
            _write_value(item, next_text)
            rewritten += 1
    if rewritten == 0 and failed > 0:
        return StepResult(False, error=f"{failed} 条内容全部改写失败，未写入")
    if rewritten == 0:
        return StepResult(True, {"processed": 0, "failed": failed, "note": "内容无变化，未写入"})
    revision, version = document_support.persist_document(
        db, record, document, change_summary="助手批量改写（后台任务）"
    )
    return StepResult(
        True,
        {
            "processed": rewritten,
            "failed": failed,
            "resume_id": int(record.id),
            "revision": int(revision),
            "version_id": int(version.id) if version is not None else None,
        },
    )


def save_step(db: Session, task: AgentTask, _step: AgentTaskStep) -> StepResult:
    params = task_params(task)
    db.expire_all()
    record = require_live_resume(db, params)
    document, _report = document_io.document_for_record(db, record)
    targets = _targets(document, str(params.get("section") or "").strip())
    version = (
        db.query(ResumeVersion)
        .filter(
            ResumeVersion.resume_id == record.id,
            ResumeVersion.source == VERSION_SOURCE_ASSISTANT,
        )
        .order_by(ResumeVersion.id.desc())
        .first()
    )
    if version is None:
        return StepResult(False, error="没有找到本次改写留下的撤销版本，不能确认保存")
    return StepResult(
        True,
        {
            "verified": True,
            "resume_id": int(record.id),
            "revision": int(record.revision or 0),
            "version_id": int(version.id),
            "entries": len(targets),
        },
    )


RESUME_HANDLERS = {
    ("resume_batch_edit", "read"): read_step,
    ("resume_batch_edit", "edit"): edit_step,
    ("resume_batch_edit", "save"): save_step,
}

__all__ = ["RESUME_HANDLERS"]
