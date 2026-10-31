# SPDX-License-Identifier: Apache-2.0
"""A5：按职业场景派生已有简历变体（创建 → 预览候选 → 采纳写回变体）。

硬约束（计划 §6 / §12 A5）：

- **不覆盖源简历**：创建/预览/采纳只写 resume_variant，不碰 resume_record 的内容、
  revision、锁与来源标注；母版继续独立编辑。
- **冻结上下文**：场景引用在服务端解析成快照后写入变体；预览与采纳都重新解析并比对
  context_sha256——场景在候选生成后被改名/改配置/归档 → 409，要求重新生成。
- **不借助母版 API**：候选走既有受控修订服务 revise_resume（身份回填、空简历拦截、
  扩展栏目保真都在里面），只额外传入受限场景表达块；不临时覆盖母版内容再调接口。
- **锁生效**：lock_content 以**这条变体的旧内容**为基准校验（与翻译采纳同一口径，
  不能拿母版当基准），违规不写一个字段；通过后把锁标记带进新内容。
- **条件写**：采纳必须带回预览时的内容指纹；变体被其它窗口改过 → 409，不静默覆盖。
"""

from __future__ import annotations

import copy
from typing import Any, cast

from sqlalchemy import update
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session

from ...models.profile import utcnow
from ...models.resume import ResumeRecord
from ...models.versions import ResumeVariant
from ...schemas.generation_context import CareerContextRequest, GenerationContextSnapshot
from ...schemas.job import JobOut
from ..career_scenarios.resolve import resolve_context
from . import document_io
from . import document_variants as variants
from .content_locks import validate_content_locks_for
from .resume_delivery import canonical_content_sha256
from .resume_revision import revise_resume
from .scenario_context import build_scenario_prompt_block

CONTENT_CONFLICT_CODE = "variant_content_conflict"
CONTEXT_CHANGED_CODE = "career_scenario_context_changed"
LOCK_CONFLICT_CODE = "fact_lock_conflict"
LOCK_CONFLICT_DETAIL = "本次修改会改动已锁定的正文，已拒绝写入"
CONTENT_CONFLICT_DETAIL = "这条变体已在其他窗口被修改，请刷新后重新生成候选"
CONTEXT_CHANGED_DETAIL = "场景在候选生成后已被修改，请重新生成候选"


class ScenarioVariantError(Exception):
    """场景变体流程的可预期失败（API 层转成明确状态码 + 业务码）。"""

    def __init__(
        self,
        status_code: int,
        detail: str,
        code: str,
        *,
        violations: list[dict[str, Any]] | None = None,
    ) -> None:
        super().__init__(f"{code}: {detail}")
        self.status_code = status_code
        self.detail = detail
        self.code = code
        self.violations = violations or []


def create_scenario_variant(
    db: Session,
    record: ResumeRecord,
    *,
    name: str,
    career_context: CareerContextRequest,
    base_version_id: int | None = None,
) -> tuple[ResumeVariant, GenerationContextSnapshot]:
    """先派生独立变体：内容/排版沿用来源，上下文用本次显式选择的场景快照。"""
    snapshot = resolve_context(db, career_context)
    if snapshot is None:  # schema 已强制 career_context 必填；这里是类型收窄与安全兜底
        raise ScenarioVariantError(400, "缺少职业场景引用", "career_scenario_required")
    variant = variants.create_variant(
        db,
        record,
        name=name,
        base_version_id=base_version_id,
        context_snapshot=snapshot.model_dump(),
    )
    return variant, snapshot


async def preview_scenario_candidate(
    provider: Any,
    *,
    record: ResumeRecord,
    variant: ResumeVariant,
    job: JobOut | None,
    snapshot: GenerationContextSnapshot,
    instructions: str,
) -> dict:
    """按场景表达指南生成候选内容；**内存返回 v2 文档，不写库**。"""
    del record  # 只用于权限/归属校验（路由层已做），预览不需要母版内容
    resume = document_io.ensure_document_version(variant.content,
        language=variant.language or None, format_config=(variant.render_context or {}).get("format_config") or {})
    revised = await revise_resume(
        provider,
        resume,
        job,
        instructions,
        career_context_block=build_scenario_prompt_block(snapshot),
    )
    return document_io.ensure_document_version(
        revised if isinstance(revised, dict) else revised.model_dump(),
        language=(variant.render_context or {}).get("language") or variant.language or None,
        format_config=(variant.render_context or {}).get("format_config") or {},
    )


def _restore_lock_flags_v2(old_document: dict, document: dict) -> None:
    """把旧变体条目的 lock_content/lock_layout 标记按 id（回退同下标）带回新文档。

    锁标记是服务端状态，模型不回显；v2 落库后不能再用 v1 的 restore_lock_flags。
    """
    for old_section in old_document.get("sections") or []:
        section_key = old_section.get("key")
        new_section = next(
            (item for item in document.get("sections") or [] if item.get("key") == section_key),
            None,
        )
        if new_section is None:
            continue
        new_entries = new_section.get("entries") or []
        for index, old_entry in enumerate(old_section.get("entries") or []):
            flags = [key for key in ("lock_content", "lock_layout") if old_entry.get(key)]
            if not flags:
                continue
            target = next(
                (entry for entry in new_entries if entry.get("id") == old_entry.get("id")),
                None,
            )
            if target is None and 0 <= index < len(new_entries):
                target = new_entries[index]
            if target is None:
                continue
            for key in flags:
                target[key] = True


def adopt_scenario_candidate(
    db: Session,
    *,
    record: ResumeRecord,
    variant: ResumeVariant,
    content: dict,
    expected_content_sha256: str,
    expected_context_sha256: str,
    snapshot: GenerationContextSnapshot,
) -> ResumeVariant:
    """把候选写进这条变体（条件写；源简历零写入）。候选是 v2 文档 JSON。"""
    current_snapshot_hash = str(snapshot.context_sha256 or "")
    if current_snapshot_hash != expected_context_sha256:
        raise ScenarioVariantError(409, CONTEXT_CHANGED_DETAIL, CONTEXT_CHANGED_CODE)
    # v2 是唯一存储格式：入参可能是 v2（预览候选）或旧 v1，先收口再比较/落库。
    payload = document_io.ensure_document_version(
        content,
        language=(variant.render_context or {}).get("language") or variant.language or None,
        format_config=(variant.render_context or {}).get("format_config") or {},
    )
    violations = validate_content_locks_for(variant.content or {}, payload)
    if violations:
        raise ScenarioVariantError(
            409,
            LOCK_CONFLICT_DETAIL,
            LOCK_CONFLICT_CODE,
            violations=[item.to_dict() for item in violations],
        )
    _restore_lock_flags_v2(variant.content or {}, payload)
    new_sha = canonical_content_sha256(payload)
    # 条件写必须读 `rowcount`；显式收窄成 DML 的运行时真实类型（同 document_save.py）。
    result = cast(
        "CursorResult[Any]",
        db.execute(
            update(ResumeVariant)
            .where(
                ResumeVariant.id == variant.id,
                ResumeVariant.resume_id == record.id,
                ResumeVariant.content_sha256 == expected_content_sha256,
            )
            .values(
                content=payload,
                content_sha256=new_sha,
                context_snapshot=copy.deepcopy(snapshot.model_dump()),
                updated_at=utcnow(),
            )
        ),
    )
    if result.rowcount == 0:
        db.rollback()
        raise ScenarioVariantError(409, CONTENT_CONFLICT_DETAIL, CONTENT_CONFLICT_CODE)
    db.commit()
    db.refresh(variant)
    return variant


__all__ = [
    "CONTENT_CONFLICT_CODE",
    "CONTEXT_CHANGED_CODE",
    "LOCK_CONFLICT_CODE",
    "ScenarioVariantError",
    "adopt_scenario_candidate",
    "create_scenario_variant",
    "preview_scenario_candidate",
]
