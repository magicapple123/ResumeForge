"""文件副本库（资料箱「文件副本」页签）的工具实现。

副本由 ``services/user_files.py`` 在各入口保存文件时自动登记；这里只做**只读元数据**
查询：文件名、类型、大小、来源与时间。文件内容（data URL）、内容指纹（sha256）与
服务端落盘名（``disk_name``）是实现细节，一律不进入工具返回——预览、用系统程序打开
与删除都只能在资料箱「文件副本」页签里操作，助手没有这些工具。
"""
from __future__ import annotations

import json

from sqlalchemy.orm import Session

from ....models.user_file import UserFile
from .._shared import DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT
from .._types import ToolResult

# 副本来源类型 → 用户看得懂的说法（与 GET /api/user-files 的 source_type 口径一致）。
_SOURCE_LABELS = {
    "material": "资料箱附件",
    "photo": "简历照片",
    "job_note": "岗位备注图",
    "candidate_image": "备选岗位截图",
    "chat_attachment": "助手消息附件",
}


def _file_brief(row: UserFile) -> dict:
    """一行副本的元数据：刻意不含 sha256 / disk_name / 文件内容。"""
    return {
        "id": row.id,
        "文件名": row.original_name,
        "类型": row.mime,
        "大小": row.size,
        "来源": _SOURCE_LABELS.get(row.source_type, row.source_type or "未知来源"),
        "source_type": row.source_type,
        "source_ref": row.source_ref,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def _tool_list_user_files(db: Session, arguments: dict) -> ToolResult:
    """按 keyword / source_type / 数量上限列出文件副本（与 GET /api/user-files 对齐）。"""
    limit = min(int(arguments.get("limit") or DEFAULT_LIST_LIMIT), MAX_LIST_LIMIT)
    query = db.query(UserFile)
    source_type = str(arguments.get("source_type") or "").strip()
    if source_type:
        query = query.filter(UserFile.source_type == source_type)
    keyword = str(arguments.get("keyword") or "").strip()
    if keyword:
        query = query.filter(UserFile.original_name.like(f"%{keyword}%"))
    total = query.count()
    rows = query.order_by(UserFile.id.desc()).limit(limit).all()
    payload = {
        "总数": total,
        "返回": len(rows),
        "文件副本": [_file_brief(row) for row in rows],
    }
    return ToolResult(
        text=json.dumps(payload, ensure_ascii=False),
        summary=f"查看了文件副本库里的 {len(rows)} 个文件副本",
        link="/materials",
    )
