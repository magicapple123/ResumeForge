"""全局搜索的 FTS5（trigram）检索支持——``/api/search`` 的多表全文索引层。

2026-10 万级数据优化批：全局搜索此前对 8 张表做 ``LIKE '%kw%'`` 线性扫描
（perf-evidence 实测 p95 23.3ms 且随数据量线性增长）。本模块把**能 FTS 化的
数据域**迁到迁移 ``0046_search_fts`` 建的 FTS5 trigram 虚拟表上，语义与 LIKE
完全一致（子串匹配、ASCII 大小写折叠相同，见 :func:`match_expression`），
表不存在（历史库没跑过新迁移、SQLite 太旧）或关键词过短（< 3 字符）时回退
原 LIKE 路径，行为与迁移前一致。

设计沿用迁移 0044（知识库 ``knowledge_fts``）的先例：

- external content 模式：FTS 表不存文本，只存倒排索引，rowid 对齐业务表 ``id``；
- 三个 AFTER 触发器（INSERT / UPDATE / DELETE）增量同步，软删除是 UPDATE——
  索引里仍会保留已软删的行，排除软删靠查询侧的 ``trash.live_only``（与
  knowledge 检索同一套口径）；
- 各数据域的可用性按 Engine 进程内缓存（表存在与否在库生命周期内不变），
  测试删表后须调用 :func:`reset_cache`（conftest 已接入）。

**为什么技能（``skill``）保留 LIKE**：它是个人资料的硬删子表，一个用户至多
几十行，全表扫描本身就是常数级；为它建虚拟表 + 3 个触发器的维护成本远大于
收益，强行一刀切是负优化。
"""

from __future__ import annotations

from weakref import WeakKeyDictionary

from sqlalchemy import bindparam, literal_column, select, text
from sqlalchemy.orm import Session

from .knowledge_service import _match_expression

# 各数据域的 FTS 表名前缀与被索引列——列清单与 ``app/api/search.py`` 里各域的
# LIKE 字段**一一对应**，改任何一侧都要同步另一侧（test_search_fts.py 的对照
# 测试按"FTS 路径结果 == LIKE 路径结果"钉住这个不变量）。
SEARCH_FTS_PREFIX = "search_fts"
SEARCH_FTS_SPECS: dict[str, tuple[str, ...]] = {
    "job": ("title", "company", "location", "description", "additional_info", "note"),
    "resume_record": ("title", "job_title", "company", "content"),
    "referral": ("job_title", "company", "referrer_name", "position", "note"),
    "reminder": ("title", "note"),
    "interview_experience": ("title", "company", "position", "content"),
    "claim_record": ("title", "category", "subject", "source_fact", "candidate_wording"),
    "material": ("title", "category", "content", "note", "url"),
}


def fts_table_name(base_table: str) -> str:
    """某业务表的 FTS 虚拟表名（影子表是 ``{名字}_data/_idx/_docsize/_config``）。"""
    return f"{SEARCH_FTS_PREFIX}_{base_table}"


# 所有派生表（虚拟表 + 影子表）按前缀识别：conftest 清库、备份导入校验都靠它。
def is_fts_derived_table(name: str) -> bool:
    return name.startswith(SEARCH_FTS_PREFIX)


# 可用性按 (Engine, 表) 缓存：探测要打一次 sqlite_master/虚拟表，反复搜索
# 不必每次都探测。测试库各有独立 engine，互不串缓存。
_FTS_CACHE: WeakKeyDictionary = WeakKeyDictionary()


def reset_cache() -> None:
    """清空可用性缓存（conftest 删派生表后必须调用，否则陈旧结果跨用例泄漏）。"""
    _FTS_CACHE.clear()


def fts_available(db: Session, base_table: str) -> bool:
    """某数据域的 FTS 表是否可用（迁移 0046 建过且当前 SQLite 支持 trigram）。

    迁移只在 FTS5 trigram 可用的 SQLite 上建表，所以"表存在"即"可用"；表不存在
    时的一切失败（历史库没跑过新迁移、SQLite 太旧、迁移按表跳过）都归为不可用，
    调用方回退 LIKE。
    """
    engine = db.get_bind()
    cached = _FTS_CACHE.get(engine)
    if cached is None:
        cached = _FTS_CACHE[engine] = set()
    if base_table in cached:
        return True
    try:
        db.execute(text(f"SELECT rowid FROM {fts_table_name(base_table)} LIMIT 1")).all()
    except Exception:  # noqa: BLE001 - 探测失败一律视为不可用
        return False
    cached.add(base_table)
    return True


def id_match_filter(db: Session, model: type, base_table: str, term: str):
    """按关键词返回 ``model.id`` 的过滤条件；不适配时返回 ``None``（调用方回退 LIKE）。

    返回 ``None`` 的情形：FTS 表不可用（走 LIKE 保语义）或关键词 strip 后长度
    不足 3 字符（trigram 表达不了短查询）。否则返回 ``id IN (MATCH 子查询)``：
    MATCH 命中任一被索引列即算命中，与各域 ``or_(多列 LIKE)`` 语义一致。
    """
    expression = _match_expression(term)
    if expression is None or not fts_available(db, base_table):
        return None
    fts_table = fts_table_name(base_table)
    subquery = (
        select(literal_column("rowid"))
        .select_from(text(fts_table))
        .where(text(f"{fts_table} MATCH :fts_match").bindparams(bindparam("fts_match", expression)))
    )
    return model.id.in_(subquery)


__all__ = [
    "SEARCH_FTS_SPECS",
    "fts_available",
    "fts_table_name",
    "id_match_filter",
    "is_fts_derived_table",
    "reset_cache",
]
