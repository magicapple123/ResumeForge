# SPDX-License-Identifier: Apache-2.0
"""岗位解读缓存（R2）：把一次真实的模型调用留在岗位上。

一次解读要 10–60 秒、按 token 计费。此前每次打开弹窗都重新生成，用户"只想再看一眼
上次的结论"也要重新等一遍。

缓存的判定用**指纹**而不是时间：岗位的标题、公司、描述、要求、补充信息、标签任一
变化就换指纹。内容变了不自动丢弃旧结果——用户可能只补了个标签，旧解读仍然有用——
而是由读取方标成「可能过期」，让用户自己决定要不要重新生成。
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from ..models.job import Job


def _normalized(job: Job) -> str:
    return json.dumps(
        [
            (job.title or "").strip(),
            (job.company or "").strip(),
            (job.description or "").strip(),
            (job.requirements or "").strip(),
            (job.additional_info or "").strip(),
            list(job.keywords or []),
        ],
        ensure_ascii=False,
        separators=(",", ":"),
    )


def analysis_fingerprint(job: Job) -> str:
    return hashlib.sha256(_normalized(job).encode("utf-8")).hexdigest()


def read_cached_analysis(job: Job) -> dict[str, Any] | None:
    """返回 ``{"result","generated_at","stale"}``；没有缓存时返回 None。"""
    cache = getattr(job, "analysis_cache", None)
    if not isinstance(cache, dict):
        return None
    result = cache.get("result")
    if not isinstance(result, dict) or not result:
        return None
    return {
        "result": result,
        "generated_at": str(cache.get("generated_at") or ""),
        # 指纹不同 = 岗位内容改过；旧结果仍可读，但界面要提醒"可能过期"。
        "stale": str(cache.get("fingerprint") or "") != analysis_fingerprint(job),
    }


def store_analysis(db: Session, job: Job, result: dict[str, Any]) -> None:
    """写入缓存并提交。失败不影响本次结果返回（缓存是加速，不是事实源）。"""
    job.analysis_cache = {
        "fingerprint": analysis_fingerprint(job),
        "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "result": result,
    }
    db.commit()


__all__ = [
    "analysis_fingerprint",
    "read_cached_analysis",
    "store_analysis",
]
