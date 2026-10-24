# SPDX-License-Identifier: Apache-2.0
"""简历文档的**唯一保存实现**（W02）：条件写、版本推进与冲突判定。

为什么必须只有一处：内容保存有两条入口（旧形状 ``PUT /{id}``、带版本号的
``PUT /{id}/content``）、版式还有一条、AI 修订还有一条。它们都要做同一件事——
"基于第 N 版写第 N+1 版"，同时清掉与内容绑定的告警/来源标注。四处各写一遍，
迟早有一处忘记推进 ``revision``，或者用"读-改-写"实现条件写，把并发保护悄悄
退回成"后写覆盖"。

**为什么是 Core ``UPDATE`` 而不是 ORM 属性赋值**：``record.content = ...;
db.commit()`` 是读-改-写——两个窗口都读到 7，都写成 8。而单条
``UPDATE ... WHERE id=? AND revision=?`` 在 SQLite 上是原子的（写操作串行化、
数据库级写锁），``rowcount == 1`` 就表示"确实从这一版改到了下一版"，``0`` 表示
"这一版已经不存在"。没有中间的读窗口。

**边界**：本模块只碰 ``resume_record`` 这一行，不跨库、不跨请求，事务边界就在
``commit()``；AI 模型调用期间**不得**持有写事务（调用方在模型返回之后才调本模块）。
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any, cast

from fastapi import HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy import select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session

from ...models.resume import ResumeRecord
from ...schemas.resume_generation import LONG_CV_RESOURCE_BUDGET
from .resume_delivery import canonical_content_sha256
from .resume_render_overrides import prune_overrides

logger = logging.getLogger(__name__)

# 冲突响应里给用户看的一句话。前端据此把保存按钮换成"比较 / 另存副本 / 用最新的"，
# 所以措辞要说明"发生了什么"，而不是"服务器拒绝了什么"。
CONFLICT_DETAIL = "这份简历已被其他窗口修改"
# 业务码：与 ``dataset_scope_changed`` 同一形状（409 + 顶层 code），前端 ``ApiError.businessCode``
# 已经在读顶层 ``code``，不新建第二套错误契约。
CONFLICT_CODE = "resume_revision_conflict"


class RevisionConflict(Exception):
    """条件写没命中：调用方手里那一版已经不存在。

    ``current_revision`` 是库里**现在**的值，调用方要把它回给前端——前端拿它才能
    在"用最新的"路径里对齐，或在比较视图里说清差了几版。
    """

    def __init__(self, current_revision: int) -> None:
        super().__init__(f"{CONFLICT_CODE}: current_revision={current_revision}")
        self.current_revision = current_revision


def revision_conflict_response(current_revision: int) -> JSONResponse:
    """把冲突转成 409 响应体（``{"detail", "code", "revision"}``）。"""
    return JSONResponse(
        status_code=409,
        content={
            "detail": CONFLICT_DETAIL,
            "code": CONFLICT_CODE,
            "revision": current_revision,
        },
    )


@dataclass(frozen=True)
class SaveOutcome:
    """一次保存的结果。

    ``record`` 是**提交后重新读回来**的实例（``expire_on_commit=False``，不重读会拿到
    写之前的旧 ``revision``）；``written`` 表示这次是否真的推进了一版——内容与库里
    完全一致时是 ``False``，接口仍返回 200。
    """

    record: ResumeRecord
    revision: int
    written: bool


def _check_content_budget(content: dict[str, Any], mode: str) -> None:
    """长 CV 正文总量预算（W14）：超限 422 并指明是哪一类超限，不静默截断。

    普通简历沿用既有的逐字段上限；这里只对长 CV 兜一个"整份正文"的总量（序列化后字符数），
    防止 10 页模式被当成"无上限"来塞内容。
    """
    if mode != "long_cv" or not isinstance(content, dict):
        return
    total = len(json.dumps(content, ensure_ascii=False))
    budget = int(LONG_CV_RESOURCE_BUDGET["max_content_chars"])
    if total > budget:
        raise HTTPException(
            status_code=422,
            detail=(
                f"长 CV 正文 {total} 字符，超过 {budget} 字符预算；"
                "请精简科研/项目描述或改用普通简历模式后重试"
            ),
        )


def _current_revision(db: Session, record_id: int) -> int:
    """库里现在的 revision（行不存在时 0）。冲突路径用它填响应体。"""
    value = db.execute(select(ResumeRecord.revision).where(ResumeRecord.id == record_id)).scalar()
    return int(value or 0)


def _reload(db: Session, record_id: int) -> ResumeRecord | None:
    """提交后重新读一遍这一行。

    ``SessionLocal`` 是 ``expire_on_commit=False`` + 本模块用 ``synchronize_session=False``
    的 Core UPDATE，所以 identity map 里的实例**不会**自动变成新值；不显式 refresh
    就会把旧 ``revision`` 当作保存结果返回，前端会立刻再撞一次冲突。
    """
    record = db.get(ResumeRecord, record_id)
    if record is not None:
        db.refresh(record)
    return record


def _conditional_update(
    db: Session,
    *,
    record_id: int,
    values: dict[str, Any],
    expected_revision: int | None,
) -> ResumeRecord | None:
    """执行 ``UPDATE ... WHERE id=? [AND revision=?]`` 并返回提交后的记录。

    未命中（``rowcount != 1``）时先 ``rollback()`` 再抛 :class:`RevisionConflict`——
    不 commit、不写库，所以"失败"不会留下半份内容。定位行不存在时返回 ``None``
    （由路由转 404），与"版本过期"区分开：那是两件不同的事。
    """
    conditions = [ResumeRecord.id == record_id]
    if expected_revision is not None:
        conditions.append(ResumeRecord.revision == expected_revision)
    statement = (
        update(ResumeRecord)
        .where(*conditions)
        .values(**values, revision=ResumeRecord.revision + 1)
        .execution_options(synchronize_session=False)
    )
    # `values` 是动态字典时，SQLAlchemy 的 `Session.execute` 重载会退化成 `Result`，
    # 而条件写必须读 `rowcount`。这里显式收窄成 `CursorResult`（DML 的运行时真实类型），
    # 不要为此改成"先查一次再判断"——那会把原子条件写退回读-改-写。
    result = cast("CursorResult[Any]", db.execute(statement))
    if result.rowcount != 1:
        db.rollback()
        # rowcount=0 有两种解释：版本过期（条件写）或这一行已经不在了（无条件写/竞态删除）。
        # 后者必须让路由走 404 —— 抛 RevisionConflict(current=0) 被路由漏接会变成 500，
        # 而"你正在保存的这份简历已被删除"本来就是一个明确的、可解释的结果。
        if db.get(ResumeRecord, record_id) is None:
            return None
        raise RevisionConflict(current_revision=_current_revision(db, record_id))
    db.commit()
    return _reload(db, record_id)


def save_content(
    db: Session,
    *,
    record_id: int,
    content: dict[str, Any],
    expected_revision: int | None,
    mark_saved: bool = True,
) -> SaveOutcome | None:
    """保存正文（旧形状 PUT 与条件写 PUT 共用这一条路径）。

    - ``expected_revision`` 为 ``None``：不做版本比较，无条件写并推进一版（旧行为）。
    - 版本不匹配：``RevisionConflict``，库内一个字节都不动。
    - **内容无变化且版本匹配**：不写库、不推进——重复点保存不该把别的窗口打成 409。
      唯一例外是"这份简历还是草稿"：转正本身就是一次状态变更，必须落下（否则用户
      存了却仍在简历中心看不见它），那一刻推进一版是诚实的。

    返回 ``None`` 表示记录不存在（路由转 404）。
    """
    current = db.get(ResumeRecord, record_id)
    if current is None:
        return None
    current_revision = int(current.revision or 0)
    if expected_revision is not None and expected_revision != current_revision:
        # 早退：版本不对就没必要再序列化一遍正文。
        raise RevisionConflict(current_revision=current_revision)

    _check_content_budget(content, getattr(current, "document_mode", "resume") or "resume")
    needs_promotion = bool(mark_saved and current.draft)
    # §1.6：保存时顺手裁掉"指向已不存在对象 / 照片已换"的域数据，与内容在同一条 UPDATE
    # 写入（revision 只 +1）。纯读路径不裁剪：GET 不写库。
    pruned = prune_overrides(content, current.format_config)
    unchanged = pruned is None and canonical_content_sha256(
        current.content or {}
    ) == canonical_content_sha256(content)
    if unchanged and not needs_promotion:
        return SaveOutcome(record=current, revision=current_revision, written=False)

    values: dict[str, Any] = {
        "content": content,
        # AI 生成阶段的告警不再适用于用户已手工确认过的内容。
        "warnings": [],
        "parse_error": "",
    }
    if pruned is not None:
        values["format_config"] = pruned
    if mark_saved:
        # 保存成功 = 这份简历"存在了"：制作台草稿到这一步才进简历中心（0051）。
        values["draft"] = False
    saved = _conditional_update(
        db,
        record_id=record_id,
        values=values,
        expected_revision=expected_revision,
    )
    if saved is None:
        return None
    return SaveOutcome(record=saved, revision=int(saved.revision or 0), written=True)


def save_layout(
    db: Session,
    *,
    record_id: int,
    values: dict[str, Any],
    expected_revision: int | None,
) -> SaveOutcome | None:
    """保存版式（``PATCH /{id}/layout``）：同型条件写 + 推进一版。

    ``values`` 由调用方解析成**最终列值**（模板名解析、页数归一、字号归一都留在路由层，
    本模块不认业务名）。版式没有"内容无变化"的短路：一次版式保存就是一次确定的写入，
    前端也用它对齐本地版本号。
    """
    current = db.get(ResumeRecord, record_id)
    if current is None:
        return None
    current_revision = int(current.revision or 0)
    if expected_revision is not None and expected_revision != current_revision:
        raise RevisionConflict(current_revision=current_revision)

    payload: dict[str, Any] = dict(values)
    # §1.6：版式保存同样在写入前裁一次（域数据与内容同一条 UPDATE）。
    if isinstance(payload.get("format_config"), dict):
        pruned = prune_overrides(current.content, payload["format_config"])
        if pruned is not None:
            payload["format_config"] = pruned
    # 版式保存成功 = 这份简历"存在了"（0051 的既有规则：用户可能一个字没改，只把版面
    # 排好就关掉）。
    payload["draft"] = False
    saved = _conditional_update(
        db,
        record_id=record_id,
        values=payload,
        expected_revision=expected_revision,
    )
    if saved is None:
        return None
    return SaveOutcome(record=saved, revision=int(saved.revision or 0), written=True)


def save_ai_revision(
    db: Session,
    *,
    record_id: int,
    content: dict[str, Any],
    fact_annotations: list[dict[str, Any]],
    base_revision: int | None,
) -> SaveOutcome | None:
    """AI 修订落库：用 ``base_revision`` 条件写，冲突时**一个字段都不写**。

    与正文保存的关键差异：这里不只换正文。``warnings`` 说的是"生成时那句可能虚构"，
    ``coverage_notes`` / ``rationale`` / ``fact_annotations`` 描述的是"这份内容是怎么选
    出来的"——正文换了它们全部失效，所以必须与正文同一条 UPDATE 清掉。条件写没命中时
    这些字段也原样留在库里（不落库、不弹成功），而不是"内容没换但标注清了"。
    """
    current = db.get(ResumeRecord, record_id)
    if current is None:
        return None
    current_revision = int(current.revision or 0)
    if base_revision is not None and base_revision != current_revision:
        raise RevisionConflict(current_revision=current_revision)

    saved = _conditional_update(
        db,
        record_id=record_id,
        values={
            "content": content,
            "warnings": [],
            "coverage_notes": [],
            "fact_annotations": fact_annotations,
            "rationale": "",
        },
        expected_revision=base_revision,
    )
    if saved is None:
        return None
    return SaveOutcome(record=saved, revision=int(saved.revision or 0), written=True)


__all__ = [
    "CONFLICT_CODE",
    "CONFLICT_DETAIL",
    "RevisionConflict",
    "SaveOutcome",
    "revision_conflict_response",
    "save_ai_revision",
    "save_content",
    "save_layout",
]
