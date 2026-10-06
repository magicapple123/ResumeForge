"""助手对「投递台」的只读工具。

**刻意只读**：真正点下"投递"是用户在投递台上做的动作，助手只负责如实报告队列状态——
那一步要填的表单千差万别，代填填错的代价是用户的真实误投。删除类工具本仓库助手一概不提供。

**这个模块是搬出来的**：它原先住在 ``official_tools.py`` 里（官网采集与投递台两个功能的工具
写在同一份文件），而官网采集被移除后，那个文件整份删掉了。投递台的工具与官网采集没有任何
关系，跟着一起删就会**顺手把投递台的一个助手能力干掉**——所以先把它搬到这里，再删那一份。
"""
from __future__ import annotations

import json

from sqlalchemy.orm import Session

from ._types import ToolResult

# 与其它列表工具同一档上限，避免把一整页报告塞进上下文。
DEFAULT_LIMIT = 20
MAX_LIMIT = 50


def _tool_list_apply_queue(db: Session, arguments: dict) -> ToolResult:
    """投递台的队列（待投递/已投递/失败），只读。"""
    from ..apply import apply_service  # 局部导入：这个模块依赖较重，避免拖慢助手启动

    limit = min(int(arguments.get("limit") or DEFAULT_LIMIT), MAX_LIMIT)
    items = apply_service.list_queue(db)
    rows = [
        {
            "id": item.id,
            "company": item.company,
            "job_title": item.job_title,
            "status": item.status,
            "resume_title": item.resume_title,
            "apply_supported": item.apply_supported,
            "admission": item.admission,
        }
        for item in items[:limit]
    ]
    payload = {
        "总数": len(items),
        "返回": len(rows),
        "队列": rows,
        "说明": "这是「投递台」的队列状态快照。助手不代为发起投递——那一步必须在投递台上由用户点击。",
    }
    return ToolResult(
        text=json.dumps(payload, ensure_ascii=False),
        summary=f"查看了投递队列（{len(items)} 条）",
        link="/apply",
    )


def _tool_list_apply_records(db: Session, arguments: dict) -> ToolResult:
    """投递记录（按批次分组，含每个岗位的结果与失败原因），只读。

    「上次为什么投失败」是高频问题：批次条目（``ApplyTask``）给整体状态与计数，
    逐岗位条目（``ApplyTaskItem``）给成功/失败与失败分类（``failure_category``
    的用户可读标签与可操作诊断 ``failure_detail``）。查询口径复用
    ``apply._records.list_record_batches``——与「投递记录」页签同一份实现，
    已过 ``live_only`` 软删过滤，不另写一份。
    """
    from ..apply._records import list_record_batches  # 局部导入：与 list_apply_queue 同理

    # limit 语义是"最多看多少个批次"（一页几组），组内条目不截断——截了就没法回答
    # "这一批里哪几个失败了"。
    limit = min(int(arguments.get("limit") or 10), MAX_LIMIT)
    batches, total = list_record_batches(
        db,
        keyword=str(arguments.get("keyword") or ""),
        result=str(arguments.get("result") or ""),
        page=1,
        page_size=limit,
    )
    rows = [
        {
            "批次": batch.id,
            "状态": batch.status,
            "总数": batch.total,
            "成功": batch.succeeded,
            "失败": batch.failed,
            "跳过": batch.skipped,
            "提示": batch.message,
            "岗位结果": [
                {
                    "id": item.id,
                    "company": item.company,
                    "job_title": item.job_title,
                    "status": item.status,
                    "failure_category": item.failure_category,
                    "failure_label": item.failure_label,
                    "failure_detail": item.failure_detail,
                }
                for item in batch.items
            ],
        }
        for batch in batches
    ]
    payload = {
        "总批次数": total,
        "返回批次": len(rows),
        "投递记录": rows,
        "说明": "这是「投递台 → 投递记录」的按批次分组快照；重投要在页面上操作，助手不代为投递。",
    }
    return ToolResult(
        text=json.dumps(payload, ensure_ascii=False),
        summary=f"查看了投递记录（{total} 个批次，返回 {len(rows)} 个）",
        link="/apply",
    )


__all__ = [
    "_tool_list_apply_queue",
    "_tool_list_apply_records",
]
