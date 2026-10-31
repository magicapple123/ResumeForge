# SPDX-License-Identifier: Apache-2.0
"""W13 命名版本与岗位变体的业务编排（迁移 0055）。

不变量（计划书 P2-01 + 本轮任务书）：

- **命名版本是不可变快照**：创建后没有任何 API 会改它的 content/render_context；
  "已投递/冻结版本不被后续编辑覆盖"因此是结构性的（冻结还另有一个显式标记）。
- **恢复 = 写一份新的当前版本**：用版本快照做一次条件写（复用 document_save 里唯一
  的 _conditional_update，不另写第二套 UPDATE），resume_record.revision +1，再新建一条
  source="restore" 的版本记录；历史版本行与已冻结的交付记录一个字节都不改。
- **变体独立**：岗位变体有自己的 content/render_context；只有用户显式"选择性同步"时，
  才会把来源版本里**列出的路径**写进**列出的变体**，其余内容（岗位定制）原样保留。
- **数据集隔离**：每份数据集独立 SQLite 库，表里不存 dataset_id；版本/变体随数据集备份。
"""

from __future__ import annotations

import copy
import hashlib
import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ...models.job import Job
from ...models.resume import ResumeRecord
from ...models.versions import (
    VERSION_SOURCE_MANUAL,
    VERSION_SOURCE_RESTORE,
    ResumeVersion,
)
from ...schemas.resume_generation import mode_page_limit
from . import document_io
from .document_save import _conditional_update
from .resume_delivery import canonical_content_sha256, default_render_context
from .resume_diff import build_resume_diff


class VersionNotFound(LookupError):
    """版本/变体不存在，或不属于这份简历。"""


def _sha256_payload(payload: Any) -> str:
    text = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def layout_snapshot(db: Session, record: ResumeRecord) -> dict[str, Any]:
    """当前简历的排版/渲染上下文快照（复用投递存档的同一解析口径）。"""
    context = default_render_context(db, record)
    return {
        "template": record.template,
        "format_name": record.format_name or "",
        "format_config": context.get("format_config") or {},
        "export_template": context.get("template") or record.template,
        "style_config": context.get("style_config") or {},
        "page_limit": int(context.get("page_limit") or 1),
        "font_scale": context.get("font_scale") or "standard",
        "language": context.get("language") or "zh-CN",
        "document_mode": getattr(record, "document_mode", "resume") or "resume",
    }


def params_sha256(context: dict[str, Any] | None) -> str:
    return _sha256_payload(context or {})


def _snapshot_content(content: dict[str, Any] | None) -> dict[str, Any]:
    return copy.deepcopy(content or {})


def document_content(
    content: dict[str, Any] | None, render_context: dict[str, Any] | None
) -> dict[str, Any]:
    """旧版本快照的 content 可能是 v1：读侧统一收口为 v2（不写库、幂等）。

    format_config 取自该版本自己的排版快照（旧 field_layout 在转换时迁移）；自定义字段
    提示在无 db 的只读路径不提供——转换器对"短标签+冒号"行有保守正则兜底。
    """
    context = render_context or {}
    return document_io.ensure_document_version(
        content or {},
        language=context.get("language") or None,
        format_config=context.get("format_config") or {},
    )


def _latest_version(db: Session, resume_id: int) -> ResumeVersion | None:
    return db.execute(
        select(ResumeVersion)
        .where(ResumeVersion.resume_id == resume_id)
        .order_by(ResumeVersion.id.desc())
        .limit(1)
    ).scalar_one_or_none()


def _get_version(db: Session, resume_id: int, version_id: int) -> ResumeVersion:
    version = db.get(ResumeVersion, version_id)
    if version is None or version.resume_id != resume_id:
        raise VersionNotFound("版本不存在")
    return version


def _job_snapshot(
    db: Session, record: ResumeRecord, job_id: int | None
) -> tuple[int | None, str, str]:
    """目标岗位快照：优先用请求指定岗位，其次记录关联岗位；岗位被删时退回文本快照。"""
    if job_id is not None:
        job = db.get(Job, job_id)
        if job is None:
            raise VersionNotFound("目标岗位不存在")
        return job.id, (job.title or "")[:128], (job.company or "")[:128]
    if record.job_id is not None:
        job = db.get(Job, record.job_id)
        if job is not None:
            return job.id, (job.title or "")[:128], (job.company or "")[:128]
    return record.job_id, (record.job_title or "")[:128], (record.company or "")[:128]


def _auto_change_summary(
    db: Session, record: ResumeRecord, resume_id: int, parent: ResumeVersion | None
) -> str:
    """没手写摘要时，按与上一版的差异给一句可读摘要（只描述行数，不复制正文）。"""
    previous = parent or _latest_version(db, resume_id)
    if previous is None:
        return ""
    # 差异算法仍按 v1 分析口径：两侧先折成 v1 视图（旧快照 v1 直通）。
    diff = build_resume_diff(
        0,
        "当前",
        document_content(record.content, layout_snapshot(db, record)),
        previous.id,
        previous.name,
        document_content(previous.content, previous.render_context),
    )
    added, removed = diff.stats.added, diff.stats.removed
    if not added and not removed:
        return f"与「{previous.name}」内容一致"
    return f"相对「{previous.name}」：+{added} 行 / -{removed} 行"


def version_brief(version: ResumeVersion) -> dict[str, Any]:
    return {
        "id": version.id,
        "resume_id": version.resume_id,
        "name": version.name,
        "change_summary": version.change_summary,
        "job_id": version.job_id,
        "job_title": version.job_title,
        "company": version.company,
        "content_sha256": version.content_sha256,
        "params_sha256": version.params_sha256,
        "source_revision": version.source_revision,
        "parent_version_id": version.parent_version_id,
        "frozen": version.frozen,
        "source": version.source,
        # A5：这份版本生成时的职业场景上下文快照（0061）。NULL = 未记录（旧版本/手写），
        # 读侧原样返回 None，**不按当前场景回填**。版本不可变，这里只做只读展示。
        "context_snapshot": copy.deepcopy(version.context_snapshot),
        "created_at": version.created_at,
    }


def version_detail(version: ResumeVersion) -> dict[str, Any]:
    return {
        **version_brief(version),
        # 快照读取统一 v2：本批之后新建的版本本来就是 v2，旧版本在读取时一次性转换。
        "content": document_content(version.content, version.render_context),
        "render_context": version.render_context or {},
    }


def create_version(
    db: Session,
    record: ResumeRecord,
    *,
    name: str,
    change_summary: str = "",
    parent_version_id: int | None = None,
) -> ResumeVersion:
    """给当前简历拍一份命名版本（不可变快照）。"""
    cleaned = name.strip()
    if not cleaned:
        raise ValueError("版本名称不能为空")
    if len(cleaned) > 256:
        raise ValueError("版本名称过长")
    parent: ResumeVersion | None = None
    if parent_version_id is not None:
        parent = _get_version(db, record.id, parent_version_id)
    job_id, job_title, company = _job_snapshot(db, record, None)
    context = layout_snapshot(db, record)
    content = _snapshot_content(record.content)
    version = ResumeVersion(
        resume_id=record.id,
        name=cleaned,
        change_summary=(change_summary or "").strip()[:2000]
        or _auto_change_summary(db, record, record.id, parent),
        job_id=job_id,
        job_title=job_title,
        company=company,
        content=content,
        render_context=context,
        content_sha256=canonical_content_sha256(content),
        params_sha256=params_sha256(context),
        source_revision=int(record.revision or 0),
        parent_version_id=parent.id if parent is not None else None,
        source=VERSION_SOURCE_MANUAL,
        # A5：版本快照同时冻结生成时上下文（与 content/render_context 一起不可变）。
        context_snapshot=copy.deepcopy(getattr(record, "context_snapshot", None)),
    )
    db.add(version)
    db.commit()
    db.refresh(version)
    return version


def list_versions(db: Session, resume_id: int) -> list[ResumeVersion]:
    return list(
        db.execute(
            select(ResumeVersion)
            .where(ResumeVersion.resume_id == resume_id)
            .order_by(ResumeVersion.id.desc())
        )
        .scalars()
        .all()
    )


def get_version(db: Session, resume_id: int, version_id: int) -> ResumeVersion:
    return _get_version(db, resume_id, version_id)


def freeze_version(db: Session, resume_id: int, version_id: int, *, frozen: bool) -> ResumeVersion:
    version = _get_version(db, resume_id, version_id)
    version.frozen = bool(frozen)
    db.commit()
    db.refresh(version)
    return version


def _layout_diff(base: dict[str, Any], against: dict[str, Any]) -> dict[str, Any]:
    added = sorted(set(against) - set(base))
    removed = sorted(set(base) - set(against))
    changed = sorted(key for key in set(base) & set(against) if base.get(key) != against.get(key))
    return {
        "added": added,
        "removed": removed,
        "changed": changed,
        "equal": not (added or removed or changed),
    }


def compare_versions(
    db: Session, record: ResumeRecord, base_id: int, against: str
) -> dict[str, Any]:
    """版本对比：content 用全仓库唯一的三态差异实现；layout 比渲染上下文顶层键。

    against 为 "current" 时与当前简历比较（响应 against_id=0）。
    """
    base = _get_version(db, record.id, base_id)
    if against == "current":
        against_id = 0
        against_name = "当前简历"
        against_content = record.content or {}
        against_layout = layout_snapshot(db, record)
    else:
        try:
            against_version = _get_version(db, record.id, int(against))
        except (TypeError, ValueError) as exc:
            raise VersionNotFound("对比目标不存在") from exc
        against_id = against_version.id
        against_name = against_version.name
        against_content = against_version.content or {}
        against_layout = against_version.render_context or {}
    # 差异算法仍按 v1 分析口径（本批不重写 diff）：两侧统一折成 v1 视图再比较。
    content_diff = build_resume_diff(
        base.id,
        base.name,
        document_content(base.content, base.render_context),
        against_id,
        against_name,
        document_content(against_content, against_layout),
    )
    return {
        "base_id": base.id,
        "against_id": against_id,
        "base_name": base.name,
        "against_name": against_name,
        "content": content_diff,
        "layout": _layout_diff(base.render_context or {}, against_layout),
    }


def _restore_values(version: ResumeVersion, record: ResumeRecord) -> dict[str, Any]:
    context = version.render_context or {}
    # A4 长 CV：页数上限按这版快照自己的文档模式（旧版本没有该键 → resume → 1–3，
    # 旧行为不变；长 CV 版本的 10 页不再被固定 3 页规则判成非法并回落）。
    document_mode = (
        context.get("document_mode") or getattr(record, "document_mode", None) or "resume"
    )
    page_limit = context.get("page_limit")
    if isinstance(page_limit, int):
        page_limit = mode_page_limit(page_limit, document_mode)
    else:
        page_limit = int(record.page_limit or 1)
    return {
        # 恢复写回的永远是 v2：旧版本快照（v1）在这里一次性转换，避免把 v1 写进库。
        "content": document_io.prepare_document_for_save(
            _snapshot_content(version.content),
            language=context.get("language") or record.language or "zh-CN",
            format_config=context.get("format_config") or {},
        ),
        # 恢复 = 内容回到那一版；与内容绑定的告警/解析错误同样清掉。
        "warnings": [],
        "parse_error": "",
        "draft": False,
        "template": context.get("template") or record.template,
        "format_name": context.get("format_name") or "",
        "format_config": context.get("format_config") or {},
        "page_limit": page_limit,
        "font_scale": context.get("font_scale") or record.font_scale or "standard",
        "language": context.get("language") or record.language or "zh-CN",
        "document_mode": context.get("document_mode") or "resume",
        # A5：从版本恢复 = 内容 / 排版 / 生成上下文一起写成新的当前修订；
        # 历史版本行本身不动（NULL 的快照恢复出来仍是 NULL，不按当前场景回填）。
        "context_snapshot": copy.deepcopy(version.context_snapshot),
    }


def restore_version(
    db: Session,
    record: ResumeRecord,
    version_id: int,
    *,
    expected_revision: int | None,
) -> tuple[ResumeRecord, ResumeVersion]:
    """恢复历史版本：条件写当前简历（revision+1），再记一条 source=restore 的版本。"""
    version = _get_version(db, record.id, version_id)
    saved = _conditional_update(
        db,
        record_id=record.id,
        values=_restore_values(version, record),
        expected_revision=expected_revision,
    )
    if saved is None:
        raise VersionNotFound("简历记录不存在或已被删除")
    context = layout_snapshot(db, saved)
    record_version = ResumeVersion(
        resume_id=saved.id,
        name=f"{version.name}（恢复）"[:256],
        change_summary=f"恢复自版本「{version.name}」"[:2000],
        job_id=version.job_id,
        job_title=version.job_title,
        company=version.company,
        content=_snapshot_content(version.content),
        render_context=context,
        content_sha256=version.content_sha256,
        params_sha256=params_sha256(context),
        source_revision=int(saved.revision or 0),
        parent_version_id=version.id,
        source=VERSION_SOURCE_RESTORE,
        # 恢复动作本身产生的那条版本也带着被恢复版本的上下文（可追溯）。
        context_snapshot=copy.deepcopy(version.context_snapshot),
    )
    db.add(record_version)
    db.commit()
    db.refresh(record_version)
    return saved, record_version


__all__ = [
    "VersionNotFound",
    "compare_versions",
    "create_version",
    "document_content",
    "freeze_version",
    "get_version",
    "layout_snapshot",
    "list_versions",
    "params_sha256",
    "restore_version",
    "version_brief",
    "version_detail",
]
