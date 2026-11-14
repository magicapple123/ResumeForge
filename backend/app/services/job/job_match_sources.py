# SPDX-License-Identifier: Apache-2.0
"""岗位匹配的"用的是哪份简历"与缓存指纹（所有匹配入口共用一套口径）。

为什么必须统一：手动匹配、批量匹配、后台任务三条入口如果各自算哈希，会出现两种毛病——
同一份简历换个入口就重算一次（白烧 token），或者简历改了却命中旧结论（结论与简历对不上）。

口径收在这里：
- ``content_hash`` 只看简历内容（排序键后序列化，字段顺序不同不能算出两个哈希）；
- ``fingerprint`` 再把岗位分析结果与补充材料拌进去——任一变化都会让旧结论失效；
- 旧结论没有 ``source`` 指纹，``source_matches`` 一律返回 False，重算一次而不是猜。
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

from sqlalchemy.orm import Session

from ...models.job import Job
from ...models.resume import ResumeRecord
from ...schemas.job_match import JobMatchSource
from ..apply import apply_service
from ..job_analysis_cache import analysis_fingerprint


def resolve_match_resume(db: Session, job: Job, resume_id: int | None) -> ResumeRecord | None:
    resume = apply_service.resolve_resume(db, job.id, resume_id)
    if resume_id is not None and (resume is None or resume.deleted_at is not None or resume.draft):
        raise ValueError("所选简历已不存在或未保存，请重新选择简历")
    return resume


def serialize_resume(resume: ResumeRecord | None) -> str:
    if resume is None:
        return ""
    return json.dumps(
        {"title": resume.title, "job_title": resume.job_title, "content": resume.content},
        ensure_ascii=False,
        sort_keys=True,
    )


def match_source_snapshot(
    db: Session, job: Job, resume_id: int | None = None, *, personal_text: str = ""
) -> JobMatchSource:
    resume = resolve_match_resume(db, job, resume_id)
    content = json.dumps(resume.content if resume else None, sort_keys=True, ensure_ascii=False)
    content_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()
    source = JobMatchSource(
        resume_id=resume.id if resume else None,
        resume_title=resume.title if resume else "",
        resume_revision=resume.revision if resume else None,
        content_hash=content_hash,
    )
    material = json.dumps(
        [analysis_fingerprint(job), source.model_dump(), personal_text],
        sort_keys=True,
        ensure_ascii=False,
    )
    source.fingerprint = hashlib.sha256(material.encode("utf-8")).hexdigest()
    return source


def source_matches(result: Any, source: JobMatchSource) -> bool:
    """Legacy conclusions lack provenance and must be recomputed once."""
    stored = result.get("source") if isinstance(result, dict) else None
    return isinstance(stored, dict) and stored.get("fingerprint") == source.fingerprint
