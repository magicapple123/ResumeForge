# SPDX-License-Identifier: Apache-2.0
"""非 token 用量计数（T16）：OCR 页数 / TTS 字符数 / ASR 秒数 / 搜索次数。

这四类外部服务不按 token 计费，账本的 per-million-token 口径装不下它们，于是单独记
"次数 / 页数 / 字符数 / 秒数"。**本模块没有任何单价、汇率或金额字段**：决策 #5 是
"用量不折算金额"，所以这里连"数量 × 单价"的入口都不提供——想加费用，先改决策。

## 为什么不在 llm_usage_record 里加行，而是同一个库里的 external 分区

1. 那张表的列是 token 形状（prompt/completion/cache_hit/cache_miss/total）。把"页数"塞进
   `total_tokens` 会让 `summarize_usage` 的任务/模型汇总与 `unknown_token_records` 直接失真，
   而 `/api/usage/summary`、`generation_cost` 都在读同一批列。反过来写 `task="external_ocr"`
   的零 token 行同样会污染 `records` 计数、结束原因直方图与逐条诊断列表。让一个字段承载两种
   语义就得在每个读点加过滤——那是第二套语义，不是复用。
2. 新建一张表需要迁移 + 备份表名冻结快照（`backend/tests/fixtures/backup_table_snapshot.json`），
   而 T16 是"插空"任务，不该动迁移链。

所以落点是**同一个 SQLite 库**的 `app_setting`（键值表，JSON 一行一个键）里的专用分区
``external_usage_counters``：与 token 账本同库、同数据集、同备份覆盖面，不与任何 token 口径
共享列。老库不需要迁移——这一行在首次写入时才出现。

结构：``{"version": 1, "days": {"2026-11-15": {"ocr": 12, "asr": 95.5}}, "dedupe": {key: day}}``。
`days` 只留最近 `MAX_WINDOW_DAYS` 天（默认 400），`dedupe` 是最多 `MAX_DEDUPE_KEYS` 条的
幂等索引——生产方重试/重连重复上报时，同一个 `dedupe_key` 只累加一次。

记账是**旁路**：存储异常在本模块内吞掉并记 warning，绝不把已经成功的业务调用反写成失败；
只有**编程错误**（未知类别、负数、非有限数字）才抛 `ValueError`。读改写不是原子操作——本地
单用户 + SQLite 单写者，且 `dedupe_key` 已挡住"重试重复计数"这个真实场景，不同生产方并发写
同一天最多丢一次增量；要严格不丢就传 `dedupe_key` 并在失败后重试。
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import logging
import math
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from numbers import Real
from typing import Any

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from ..database import SessionLocal
from ..models.setting import AppSetting

logger = logging.getLogger(__name__)

KIND_OCR = "ocr"
KIND_TTS = "tts"
KIND_ASR = "asr"
KIND_SEARCH = "search"

#: 四类外部用量的字面量（生产方按这些常量传，不要自己拼字符串）。
KINDS: tuple[str, ...] = (KIND_OCR, KIND_TTS, KIND_ASR, KIND_SEARCH)

#: 类别 -> 响应字段名。TTS 的字符数口径与 DeepSeek 一致：一个汉字算 2 字符，由**生产方**
#: 折算后传进来（本模块只管累加，不猜语言）。
FIELD_BY_KIND: dict[str, str] = {
    KIND_OCR: "ocr_pages",
    KIND_TTS: "tts_chars",
    KIND_ASR: "asr_seconds",
    KIND_SEARCH: "search_calls",
}

#: 类别 -> 计量单位（英文枚举，给前端映射文案用；界面文案在语言包里）。
UNIT_BY_KIND: dict[str, str] = {
    KIND_OCR: "pages",
    KIND_TTS: "chars",
    KIND_ASR: "seconds",
    KIND_SEARCH: "calls",
}

# 页数 / 字符数 / 次数是整数；秒数允许小数（前端 VAD 切出来的片段常常不是整秒）。
_INTEGRAL_KINDS = frozenset({KIND_OCR, KIND_TTS, KIND_SEARCH})
_SECONDS_PRECISION = 3


DEFAULT_WINDOW_DAYS = 30
MAX_WINDOW_DAYS = 400
MAX_DEDUPE_KEYS = 2000

_MAX_SOURCE_LENGTH = 32
_MAX_DEDUPE_LENGTH = 96
_SETTING_KEY = "external_usage_counters"
# 分区损坏时原地保留原文，绝不"悄悄从零开始"。
_SALVAGE_KEY = "external_usage_counters.corrupt"
_DOC_VERSION = 1


@dataclass(frozen=True)
class RecordOutcome:
    """一次上报的结果；生产方可以只看 `recorded` 决定要不要重试。

    - `recorded=True`：本次数量已累加；
    - `deduped=True`：`dedupe_key` 之前已经记过，本次**没有**累加（幂等命中）；
    - `quantity=0` 且两者都 False：数量为 0 / 存储失败，什么都没发生。
    """

    kind: str
    quantity: float
    day: str
    recorded: bool
    deduped: bool
    day_total: float


def _empty_document() -> dict[str, Any]:
    return {"version": _DOC_VERSION, "days": {}, "dedupe": {}}


def _normalize_kind(kind: str) -> str:
    """类别只接受四个字面量；拼错要给响亮的错误，不要静默记到别处。"""
    value = str(kind or "").strip().lower()
    if value not in KINDS:
        raise ValueError(f"未知的外部用量类别：{kind!r}（可用：{'/'.join(KINDS)}）")
    return value


def _normalize_quantity(quantity: float, kind: str) -> float:
    """数量校验 + 按类别的精度归一（整数类四舍五入到整数，秒数保留三位小数）。"""
    if isinstance(quantity, bool) or not isinstance(quantity, Real):
        raise ValueError(f"用量必须是数字，收到 {type(quantity).__name__}")
    amount = float(quantity)
    if not math.isfinite(amount):
        raise ValueError("用量必须是有限数字")
    if amount < 0:
        raise ValueError("用量不能为负数")
    if kind in _INTEGRAL_KINDS:
        return float(int(round(amount)))
    return round(amount, _SECONDS_PRECISION)


def _coerce_date(value: date | datetime | None) -> date | None:
    """`datetime` 取本地日期部分，`date` 原样返回；None 保持 None。"""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    raise ValueError(f"时间参数必须是 date / datetime，收到 {type(value).__name__}")


def _day_key(at: date | datetime | None) -> str:
    """上报归属的日期键（ISO，可直接字符串比较）；默认今天。"""
    return (_coerce_date(at) or date.today()).isoformat()


def _parse_day(raw: str) -> date | None:
    try:
        return date.fromisoformat(raw)
    except (TypeError, ValueError):
        return None


def _normalize_dedupe_key(dedupe_key: str | None) -> str:
    """去重键归一：空/None = 不去重；超长走 sha256，避免截断撞库。"""
    key = "" if dedupe_key is None else str(dedupe_key).strip()
    if not key:
        return ""
    if len(key) <= _MAX_DEDUPE_LENGTH:
        return key
    return "sha256:" + hashlib.sha256(key.encode("utf-8")).hexdigest()[:32]


def _iter_mapping(value: Any):
    """只有 dict 才迭代 items；脏数据（list / 字符串 / None）当成空，不抛异常。"""
    return value.items() if isinstance(value, dict) else ()


def _amount_or_none(value: Any) -> float | None:
    """只认有限正数：bool / 字符串 / NaN / 负数一律当"没记过"。"""
    if isinstance(value, bool) or not isinstance(value, Real):
        return None
    amount = float(value)
    return amount if math.isfinite(amount) and amount > 0 else None


def _sanitize_document(raw: Any) -> dict[str, Any]:
    """把磁盘上的 JSON 收成可信结构：未知类别、脏日期、负数、非数字一律丢弃。"""
    document = _empty_document()
    if not isinstance(raw, dict):
        return document
    for day, bucket in _iter_mapping(raw.get("days")):
        if not isinstance(day, str) or _parse_day(day) is None or not isinstance(bucket, dict):
            continue
        clean: dict[str, float] = {}
        for kind in KINDS:
            amount = _amount_or_none(bucket.get(kind))
            if amount is not None:
                clean[kind] = amount
        if clean:
            document["days"][day] = clean
    for key, day in _iter_mapping(raw.get("dedupe")):
        if isinstance(key, str) and key and isinstance(day, str) and _parse_day(day) is not None:
            document["dedupe"][key] = day
    return document


def _read_document(db: Session) -> dict[str, Any]:
    row = db.get(AppSetting, _SETTING_KEY)
    if row is None or not row.value:
        return _empty_document()
    try:
        raw = json.loads(row.value)
    except (TypeError, ValueError):
        _salvage(db, row.value)
        return _empty_document()
    return _sanitize_document(raw)


def _salvage(db: Session, payload: str) -> None:
    """分区解析失败时把原文挪到 `.corrupt` 键（只写一次），再从头开始记。"""
    logger.warning("外部用量分区无法解析，原文已保留在 %s", _SALVAGE_KEY)
    try:
        if db.get(AppSetting, _SALVAGE_KEY) is None:
            db.add(AppSetting(key=_SALVAGE_KEY, value=payload[:65535]))
        broken = db.get(AppSetting, _SETTING_KEY)
        if broken is not None:
            db.delete(broken)
        db.commit()
    except SQLAlchemyError:  # pragma: no cover - 抢救失败只能放弃
        db.rollback()


def _write_document(db: Session, document: dict[str, Any]) -> None:
    serialized = json.dumps(document, ensure_ascii=False, sort_keys=True)
    row = db.get(AppSetting, _SETTING_KEY)
    if row is None:
        db.add(AppSetting(key=_SETTING_KEY, value=serialized))
    else:
        row.value = serialized
    db.commit()


def _prune(document: dict[str, Any], *, newest_day: date) -> None:
    """按天淘汰：超出窗口的天与超额的幂等键都不能无限留在设置行里。"""
    cutoff = (newest_day - timedelta(days=MAX_WINDOW_DAYS - 1)).isoformat()
    document["days"] = {day: bucket for day, bucket in document["days"].items() if day >= cutoff}
    kept = {key: day for key, day in document["dedupe"].items() if day >= cutoff}
    if len(kept) > MAX_DEDUPE_KEYS:
        ordered = sorted(kept.items(), key=lambda item: (item[1], item[0]))
        kept = dict(ordered[-MAX_DEDUPE_KEYS:])
    document["dedupe"] = kept


def _short_source(source: str) -> str:
    """生产方标记只进日志，超长截断免得把一行日志撑爆。"""
    return str(source or "")[:_MAX_SOURCE_LENGTH]


def _outcome(
    kind: str,
    day: str,
    *,
    quantity: float = 0.0,
    recorded: bool = False,
    deduped: bool = False,
    day_total: float = 0.0,
) -> RecordOutcome:
    return RecordOutcome(
        kind=kind,
        quantity=quantity,
        day=day,
        recorded=recorded,
        deduped=deduped,
        day_total=day_total,
    )


def record_external_usage(
    kind: str,
    quantity: float,
    *,
    source: str = "",
    at: date | datetime | None = None,
    dedupe_key: str | None = None,
    db: Session | None = None,
) -> RecordOutcome:
    """累加一次外部服务用量。

    Args:
        kind: `KIND_OCR` / `KIND_TTS` / `KIND_ASR` / `KIND_SEARCH` 之一。
        quantity: 本次数量（int / float 都收，bool 拒收）。OCR = 页数；TTS = 计费字符数
            （汉字算 2，生产方折算）；ASR = 音频秒数；搜索 = 成功请求次数。
        source: 生产方标记（`"resume_ocr"` 之类），**只用于日志定位**，不参与聚合。
        at: 归属时间（默认现在）。按**本地日期**归到某一天。
        dedupe_key: 幂等键。同一 key 再次上报不会重复累加（生产方重试时传请求 id /
            文件指纹 / 页面批次 id 即可）。为空表示不去重。
        db: 已有会话（测试或已带事务的调用方）。为 None 时本函数自己开会话并关闭。

    Returns:
        `RecordOutcome`：是否真的累加、当天该类别累计多少。

    Raises:
        ValueError: 未知类别、数量不是有限非负数字。这类是调用方 bug，必须暴露。
    """
    normalized_kind = _normalize_kind(kind)
    amount = _normalize_quantity(quantity, normalized_kind)
    day = _day_key(at)
    if amount <= 0:
        return _outcome(normalized_kind, day)
    dedupe = _normalize_dedupe_key(dedupe_key)
    owns_session = db is None
    session = SessionLocal() if db is None else db
    try:
        document = _read_document(session)
        if dedupe and dedupe in document["dedupe"]:
            logger.debug("外部用量幂等命中 %s/%s", normalized_kind, dedupe)
            day_total = float(document["days"].get(day, {}).get(normalized_kind, 0.0))
            return _outcome(normalized_kind, day, deduped=True, day_total=day_total)
        bucket = document["days"].setdefault(day, {})
        bucket[normalized_kind] = float(bucket.get(normalized_kind, 0.0)) + amount
        if dedupe:
            document["dedupe"][dedupe] = day
        _prune(document, newest_day=max(_parse_day(day) or date.today(), date.today()))
        _write_document(session, document)
        logger.debug("外部用量 %s+%s source=%s", normalized_kind, amount, _short_source(source))
        day_total = bucket[normalized_kind]
        return _outcome(normalized_kind, day, quantity=amount, recorded=True, day_total=day_total)
    except (SQLAlchemyError, OSError) as exc:
        # 旁路原则：业务调用已经成功了，记账失败只能记日志，不能反写失败。
        with contextlib.suppress(SQLAlchemyError):
            session.rollback()
        logger.warning("外部用量写入失败 %s/%s：%s", normalized_kind, _short_source(source), exc)
        return _outcome(normalized_kind, day)
    finally:
        if owns_session:
            session.close()


def _resolve_window(
    *,
    days: int | None = None,
    since: date | datetime | None = None,
    until: date | datetime | None = None,
    today: date | datetime | None = None,
) -> tuple[date, date]:
    """把 (days, since, until) 收敛成一个含首尾的日期区间。

    `days` 与 `since` 同时给时取**更窄**的那一头（用户不会期望"两个条件都放宽"）。
    """
    end = _coerce_date(until) or _coerce_date(today) or date.today()
    start = _coerce_date(since)
    if days is not None:
        span = max(1, min(int(days), MAX_WINDOW_DAYS))
        window_start = end - timedelta(days=span - 1)
        start = window_start if start is None else max(start, window_start)
    if start is None:
        start = end - timedelta(days=DEFAULT_WINDOW_DAYS - 1)
    if start > end:
        start = end
    return start, end


def window_payload(start: date, end: date) -> dict[str, Any]:
    """窗口的对外形状：天数 + 首尾 ISO 日期（前端据此写"近 N 天"）。"""
    return {
        "days": (end - start).days + 1,
        "since": start.isoformat(),
        "until": end.isoformat(),
    }


def _day_bucket(document: dict[str, Any], day: str) -> dict[str, float]:
    bucket = document["days"].get(day)
    return bucket if isinstance(bucket, dict) else {}


def _in_window_days(
    document: dict[str, Any], start: date, end: date
) -> list[tuple[str, dict[str, float]]]:
    start_key = start.isoformat()
    end_key = end.isoformat()
    return [
        (day, _day_bucket(document, day))
        for day in sorted(document["days"])
        if start_key <= day <= end_key
    ]


def _as_int(value: float) -> int:
    return int(round(value))


def _totals_between(document: dict[str, Any], start: date, end: date) -> dict[str, float]:
    totals = dict.fromkeys(KINDS, 0.0)
    for _day, bucket in _in_window_days(document, start, end):
        for kind in KINDS:
            totals[kind] += float(bucket.get(kind, 0.0))
    return totals


def totals_by_kind(
    db: Session,
    *,
    days: int | None = None,
    since: date | datetime | None = None,
    until: date | datetime | None = None,
    today: date | datetime | None = None,
) -> dict[str, float]:
    """窗口内按类别汇总的**原始数量**（键是 `ocr` / `tts` / `asr` / `search`）。"""
    start, end = _resolve_window(days=days, since=since, until=until, today=today)
    return _totals_between(_read_document(db), start, end)


def daily_series(
    db: Session,
    *,
    days: int | None = None,
    since: date | datetime | None = None,
    until: date | datetime | None = None,
    today: date | datetime | None = None,
) -> list[dict[str, Any]]:
    """按天聚合（只返回**有记录**的天，新→旧）；每天一条含四个字段。

    没有记录的天不补零：补零会让"那天什么都没用"和"那天没记"分不开。
    """
    start, end = _resolve_window(days=days, since=since, until=until, today=today)
    document = _read_document(db)
    rows: list[dict[str, Any]] = []
    for day, bucket in reversed(_in_window_days(document, start, end)):
        rows.append(
            {
                "day": day,
                "ocr_pages": _as_int(float(bucket.get(KIND_OCR, 0.0))),
                "tts_chars": _as_int(float(bucket.get(KIND_TTS, 0.0))),
                "asr_seconds": round(float(bucket.get(KIND_ASR, 0.0)), _SECONDS_PRECISION),
                "search_calls": _as_int(float(bucket.get(KIND_SEARCH, 0.0))),
            }
        )
    return rows


def summary(
    db: Session,
    *,
    days: int | None = None,
    since: date | datetime | None = None,
    until: date | datetime | None = None,
    today: date | datetime | None = None,
) -> dict[str, Any]:
    """对外的一块"外部服务用量"：四个数量 + 时间窗。**没有金额字段**。

    没记过任何数时四项都是 0（不是 None）：界面上"0 页"是可用的事实，空白会被读成
    "功能坏了"。
    """
    start, end = _resolve_window(days=days, since=since, until=until, today=today)
    totals = _totals_between(_read_document(db), start, end)
    return {
        "ocr_pages": _as_int(totals[KIND_OCR]),
        "tts_chars": _as_int(totals[KIND_TTS]),
        "asr_seconds": round(totals[KIND_ASR], _SECONDS_PRECISION),
        "search_calls": _as_int(totals[KIND_SEARCH]),
        "window": window_payload(start, end),
    }


def empty_summary(
    *,
    days: int | None = None,
    today: date | datetime | None = None,
) -> dict[str, Any]:
    """全零的同一形状：只在"读不出来"的降级路径上用，保证响应结构不变。"""
    start, end = _resolve_window(days=days, today=today)
    return {
        "ocr_pages": 0,
        "tts_chars": 0,
        "asr_seconds": 0.0,
        "search_calls": 0,
        "window": window_payload(start, end),
    }


__all__ = [
    "DEFAULT_WINDOW_DAYS",
    "FIELD_BY_KIND",
    "KINDS",
    "KIND_ASR",
    "KIND_OCR",
    "KIND_SEARCH",
    "KIND_TTS",
    "MAX_DEDUPE_KEYS",
    "MAX_WINDOW_DAYS",
    "RecordOutcome",
    "UNIT_BY_KIND",
    "daily_series",
    "empty_summary",
    "record_external_usage",
    "summary",
    "totals_by_kind",
    "window_payload",
]
