# SPDX-License-Identifier: Apache-2.0
"""补充事实的本地存储层：九类事实的读取、创建、条件更新与软删除。

**为什么新事实独立成表**（计划 §8.2）：旧资料保存走 "子表先删后插"，若把新列表塞进
旧 PUT 协议，旧客户端保存时会把新增事实整体清空。因此唯一写入入口是本模块 +
/api/profile/facts；旧 PUT 完全不碰这张表。

**稳定身份**：fact_id 是 uuid4().hex[:24]（与 document_identity 同一生成规则），
排序、更新都不重算它；排序只改 sort_order，数据库主键 id 只用于回收站接口。

**条件写**：update 用单条 Core UPDATE（WHERE id AND revision AND deleted_at IS NULL），
rowcount 决定成败。读-改-写在两个窗口同时保存时会互相覆盖，而这里必须有一方拿到
409 去比较版本。

**软删接既有回收站**：只设置 deleted_at（幂等，重复删不刷新时间），恢复与彻底删除
分别由 /api/trash 的既有实现负责——不在这里写第二套恢复逻辑。

**读接口不写库**：列表/候选快照在还没有资料主表行时返回空，不因为一次 GET 创建
user_profile 记录（与 document_provenance_source_text 的只读约定一致）。
"""

from __future__ import annotations

import logging
import uuid
from typing import Any, cast

from sqlalchemy import func, select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session

from ...models.profile import UserProfile, utcnow
from ...models.profile_fact import ProfileFact
from ...schemas.profile_facts import (
    PROFILE_FACT_SCHEMA_VERSION,
    validate_fact_payload,
)
from .. import trash
from .fact_field_schema import (
    load_field_schemas,
    neutralize_hidden_fields,
    preserve_hidden_fields,
    validate_custom_payload,
)
from .profile_service import get_or_create_profile

logger = logging.getLogger(__name__)

# 409 的业务码（响应体顶层 code）：与前端的 ApiError.businessCode 同一形状。
PROFILE_FACT_CONFLICT_CODE = "profile_fact_revision_conflict"
# 事实 id 的合法长度区间（契约 §3.2：8–32 位 [A-Za-z0-9_-]）。
FACT_ID_MIN_LENGTH = 8
FACT_ID_MAX_LENGTH = 32
# uuid4().hex[:24] 撞车概率极低，但仍然重试而不是信任"不会撞"。
_FACT_ID_ATTEMPTS = 5


class RevisionConflict(Exception):
    """条件写没命中：调用方手里那一版已经不存在。

    current_revision 是库里**现在**的值，前端拿它去做"用最新的/比较"路径，
    否则刷新后还是会立刻再撞一次。
    """

    def __init__(self, current_revision: int) -> None:
        super().__init__(f"{PROFILE_FACT_CONFLICT_CODE}: current_revision={current_revision}")
        self.current_revision = current_revision


def _normalize_fact_id(fact_id: str) -> str:
    """外部 id 只接受契约规定的字符集与长度；其余一律当"不存在"（404）。"""
    text = str(fact_id or "").strip()
    if not (FACT_ID_MIN_LENGTH <= len(text) <= FACT_ID_MAX_LENGTH):
        return ""
    if not all(char.isalnum() or char in "_-" for char in text):
        return ""
    return text


def current_profile_id(db: Session) -> int | None:
    """当前数据集唯一的资料主表 id；还没有资料行时返回 None（**不创建**）。"""
    return db.query(UserProfile.id).order_by(UserProfile.id).limit(1).scalar()


def list_facts(
    db: Session,
    *,
    kind: str | None = None,
    include_deleted: bool = False,
    offset: int = 0,
    limit: int = 200,
) -> tuple[list[ProfileFact], int]:
    """按 sort_order、id 升序列出事实；默认排除软删。

    返回 (本页条目, 过滤条件命中的总数)：总数不受分页影响，前端用它渲染页码。
    """
    profile_id = current_profile_id(db)
    if profile_id is None:
        return [], 0
    query = db.query(ProfileFact).filter(ProfileFact.profile_id == profile_id)
    if kind is not None:
        query = query.filter(ProfileFact.kind == kind)
    if not include_deleted:
        query = query.filter(trash.live_only(ProfileFact))
    total = int(query.count())
    items = (
        query.order_by(ProfileFact.sort_order.asc(), ProfileFact.id.asc())
        .offset(max(0, offset))
        .limit(max(1, limit))
        .all()
    )
    return items, total


def get_fact(db: Session, fact_id: str, *, include_deleted: bool = False) -> ProfileFact | None:
    """按外部稳定 id 取一条事实；默认把回收站里的当作不存在。"""
    normalized = _normalize_fact_id(fact_id)
    if not normalized:
        return None
    query = db.query(ProfileFact).filter(ProfileFact.fact_id == normalized)
    if not include_deleted:
        query = query.filter(trash.live_only(ProfileFact))
    return query.first()


def _generate_fact_id(db: Session) -> str:
    """生成一个库内唯一的 fact_id；冲突时重试，仍冲突则明确失败。"""
    for _ in range(_FACT_ID_ATTEMPTS):
        candidate = uuid.uuid4().hex[:24]
        exists = db.query(ProfileFact.id).filter(ProfileFact.fact_id == candidate).first()
        if exists is None:
            return candidate
    raise RuntimeError("无法生成唯一的补充事实 id")


def _next_sort_order(db: Session, profile_id: int) -> int:
    """缺省追加到末尾：只在未删事实里取最大值 +1；空库从 0 开始。"""
    current_max = (
        db.query(func.max(ProfileFact.sort_order))
        .filter(ProfileFact.profile_id == profile_id, trash.live_only(ProfileFact))
        .scalar()
    )
    return 0 if current_max is None else int(current_max) + 1


def create_fact(
    db: Session,
    *,
    kind: str,
    payload: dict[str, Any],
    sort_order: int | None = None,
) -> ProfileFact:
    """创建一条事实：payload 按 kind 严格校验，fact_id 稳定生成，缺省排序追加到末尾。"""
    # 校验放在服务层而不是只信 schema：服务是唯一写入入口，必须自己保证落库数据合法。
    normalized_payload = validate_fact_payload(kind, payload)
    # 自定义字段名不得与默认字段中文标签重名（schemas 层拿不到标签表，见契约 §2）。
    validate_custom_payload(kind, normalized_payload)
    # 隐藏的默认字段忽略客户端值：创建时落成字段默认值（绝不因为隐藏而报错/丢失结构）。
    schema = load_field_schemas(db)[kind]
    normalized_payload = neutralize_hidden_fields(kind, normalized_payload, schema.hidden_fields)
    profile = get_or_create_profile(db)
    try:
        fact = ProfileFact(
            fact_id=_generate_fact_id(db),
            profile_id=profile.id,
            kind=kind,
            schema_version=PROFILE_FACT_SCHEMA_VERSION,
            revision=1,
            payload=normalized_payload,
            sort_order=(
                _next_sort_order(db, profile.id) if sort_order is None else int(sort_order)
            ),
        )
        db.add(fact)
        db.commit()
        db.refresh(fact)
    except Exception:
        db.rollback()
        raise
    logger.info("新增补充事实 fact_id=%s kind=%s", fact.fact_id, fact.kind)
    return fact


def _current_revision(db: Session, fact_pk: int) -> int:
    value = db.execute(select(ProfileFact.revision).where(ProfileFact.id == fact_pk)).scalar()
    return int(value or 0)


def update_fact(
    db: Session,
    fact_id: str,
    *,
    payload: dict[str, Any] | None = None,
    sort_order: int | None = None,
    expected_revision: int | None = None,
) -> ProfileFact:
    """条件更新一条事实：payload 整份替换，revision+1。

    冲突语义：
    - expected_revision 与库里不一致 → RevisionConflict（不写库）；
    - 读到的 revision 在 UPDATE 前被别的窗口推进 → rowcount=0 → RevisionConflict。
    第二条是真正的并发保护——第一条挡的是"我看到的就是旧版本"。
    """
    fact = get_fact(db, fact_id)
    if fact is None:
        raise LookupError("补充事实不存在或已删除")
    updates: dict[str, Any] = {}
    if payload is not None:
        # 整份替换：PATCH 不带 kind，按库里的既有 kind 重新校验（不信任旧 payload 形状）。
        validated = validate_fact_payload(fact.kind, payload)
        validate_custom_payload(fact.kind, validated)
        # 隐藏字段保留旧值：客户端看不到它们，保存时既不接受新值也绝不清空旧值。
        schema = load_field_schemas(db)[fact.kind]
        updates["payload"] = preserve_hidden_fields(
            fact.kind, validated, fact.payload or {}, schema.hidden_fields
        )
    if sort_order is not None:
        updates["sort_order"] = int(sort_order)
    if not updates:
        # 空 PATCH 是 no-op：不推进 revision，避免无意义的版本漂移。
        return fact
    current_revision = int(fact.revision)
    if expected_revision is not None and expected_revision != current_revision:
        raise RevisionConflict(current_revision)

    values = {**updates, "revision": current_revision + 1, "updated_at": utcnow()}
    # 条件写必须读 `rowcount`；显式收窄成 DML 的运行时真实类型（同 document_save.py）。
    result = cast(
        "CursorResult[Any]",
        db.execute(
            update(ProfileFact)
            .where(
                ProfileFact.id == fact.id,
                ProfileFact.revision == current_revision,
                ProfileFact.deleted_at.is_(None),
            )
            .values(**values)
            .execution_options(synchronize_session=False)
        ),
    )
    if result.rowcount != 1:
        db.rollback()
        raise RevisionConflict(_current_revision(db, fact.id))
    db.commit()
    db.refresh(fact)
    logger.info("更新补充事实 fact_id=%s revision=%s", fact.fact_id, fact.revision)
    return fact


def soft_delete_fact(db: Session, fact_id: str) -> ProfileFact:
    """把一条事实移入回收站（幂等）：只设置 deleted_at，恢复交给 /api/trash。

    已删除的事实再删一次返回原记录、不刷新删除时间——重复点击不该让它在回收站里
    不断上浮成"刚删的"。
    """
    fact = get_fact(db, fact_id, include_deleted=True)
    if fact is None:
        raise LookupError("补充事实不存在")
    if fact.deleted_at is not None:
        return fact
    try:
        trash.soft_delete(db, "profile_fact", fact)
        db.commit()
        db.refresh(fact)
    except Exception:
        db.rollback()
        raise
    logger.info("补充事实移入回收站 fact_id=%s", fact.fact_id)
    return fact


__all__ = [
    "FACT_ID_MAX_LENGTH",
    "FACT_ID_MIN_LENGTH",
    "PROFILE_FACT_CONFLICT_CODE",
    "RevisionConflict",
    "create_fact",
    "current_profile_id",
    "get_fact",
    "list_facts",
    "soft_delete_fact",
    "update_fact",
]
