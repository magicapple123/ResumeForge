# SPDX-License-Identifier: Apache-2.0
"""生成链路用的事实基线：已确认事实、禁止措辞、覆盖清单与页面口径读数。

从 :mod:`app.services.claims` 拆出来（文件行数预算 500 的硬闸门）：CRUD 与改进建议
是一组，基线构造是另一组，两组之间只共享"已确认才进正式材料"这一条规则——
:func:`can_enter_final` 仍在 models/claim.py 里，所以拆分没有复制任何判断逻辑。

调用方仍从 :mod:`app.services.claims` 导入（那边 re-export），既有 import 路径不变。
"""

from __future__ import annotations

import json
from collections.abc import Iterable

from sqlalchemy.orm import Session

from ..models.claim import ClaimRecord, can_enter_final, verification_label
from ..models.profile_entry import ProfileEntry
from ..schemas.claim import ClaimDigestOut

MAX_BASELINE_CHARS = 12_000


def current_entry_ids(db: Session) -> set[str]:
    """当前数据集的资料条目 entry_id 集合（活动行）。

    只读一列而不是整表 ORM：生成入口与分页列表每条请求都要用它做关联判据。
    """
    rows = db.query(ProfileEntry.entry_id).filter(ProfileEntry.deleted_at.is_(None)).all()
    return {str(row[0]).strip() for row in rows if str(row[0] or "").strip()}


def claim_linked(record: ClaimRecord, entry_ids: Iterable[str]) -> bool:
    """这条主张是否关联到给定的一批资料条目（分页摘要的 linked 标记用）。

    与生成口径复用同一个判据 :func:`_claim_linked_to_entries`，不在路由层再判一次——
    "列表说已关联、生成却没用上"正是这一条要修的缺陷形态。
    """
    allowed = {str(item).strip() for item in entry_ids if str(item).strip()}
    return bool(allowed) and _claim_linked_to_entries(record, allowed)


def _claim_linked_to_entries(record: ClaimRecord, allowed: set[str]) -> bool:
    """这条主张是否能关联到本次消费快照里的资料条目（清单 §20 D1）。

    两个判据：

    1. **显式关联（首选）**：``entry_ids`` 与快照 entry_id 集合有交集。这是 0009 新增的
       列，也是界面「关联资料条目」多选写入的东西；
    2. **旧字段兼容**：``sources[].location`` 命中 entry_id。这是修复前唯一的判据，
       继续保留既让旧数据不用重录，也让"把 entry_id 填进证据来源"的旧做法仍然有效。

    关联不上就不自动带入——宁可让用户重新核对，也不把组外/旧资料写进新简历。
    """
    linked_ids = {str(item).strip() for item in (record.entry_ids or []) if str(item).strip()}
    if linked_ids & allowed:
        return True
    for source in record.sources or []:
        if not isinstance(source, dict):
            continue
        location = str(source.get("location") or "").strip()
        if location and location in allowed:
            return True
    return False


def build_baseline(
    db: Session,
    *,
    source_entry_ids: Iterable[str] | None = None,
) -> ClaimDigestOut:
    """构造生成简历用的事实基线。

    只有 ``已确认`` 的条目会作为事实进入提示词；其余状态的候选表述会被列进
    ``blocked_wording``，生成时要求模型避开。台账为空时返回空基线——这样没启用
    台账的用户，生成行为与以前一字不差。

    source_entry_ids 是**仅生成入口使用**的来源筛选（F3 契约 §4）：
    - 不传（默认）= 全量语义，既有调用方与旧测试逐字节不变；
    - 传本次消费快照的 entry_id 集合时，已确认正向事实只保留能关联到这些条目的
      （显式 entry_ids 求交集，或旧字段 sources[].location 命中）；
      关联不上新资料的旧正向事实不自动带入，并在 warnings 里提示用户重新核对；
    - 禁止措辞（blocked_wording）仍然是抑制约束，不因筛选而放行。
    过滤发生在拼 baseline_text 之前（不是先摘要再丢 sources）。

    返回值里另有两组口径读数（清单 §20 D3 / D5）：
    - covered_entries：被本次基线覆盖的经历/项目主体名，供提示词生成「覆盖清单」，
      让模型知道"只有这些条目的写法受基线约束"，其余条目仍按候选资料如实写；
    - total_confirmed_count / linked_confirmed_count：页面「全量 M 条已确认，
      其中 K 条已关联资料」两段读数。K 对照的是**当前数据集**的资料条目，不受本次快照
      影响——否则"没参与本次生成"会被误报成"没关联"。
    """
    records = db.query(ClaimRecord).order_by(ClaimRecord.id.asc()).all()
    if not records:
        return ClaimDigestOut(confirmed_count=0, baseline_text="")
    allowed = (
        {str(item).strip() for item in source_entry_ids if str(item).strip()}
        if source_entry_ids is not None
        else None
    )
    dataset_entry_ids = current_entry_ids(db)

    confirmed_lines: list[str] = []
    blocked: list[str] = []
    warnings: list[str] = []
    excluded: list[ClaimRecord] = []
    covered_entries: list[str] = []
    total_confirmed = 0
    linked_confirmed = 0
    for record in records:
        if can_enter_final(record.verification_status):
            total_confirmed += 1
            if _claim_linked_to_entries(record, dataset_entry_ids):
                linked_confirmed += 1
            if allowed is not None and not _claim_linked_to_entries(record, allowed):
                excluded.append(record)
                continue
            entry = {
                "subject": record.subject or record.title,
                "category": record.category,
                "fact": record.source_fact,
                "responsibility": record.responsibility_level,
                "boundary": record.boundary,
                "allowed_uses": record.allowed_uses,
            }
            confirmed_lines.append(json.dumps(entry, ensure_ascii=False, separators=(",", ":")))
            subject = str(entry["subject"] or "").strip()
            if subject and subject not in covered_entries:
                covered_entries.append(subject)
        else:
            wording = (record.candidate_wording or "").strip()
            if wording:
                blocked.append(wording[:500])
            warnings.append(
                f"「{record.title or record.subject or f'#{record.id}'}」"
                f"{verification_label(record.verification_status)}"
            )

    if excluded:
        names = "、".join(
            f"「{record.title or record.subject or f'#{record.id}'}」" for record in excluded[:3]
        )
        warnings.append(
            f"{names} 等 {len(excluded)} 条已确认主张来自旧资料，本次未自动带入："
            "请在新资料里重新核对并关联后再使用"
        )
    baseline_text = "\n".join(confirmed_lines)[:MAX_BASELINE_CHARS]
    return ClaimDigestOut(
        confirmed_count=len(confirmed_lines),
        baseline_text=baseline_text,
        blocked_wording=blocked[:50],
        warnings=warnings[:50],
        covered_entries=covered_entries[:50],
        total_confirmed_count=total_confirmed,
        linked_confirmed_count=linked_confirmed,
    )


__all__ = [
    "MAX_BASELINE_CHARS",
    "build_baseline",
    "claim_linked",
    "current_entry_ids",
]
