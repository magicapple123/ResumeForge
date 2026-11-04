# SPDX-License-Identifier: Apache-2.0
"""3-A：把「资料里有、但这份简历里没写」的**自建板块条目**确定性地补进正文。

**为什么需要它**：「AI 补上这段」走的是修订协议（``document_revision``），那条协议只能
改写**已有 path 的 value**，不能新增条目或分区。自建板块的未收录提示恰好是"整条缺失"，
于是模型只能返回空 updates，用户拿到一句干报错。这里换一条完全不同的路：不调模型，直接
把资料原文按生成时同一份投影写进文档。

**为什么复用 ``project_paper_content`` 而不是自己拼 item**：自建分区的「主文本 / 标签行」
判定只在 ``paper_policy.custom_section_text_field`` 一处（R-37 单源）。生成链、填充链与
本模块必须写出**同一种纸面**，否则"生成时补进去"和"事后补进去"的条目长得不一样。

**为什么不走 ``save_ai_revision``**：那条路径会连带清空 ``coverage_notes`` / ``rationale``
/ ``fact_annotations``——它们描述的是"这份内容是怎么选出来的"，正文一换就失效。而我们
恰恰要保留清单并把**刚补进去的那几条**从里面摘掉。所以走 ``document_save.save_content``。

**资料组口径（``ResumeRecord`` 没有 group 字段，这里写死一条）**：

1. 消费快照**只读当前组**（``load_ai_consumed_profile``）。R-24 明确禁止调用方指定另一个
   组，所以本模块不提供 group 参数，也不在内部跨组查找；
2. 若这份简历的生成快照（``profile_usage_snapshot``）记录了另一个组，则**直接拒绝**并
   告诉用户"请切回生成时用的组"——宁可报错也不把**别的组**的条目插进这份简历；
3. 在当前组里找不到某个 ``entry_id`` → 明确报「该资料已删除或不在当前资料组」，
   **绝不静默跳过**（``coverage_notes`` 是生成时的快照，资料可能早就改了）。

**两次写而不是一条 UPDATE**：正文与 ``coverage_notes`` 语义不同（一个是内容、一个是
生成时的快照）。为这一处往 ``document_save.save_content`` 里加参数，会把"保存正文"和
"覆盖度快照"绑成同一个语义。中间失败只会让清单暂时多报几条——下次补入时 ``skipped``
分支会再修一次（已在文档里的条目同样从清单里摘掉），不会写坏正文。
"""

from __future__ import annotations

import logging
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import update
from sqlalchemy.orm import Session

from ...models.resume import ResumeRecord
from ...schemas.profile_projection import ConsumedProfile, ConsumedSection
from ...schemas.resume_document import (
    ResumeEntry,
    document_to_json,
    parse_document,
)
from ..profile.ai_profile import load_ai_consumed_profile
from ..profile.paper_projection import project_paper_content
from . import document_io
from .document_conversion_types import ConversionReport, stable_object_id
from .document_converter_custom import build_custom_section_items
from .document_converter_sections import hints_by_doc_section
from .generate_snapshot import snapshot_for_resume

logger = logging.getLogger(__name__)

#: 名字比对的容忍度：与 ``profile_custom_filter._MIN_CONTAINMENT_CHARS`` 同值。两边都短于
#: 这个长度时只认完全相等，避免「证书」命中「证书A」。
_MIN_CONTAINMENT_CHARS = 4

#: 「补不进」的业务码（前端据此区分"去制作台"与"重试"）。
ERROR_SECTION_MISSING = "profile_section_missing"
ERROR_GROUP_MISMATCH = "profile_group_mismatch"
ERROR_ENTRY_MISSING = "profile_entry_missing"
ERROR_EMPTY_SELECTION = "profile_entries_required"


class AppendError(Exception):
    """确定性的、可解释的失败（路由翻成对应状态码 + 业务码，不产生 500）。"""

    def __init__(self, code: str, detail: str, *, status_code: int = 409) -> None:
        super().__init__(f"{code}: {detail}")
        self.code = code
        self.detail = detail
        self.status_code = status_code


@dataclass
class AppendOutcome:
    """一次补入的结果：正文已保存的新记录 + 补进去/被跳过的条目名。"""

    record: ResumeRecord
    revision: int
    appended: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)

    @property
    def written(self) -> bool:
        return bool(self.appended) or bool(self.skipped)


def _clean(value: Any) -> str:
    return str(value or "").strip()


def _normalize(value: Any) -> str:
    """名字比对口径：去掉所有空白并忽略大小写（与覆盖度清单的口径一致）。"""
    return "".join(_clean(value).split()).casefold()


def _same_name(left: Any, right: Any) -> bool:
    """两个条目名是不是同一条（完全相等，或都够长时的双向包含）。

    与 ``profile_custom_filter._same_entry_name`` 同一口径：投影可能把长文本截断，所以
    允许包含；但两边都短于 ``_MIN_CONTAINMENT_CHARS`` 时只认完全相等，否则「证书」会把
    「证书A」判成同一条、用户点了补入什么也没发生。
    """
    a = _normalize(left)
    b = _normalize(right)
    if not a or not b:
        return False
    if a == b:
        return True
    if len(a) < _MIN_CONTAINMENT_CHARS or len(b) < _MIN_CONTAINMENT_CHARS:
        return False
    return a in b or b in a


def _document_entry_name(entry: Mapping[str, Any]) -> str:
    """文档里一条 entry 的"身份名"：首个文本项正文，否则首个字段项的值。

    与 ``profile_custom_filter._written_custom_names`` 同口径（那边读 v1 条目，这边读 v2
    entry），两边必须一致——否则"已经补过"和"没补过"会给出相反答案。
    """
    items = entry.get("items") or []
    for item in items:
        if not isinstance(item, Mapping):
            continue
        if item.get("kind") == "text":
            text = _clean(item.get("text"))
            if text:
                return text
    for item in items:
        if not isinstance(item, Mapping):
            continue
        value = _clean(item.get("value"))
        if value:
            return value
    return ""


def _projected_custom_entries(consumed: ConsumedProfile, section_key: str) -> dict[str, Any]:
    """``entry_id -> v1 自建条目``（与生成链同一份投影，含截断与空条目跳过）。"""
    projected = project_paper_content(consumed)
    for section in getattr(projected, "custom_sections", None) or []:
        if str(getattr(section, "key", "")) != section_key:
            continue
        return {
            str(getattr(entry, "entry_id", "")): entry
            for entry in getattr(section, "entries", None) or []
            if str(getattr(entry, "entry_id", ""))
        }
    return {}


def _custom_hints(db: Session, section_key: str) -> tuple[Any, ...]:
    """自定义字段定义提示（``build_custom_section_items`` 用它决定落位与来源）。"""
    grouped = hints_by_doc_section(document_io.custom_field_definitions(db))
    return tuple(grouped.get(section_key, ()))


def _entry_identity(entry: Any) -> str:
    """v1 自建条目的身份名：主文本优先，否则第一条有值的「标签：值」行。"""
    text = _clean(getattr(entry, "text", ""))
    if text:
        return text
    for line in getattr(entry, "lines", None) or ():
        value = _clean(getattr(line, "value", ""))
        if value:
            return value
    return ""


def _find_document_section(document: dict[str, Any], section_key: str) -> dict[str, Any] | None:
    for section in document.get("sections") or []:
        if isinstance(section, dict) and str(section.get("key") or "") == section_key:
            return section
    return None


def _build_entry(
    entry_id: str, section_key: str, legacy_entry: Any, hints: Sequence[Any]
) -> dict[str, Any]:
    """一条资料条目 → v2 entry（item/entry 的 id 都由 entry_id 稳定派生）。

    entry id 走 ``stable_object_id`` 而不是直接截断 entry_id：v2 的对象 id 必须满足
    W01 的 8–32 位口径，而资料侧的 entry_id 长度不受我们控制；派生之后同一份资料在
    任何一份简历里都是同一个可预期 id，重放同样的补入不会抖动（内容相同也不会误判"变了"）。
    """
    items = build_custom_section_items(legacy_entry, ConversionReport(), hints, scope=entry_id)
    entry = ResumeEntry(
        id=stable_object_id("ob_", section_key, entry_id),
        hidden=False,
        items=items,  # type: ignore[arg-type]  # 已构造好的 v2 item 实例
    )
    return entry.model_dump(mode="json")


def _prune_list(values: Any, drop: set[str]) -> list[str]:
    return [str(value) for value in (values or []) if str(value) not in drop]


def _prune_note(note: Mapping[str, Any], drop: set[str]) -> dict[str, Any] | None:
    """把已补入的名字从一条 note 里摘掉；摘完没有名字 → 这条 note 整体删除。"""
    names = [str(name) for name in (note.get("names") or []) if str(name)]
    remaining = [name for name in names if name not in drop]
    if not remaining:
        return None
    updated = dict(note)
    removed = len(names) - len(remaining)
    updated["names"] = remaining
    total = int(note.get("total") or len(names))
    # total 是"未写入条数"，可能大于 names（清单被截断过）：先按摘掉的数量递减，
    # 但不允许小于剩下的可见条数——两个口径打架时以"看得见的"为准。
    updated["total"] = max(len(remaining), total - removed)
    for key in ("filtered", "capacity_omitted", "model_omitted", "entry_ids"):
        if key in note:
            updated[key] = _prune_list(note.get(key), drop)
    reasons = note.get("reasons")
    if isinstance(reasons, Mapping):
        updated["reasons"] = {
            str(name): reason for name, reason in reasons.items() if str(name) not in drop
        }
    return updated


def prune_coverage_notes(
    notes: Sequence[Mapping[str, Any]], section_key: str, names: Sequence[str]
) -> list[dict[str, Any]]:
    """插入成功后修剪 ``coverage_notes``（3-A「必带改动」第三条）。

    ``names`` 是**已在那份文档里**的条目名（补入的 + 因为已经存在而被跳过的）：两种情况下
    清单里的"没写进简历"都不再成立，留着就是错的。
    """
    drop = {str(name) for name in names if str(name)}
    pruned: list[dict[str, Any]] = []
    for note in notes or []:
        if not isinstance(note, Mapping):
            continue
        if str(note.get("section") or "") != section_key:
            pruned.append(dict(note))
            continue
        updated = _prune_note(note, drop)
        if updated is not None:
            pruned.append(updated)
    return pruned


def _save_coverage_notes(
    db: Session, record_id: int, revision: int, notes: list[dict[str, Any]]
) -> int:
    """覆盖度快照单独落一版（见模块 docstring 的"两次写"）。

    条件写 ``WHERE revision = 刚写出的那一版``：期间别处保存过就放弃——那份正文对应的
    清单不该被这次补入改写（下次补入会重算）。
    """
    result = db.execute(
        update(ResumeRecord)
        .where(ResumeRecord.id == record_id, ResumeRecord.revision == revision)
        .values(coverage_notes=notes, revision=ResumeRecord.revision + 1)
        .execution_options(synchronize_session=False)
    )
    db.commit()
    # ``db.execute(update(...))`` 的静态返回类型是 ``Result``，而 ``rowcount`` 只在
    # ``CursorResult`` 上（ORM UPDATE 一定拿到它）。getattr 取值，缺失时退化为 0（= 放弃
    # 修剪，与"版本已变"同一分支），``!= 1`` 的判定语义不变。
    if getattr(result, "rowcount", 0) != 1:
        logger.info("覆盖度清单修剪跳过（版本已变） record_id=%s revision=%s", record_id, revision)
        return revision
    record = db.get(ResumeRecord, record_id)
    if record is not None:
        db.refresh(record)
        return int(record.revision or 0)
    return revision


def _resolve_section(consumed: ConsumedProfile, section_key: str) -> ConsumedSection:
    section = consumed.section(section_key)
    if section is None:
        raise AppendError(
            ERROR_SECTION_MISSING,
            "该分区不在当前资料组里：请先切回这份简历生成时使用的资料组，再重试",
        )
    return section


def _ensure_same_group(db: Session, record: ResumeRecord, consumed: ConsumedProfile) -> None:
    """生成快照里的组与当前组不一致 → 拒绝（不跨组插入，见模块 docstring）。"""
    snapshot = snapshot_for_resume(db, record.id)
    snapshot_group = _clean(getattr(snapshot, "group_id", "")) if snapshot is not None else ""
    if snapshot_group and snapshot_group != consumed.group_id:
        raise AppendError(
            ERROR_GROUP_MISMATCH,
            "这份简历生成时使用的是另一个资料组，当前组里找不到这些条目："
            "请切回生成时使用的资料组后重试",
        )


def append_profile_entries(
    db: Session,
    *,
    record_id: int,
    section_key: str,
    entry_ids: Sequence[str],
    expected_revision: int | None = None,
) -> AppendOutcome:
    """把 ``entry_ids`` 指定的资料条目确定性追加到目标分区。

    行为约定（与问题清单 3-A 逐条对应）：
    - 分区不存在 → 在文档里**新建**（key 原样沿用资料分区键，自建板块即 ``custom:<id>``，
      与 ``format_config.section_order`` 的键同源）；
    - 条目已在该分区（按身份名）→ **跳过**并记入 ``skipped``，重复点不产生第二条；
    - 某条资料已删除 → 抛 :class:`AppendError`，一个字节都不写（不静默跳过）；
    - 成功 → 走 ``save_content`` 推进一版，再修剪 ``coverage_notes``。
    """
    requested = [str(entry_id) for entry_id in entry_ids if str(entry_id).strip()]
    if not requested:
        raise AppendError(ERROR_EMPTY_SELECTION, "没有指定要补入的资料条目", status_code=400)

    record = db.get(ResumeRecord, record_id)
    if record is None:
        raise AppendError(ERROR_ENTRY_MISSING, "简历记录不存在或已被删除", status_code=404)
    consumed = load_ai_consumed_profile(db)
    section = _resolve_section(consumed, section_key)
    _ensure_same_group(db, record, consumed)

    projected = _projected_custom_entries(consumed, section_key)
    missing = [entry_id for entry_id in requested if entry_id not in projected]
    if missing:
        logger.info(
            "补入资料条目失败（已删除/不在当前组） record_id=%s section=%s missing=%s",
            record_id,
            section_key,
            missing,
        )
        raise AppendError(
            ERROR_ENTRY_MISSING,
            f"有 {len(missing)} 条资料已删除或不在当前资料组里，无法补入："
            + "、".join(missing[:5]),
            status_code=409,
        )

    document, _report = document_io.document_for_record(db, record)
    if not isinstance(document, dict):
        raise AppendError(
            ERROR_SECTION_MISSING, "这份简历的正文结构不可读，无法补入", status_code=422
        )
    target = _find_document_section(document, section_key)
    if target is None:
        # 分区不存在 → 新建。标题用资料分区名（自建板块即用户起的名字）。
        target = {
            "key": section_key,
            "title": section.name or section_key,
            "kind": "entries",
            "entries": [],
        }
        document.setdefault("sections", []).append(target)
    existing = {
        _document_entry_name(entry)
        for entry in target.get("entries") or []
        if isinstance(entry, dict)
    }

    hints = _custom_hints(db, section_key)
    appended: list[str] = []
    skipped: list[str] = []
    for entry_id in requested:
        legacy_entry = projected[entry_id]
        name = _entry_identity(legacy_entry)
        if not name:
            raise AppendError(
                ERROR_ENTRY_MISSING, "这条资料没有任何可写入的内容，无法补入", status_code=409
            )
        if any(_same_name(name, written) for written in existing):
            skipped.append(name)
            continue
        target.setdefault("entries", []).append(
            _build_entry(entry_id, section_key, legacy_entry, hints)
        )
        existing.add(name)
        appended.append(name)

    if not appended and not skipped:
        raise AppendError(ERROR_ENTRY_MISSING, "没有可补入的内容", status_code=409)

    try:
        normalized = document_to_json(parse_document(document))
    except Exception as exc:  # noqa: BLE001 - 结构不合法要变成可解释的 422，不是 500
        logger.warning("补入后文档结构校验失败 record_id=%s：%s", record_id, exc)
        raise AppendError(
            ERROR_SECTION_MISSING,
            "补入后正文结构校验失败，已放弃写入（正文未改动）",
            status_code=422,
        ) from exc

    from .document_save import save_content  # 延迟导入：本模块被路由导入，避免环

    # 只有真写了条目才落库：全部 skipped 时正文没变，不该推进版本。
    if appended:
        outcome = save_content(
            db,
            record_id=record_id,
            content=normalized,
            expected_revision=expected_revision,
        )
        if outcome is None:
            raise AppendError(ERROR_ENTRY_MISSING, "简历记录不存在或已被删除", status_code=404)
        record = outcome.record
        revision = int(outcome.revision or 0)
    else:
        record = db.get(ResumeRecord, record_id)
        if record is None:
            raise AppendError(ERROR_ENTRY_MISSING, "简历记录不存在或已被删除", status_code=404)
        revision = int(record.revision or 0)

    # 补入的与因已存在而跳过的，都算"已经在正文里"，一起从清单里摘掉。
    current_notes = [
        dict(note) for note in (record.coverage_notes or []) if isinstance(note, Mapping)
    ]
    pruned = prune_coverage_notes(current_notes, section_key, appended + skipped)
    # 清单逐字没有变化 → **不写、不推进版本**。典型场景就是重复点一次「补进简历」：全部
    # skipped，名字上一次已经摘干净了。这里若无条件落一版，别的窗口正在编辑的那份简历会
    # 凭空收到 ``resume_revision_conflict``——推进版本必须对应"内容真的变了"。
    if pruned != current_notes:
        revision = _save_coverage_notes(db, record_id, revision, pruned)
    record = db.get(ResumeRecord, record_id)
    if record is None:
        raise AppendError(ERROR_ENTRY_MISSING, "简历记录不存在或已被删除", status_code=404)
    return AppendOutcome(record=record, revision=revision, appended=appended, skipped=skipped)


__all__ = [
    "AppendError",
    "AppendOutcome",
    "ERROR_EMPTY_SELECTION",
    "ERROR_ENTRY_MISSING",
    "ERROR_GROUP_MISMATCH",
    "ERROR_SECTION_MISSING",
    "append_profile_entries",
    "prune_coverage_notes",
]
