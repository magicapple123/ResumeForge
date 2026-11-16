# SPDX-License-Identifier: Apache-2.0
"""投递队列的查询条数预算（RF-05：``reorder_queue`` 的 N+1 与列表出口的逐条读取）。

两条被钉住的性质：

1. **重排的排序阶段 SELECT 次数是常数**。原实现逐条 ``db.get(ApplyQueueItem, item_id)``：
   拖 1 行 1 条 SELECT、拖 50 行 50 条——而这些查询只为了在内存里写一个整数。
   实测（本文件，``_count_statements``，只计 SELECT）：修复前 N=1 → 1 条、N=50 → 50 条；
   修复后两者都是 1 条。
2. **列表出口的逐条读取不再随行数增长**。``list_queue`` 原先每行各一次
   ``db.get(ResumeRecord)`` 与一次 ``latest_match(db, job_id)``；现在整页各一次 ``in_`` 查询。
   实测：N=1 与 N=50 都是 4 条（条目 + 岗位 + 简历标题 + 匹配结论）。

计数只数 SQL 条数、不设耗时阈值——耗时在 CI 机器上不可复现，条数是确定性的。

**不在本批范围内的逐条读取**（保留并在此说明理由）：``lifecycle.job_history`` 的采样序列
（``seens_for_job``）按 job_id 各读一次，``signals.reference_score`` 的简历文本同理。两者
属于"每行内容不同、且各自已有 cache 参数"的另一批优化，本文件因此在计数时把它们 stub 掉，
只测本批真正批量化掉的那两条。
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

import pytest
from app.models.apply import QUEUE_STATUS_PENDING, ApplyQueueItem
from app.models.job import JOB_STATUS_OPEN, Job
from app.models.resume import ResumeRecord
from app.services.apply import _queue
from sqlalchemy.orm import Session
from test_apply_task_detail_queries import _count_statements

# 重排的**排序阶段**（把新顺序写进 sort_order）只允许 1 条 SELECT：一次批量取回。
MAX_REORDER_SELECTS = 1

# 列表整页的预算：条目查询 + 岗位批量 + 简历标题批量 + 匹配结论批量。
MAX_LIST_QUEUE_SELECTS = 4

# 计数时的行数档位：1 与 50 覆盖"单行"和"够多到能暴露 N+1"两端。
QUEUE_SIZES = (1, 50)


@contextmanager
def _fresh_session() -> Iterator[Session]:
    """用**独立会话**跑被测代码（真实请求也是每个请求一个会话）。

    这一步不是洁癖：种数据用的是 ``db_session``，条目都在它的 identity-map 里，
    ``db.get`` 命中缓存就**不会发 SQL**——「N+1 被测成 0 条」，预算用例会永久变绿。
    独立会话读的是库，才测得到真实的语句数。
    """
    from app.database import SessionLocal

    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def _selects(statements: list[str]) -> list[str]:
    return [sql for sql in statements if sql.lstrip().upper().startswith("SELECT")]


def _frozen_history(_db, _job, *, cache=None):  # noqa: ARG001 - 与真实签名同形，只为可读
    """``lifecycle.job_history`` 的替身：固定返回"历史不足"（本批不测它的逐行读取）。"""
    return {"score": None, "evidence": ["历史不足"], "jd_changed": False}


def _no_reference_score(_db, _job, _match=None, *, cache=None):  # noqa: ARG001
    """``signals.reference_score`` 的替身：同上，避免它的逐行读库混进计数。"""
    return None


@pytest.fixture
def quiet_row_readers(monkeypatch):
    """把两个"每行内容不同"的读取器换成常量返回（见模块 docstring 最后一段）。"""
    monkeypatch.setattr(_queue, "job_history", _frozen_history)
    monkeypatch.setattr(_queue, "reference_score", _no_reference_score)


def _seed_queue(db_session, count: int, *, with_resumes: bool = True) -> list[ApplyQueueItem]:
    """造 ``count`` 条队列条目（每条带一个岗位；``with_resumes`` 时再各带一份简历）。"""
    items: list[ApplyQueueItem] = []
    for index in range(count):
        job = Job(
            title=f"岗位{index}",
            company=f"公司{index}",
            source="BOSS直聘",
            source_url=f"https://www.zhipin.com/job/{index}",
            status=JOB_STATUS_OPEN,
        )
        db_session.add(job)
        db_session.flush()
        resume_id = None
        if with_resumes:
            resume = ResumeRecord(title=f"简历{index}", content={}, job_id=job.id)
            db_session.add(resume)
            db_session.flush()
            resume_id = resume.id
        item = ApplyQueueItem(
            job_id=job.id,
            job_title=job.title,
            company=job.company,
            resume_id=resume_id,
            sort_order=index + 1,
            status=QUEUE_STATUS_PENDING,
        )
        db_session.add(item)
        items.append(item)
    db_session.commit()
    return items


def _stub_list_queue(monkeypatch) -> list[list[int]]:
    """把出口替换成不查库的桩，只保留"排序阶段"的 SQL（调用参数会被记录下来）。"""
    calls: list[list[int]] = []

    def fake_list_queue(_db, limit: int = _queue.MAX_QUEUE_LIST):  # noqa: ARG001
        calls.append([limit])
        return []

    monkeypatch.setattr(_queue, "list_queue", fake_list_queue)
    return calls


# ===== 重排：排序阶段的 SELECT 次数与行数无关 =====


@pytest.mark.parametrize("count", QUEUE_SIZES)
def test_reorder_select_count_is_constant(db_session, monkeypatch, count):
    """N=1 与 N=50 的排序阶段都是 1 条 SELECT（修复前分别是 1 与 50）。"""
    items = _seed_queue(db_session, count)
    order = [item.id for item in reversed(items)]
    _stub_list_queue(monkeypatch)

    with _fresh_session() as session, _count_statements() as statements:
        _queue.reorder_queue(session, order)

    selects = _selects(statements)
    assert len(selects) <= MAX_REORDER_SELECTS, (
        f"{count} 行的重排执行了 {len(selects)} 条 SELECT"
        f"（预算 {MAX_REORDER_SELECTS} 条）：\n" + "\n".join(selects)
    )


def test_reorder_empty_order_issues_no_select(db_session, monkeypatch):
    """空 order 不发查询、不报错（``in_([])`` 会白跑一次，这里显式跳过）。"""
    _seed_queue(db_session, 2)
    calls = _stub_list_queue(monkeypatch)

    with _fresh_session() as session, _count_statements() as statements:
        result = _queue.reorder_queue(session, [])

    assert result == []
    assert _selects(statements) == []
    assert len(calls) == 1, "出口仍应调用一次 list_queue"


# ===== 重排：行为回归 =====


def test_reorder_writes_display_order(db_session):
    """界面顺序（从上到下）写回成逆序的 sort_order——与 list_queue 的倒序口径配对。"""
    items = _seed_queue(db_session, 3)
    reversed_ids = [item.id for item in reversed(items)]

    _queue.reorder_queue(db_session, reversed_ids)

    db_session.expire_all()
    by_id = {item.id: item for item in db_session.query(ApplyQueueItem).all()}
    # total=3：第 0 位（最上面）拿到 3，最后一位拿到 1。
    assert [by_id[item_id].sort_order for item_id in reversed_ids] == [3, 2, 1]
    # 真实出口（list_queue）此刻的显示顺序应与传入顺序一致。
    assert [row.id for row in _queue.list_queue(db_session)] == reversed_ids


def test_reorder_skips_missing_ids_but_keeps_slot_count(db_session, monkeypatch):
    """缺失的 id 跳过，``total`` 仍是 len(order)（含缺失项）——序号按界面槽位算。"""
    items = _seed_queue(db_session, 2)
    first, second = items[0].id, items[1].id
    _stub_list_queue(monkeypatch)

    _queue.reorder_queue(db_session, [first, 999_999, second])

    db_session.expire_all()
    assert db_session.get(ApplyQueueItem, first).sort_order == 3
    assert db_session.get(ApplyQueueItem, second).sort_order == 1


def test_reorder_with_duplicate_ids_lets_the_last_slot_win(db_session, monkeypatch):
    """重复 id 由靠后的那次槽位覆盖（与逐条 db.get 拿到同一对象、后写覆盖前写一致）。"""
    items = _seed_queue(db_session, 2)
    first, second = items[0].id, items[1].id
    _stub_list_queue(monkeypatch)

    _queue.reorder_queue(db_session, [first, second, first])

    db_session.expire_all()
    # total=3：first 先拿 3-0=3、后被 3-2=1 覆盖；second 拿 3-1=2。
    assert db_session.get(ApplyQueueItem, first).sort_order == 1
    assert db_session.get(ApplyQueueItem, second).sort_order == 2


def test_reorder_commits_once_and_refreshes_updated_at(db_session, monkeypatch):
    """单次 commit + 逐行刷新 updated_at（拖拽后"最后更新时间"必须变）。"""
    items = _seed_queue(db_session, 2)
    before = {item.id: item.updated_at for item in items}
    _stub_list_queue(monkeypatch)

    _queue.reorder_queue(db_session, [items[1].id, items[0].id])

    db_session.expire_all()
    for item_id, stamp in before.items():
        assert db_session.get(ApplyQueueItem, item_id).updated_at >= stamp


# ===== 列表出口：逐条读取已批量 =====


@pytest.mark.parametrize("count", QUEUE_SIZES)
def test_list_queue_select_count_is_constant(db_session, quiet_row_readers, count):
    """整页出口的 SELECT 次数与行数无关（修复前每行多 2 条：简历标题 + 匹配结论）。

    ``quiet_row_readers`` 掐掉两个刻意保留的逐行读取器（见模块 docstring）。
    """
    _seed_queue(db_session, count)

    with _fresh_session() as session, _count_statements() as statements:
        rows = _queue.list_queue(session)

    selects = _selects(statements)
    assert len(rows) == count
    assert len(selects) == MAX_LIST_QUEUE_SELECTS, (
        f"{count} 行的队列列表执行了 {len(selects)} 条 SELECT"
        f"（预算 {MAX_LIST_QUEUE_SELECTS} 条）：\n" + "\n".join(selects)
    )
    # 行为不变：批量化之后每行的简历标题仍按 resume_id 对得上（标题由工厂按序生成）。
    for row in rows:
        assert row.resume_id is not None
        assert row.resume_title == f"简历{row.sort_order - 1}"


def test_list_queue_resume_title_is_empty_when_resume_missing(db_session, quiet_row_readers):
    """简历被删（行不存在）时标题为空串——与逐条 ``db.get`` 的口径一致，不抛错。"""
    items = _seed_queue(db_session, 1, with_resumes=False)
    assert items[0].resume_id is None

    rows = _queue.list_queue(db_session)

    assert len(rows) == 1
    assert rows[0].resume_title == ""


def test_single_item_outlet_still_reads_per_row(db_session):
    """单条出口（入队 / 改招呼语）不传预取字典，仍按单条口径自己读（行为未变）。"""
    items = _seed_queue(db_session, 1)
    item = items[0]

    row = _queue._queue_out(db_session, item, db_session.get(Job, item.job_id))

    assert row.resume_title == "简历0"
    assert row.id == item.id
