# SPDX-License-Identifier: Apache-2.0
"""投递队列工具的写入预览（#15F）：``previews.py`` 的分片，专放 apply queue 的两个写工具。

为什么单开一个文件：``assistant_tools/previews.py`` 已经贴着 500 行预算（487 行），
再塞两个预览必然顶穿 ``tests/test_file_size_budget.py``。ActionSpec 里用
``preview_runner("app.services.assistant_tools.previews_apply", "<fn>")`` 按点路径引用，
与 ``previews.py`` 里的函数完全同构（同样的 ``(db, arguments: dict) -> WritePreview``）。

预览是**尽力而为**的展示，绝不提前执行写入，也不做只有 handler 才做的校验：
目标条目读不到时如实写进 changes（"条目不存在，确认后执行会失败"），优于静默。

**apply_start 的预览必须写明"不可撤销"**：这是 #15F 的硬约束——投递一旦发出，平台侧
没有撤回接口。用户在提案卡上看到的 scope 就是最后一道防线，措辞不得弱化
（``tests/test_assistant_apply_tools.py`` 钉住这一条）。
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from ...models.apply import ApplyQueueItem
from ...models.resume import ResumeRecord
from .authorization import FieldChange, WritePreview

# 与 domains.apply_queue.MAX_APPLY_START 同口径（预览只展示，不在这里做拒绝——
# 拒绝留到执行时，预览不该因为参数不合法就消失）。
_PREVIEW_LIMIT = 50


def _int_list(value: Any) -> list[int]:
    """把入参里的 id 列表收敛成 int 列表（预览对脏输入只降级，不抛异常）。"""
    if not isinstance(value, (list, tuple)):
        return []
    parsed: list[int] = []
    for entry in value:
        try:
            parsed.append(int(entry))
        except (TypeError, ValueError):
            continue
    return parsed


def _resume_title(db: Session, resume_id: int | None) -> str:
    """预览里显示的简历名（读不到就空串，由调用方退回"按默认规则"）。

    与 ``apply._queue._resume_title`` 同形（3 行只读查询）。这里**刻意不 import 它**：
    previews_* 在工具注册表构建期被按点路径引用，顶层 import ``services.apply`` 会连带
    拉起站点适配器注册表；为一行 ``db.get`` 付这份代价不值得。
    """
    if resume_id is None:
        return ""
    resume = db.get(ResumeRecord, resume_id)
    return resume.title if resume is not None else ""


def preview_queue_update_priority(db: Session, arguments: dict) -> WritePreview:
    """重排队列：目标与范围说清就够，不逐条列 before/after 的排序值。

    排序值是内部派生字段（``reorder_queue`` 按位置重算），把 20 条的 "3 → 18" 全列出来
    只会让用户看不懂；用户真正要确认的是"哪些条目、按什么顺序"，scope 里给出条数即可。
    """
    order = _int_list(arguments.get("order"))
    return WritePreview(
        target="调整投递队列顺序",
        scope=f"重排 {len(order)} 条",
        changes=[],
    )


def preview_apply_start(db: Session, arguments: dict) -> WritePreview:
    """开始投递：逐条列出岗位 / 公司 / 用哪份简历，并把"不可撤销"写进 scope。

    ``db.get`` 逐条读（一次最多 50 条，最多 50 次主键查询；这里刻意不批量取，保持与
    handler 同样的"逐条如实报告"口径）。读不到的条目也占一行，明确告知确认后会失败。
    """
    queue_ids = _int_list(arguments.get("queue_ids"))
    changes: list[FieldChange] = []
    for item_id in queue_ids[:_PREVIEW_LIMIT]:
        item = db.get(ApplyQueueItem, item_id)
        if item is None:
            changes.append(
                FieldChange(
                    field=f"队列条目 #{item_id}",
                    before=None,
                    after="条目不存在（确认后执行会失败）",
                )
            )
            continue
        resume_title = _resume_title(db, item.resume_id)
        changes.append(
            FieldChange(
                field=f"「{item.job_title or '未命名岗位'}」{item.company or '（未填公司）'}",
                before="未投递",
                after=(
                    f"提交自动投递 · 队列条目 #{item.id} · 当前状态 {item.status} · "
                    f"简历：{resume_title or '按默认规则解析'}"
                ),
            )
        )
    return WritePreview(
        target=f"开始投递 {len(queue_ids)} 条岗位",
        scope=(
            "外部副作用：会真的向招聘平台提交投递；**不可撤销**（平台侧没有撤回接口）；"
            "失败不自动重试"
        ),
        changes=changes,
    )


__all__ = ["preview_apply_start", "preview_queue_update_priority"]
