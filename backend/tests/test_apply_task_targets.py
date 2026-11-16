# SPDX-License-Identifier: Apache-2.0
"""开始投递的目标解析（``_resolve_targets``）：批量取数之后**必须不变**的契约。

这一批把 ``_resolve_targets`` 里的逐项纯查找换成批量取数（岗位一次 ``in_``、队列条目一次
``in_``），但"开始投递"是**写事务里的准入判断**，所以下面四件事在任何情况下都不能变：

1. **先报哪个错**：用户传 ``job_ids=[A, 999]`` 与 ``[999, A]`` 得到的错误不同——"第一个
   出问题的 id"按**输入顺序**决定，不能因为集合化就变成"按 id 排序后的第一个"。
2. **整批原子性**：任一目标不达标就整批不落库（没有"投了一半"的批次，运行器也不会被启动）。
3. **准入结论只认一处**：真实缺口仍是 409 + 缺口文案，读不出结论仍不在此阻断（闸门在入队侧）。
4. **去重保序**：同一岗位重复勾选只投一次，位置取第一次出现处。

另外钉住本批的收益（只数 SQL 条数，不设耗时阈值）：岗位与队列条目的读取是**固定 2 条**，
``latest_match`` 仍逐项（没有可复用的批量实现，见 ``_match.latest_match``：单行
``one_or_none()``，无批量版）。
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

import pytest
from app.models.apply import (
    ADMISSION_BLOCK,
    QUEUE_STATUS_PENDING,
    ApplyQueueItem,
    ApplyTask,
    ApplyTaskItem,
    JobMatchAnalysis,
)
from app.models.job import JOB_STATUS_OPEN, Job
from app.schemas.apply import ApplyTaskCreate
from app.services.apply import _tasks, task_runner
from test_apply_task_detail_queries import _count_statements

# ``_resolve_targets`` 的固定开销：岗位批量 + 队列条目批量。
FIXED_TARGET_SELECTS = 2

TARGET_SIZES = (1, 50)


class _FakeRunner:
    """只记录 ``start``：本文件关心的是"整批失败时运行器不许被启动"。"""

    def __init__(self) -> None:
        self.running = False
        self.started: int | None = None

    def is_running(self) -> bool:
        return self.running

    def start(self, task_id: int) -> None:
        self.started = task_id


@pytest.fixture
def fake_runner(monkeypatch) -> _FakeRunner:
    """替换进程级运行器。

    **必须在本文件内定义**：``fake_runner`` 在别的模块里是模块级 fixture，不经过 conftest，
    跨文件引用会直接报 ``fixture not found``（本文件第一版就是这样绿的假象）。
    """
    fake = _FakeRunner()
    monkeypatch.setattr(task_runner, "get_task_runner", lambda: fake)
    return fake


def _selects(statements: list[str]) -> list[str]:
    return [sql for sql in statements if sql.lstrip().upper().startswith("SELECT")]


@contextmanager
def _fresh_session() -> Iterator[object]:
    """独立会话调被测函数（真实请求也是每请求一个会话，且避免 identity-map 让取数不发 SQL）。"""
    from app.database import SessionLocal

    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def _job(db_session, **overrides) -> Job:
    data = {
        "title": "后端开发",
        "company": "A公司",
        "source": "BOSS直聘",
        "source_url": "https://www.zhipin.com/job/1",
        "status": JOB_STATUS_OPEN,
    }
    data.update(overrides)
    job = Job(**data)
    db_session.add(job)
    db_session.commit()
    return job


def _blocked_match(db_session, job: Job) -> None:
    """给岗位落一条"真实缺口"的准入结论（直接写库，跳过模型调用）。"""
    db_session.add(
        JobMatchAnalysis(
            job_id=job.id,
            job_title=job.title,
            company=job.company,
            result={"admission": ADMISSION_BLOCK, "hard_conditions": []},
            hard_gate="unmet",
            requires_confirm=False,
        )
    )
    db_session.commit()


# ===== 1. 报错顺序 =====


def test_first_missing_id_is_reported_by_input_order(client, db_session, fake_runner):
    """缺失 id 按**输入顺序**报，而不是按 id 大小。"""
    job = _job(db_session)

    for job_ids, expected in (
        ([job.id, 999_901, 999_902], 999_901),
        ([999_902, job.id, 999_901], 999_902),
    ):
        response = client.post("/api/apply/tasks", json={"job_ids": job_ids})
        assert response.status_code == 404, job_ids
        assert response.json()["detail"] == f"岗位不存在或已被删除：{expected}", job_ids


def test_conflict_before_a_later_missing_id(client, db_session, fake_runner):
    """更靠前的岗位的准入冲突要先报出来，不被后面那个缺失 id 抢走。"""
    blocked = _job(db_session, title="有缺口的岗位", source_url="https://www.zhipin.com/job/gap")
    _blocked_match(db_session, blocked)

    response = client.post("/api/apply/tasks", json={"job_ids": [blocked.id, 999_903]})

    assert response.status_code == 409
    assert response.json()["detail"]["job_id"] == blocked.id
    assert "真实缺口" in response.json()["detail"]["message"]


def test_missing_id_before_a_conflict_is_reported_first(client, db_session, fake_runner):
    """反过来：缺失 id 在前就先报 404（顺序对调，结果必须对调）。"""
    blocked = _job(db_session, title="有缺口的岗位", source_url="https://www.zhipin.com/job/gap2")
    _blocked_match(db_session, blocked)

    response = client.post("/api/apply/tasks", json={"job_ids": [999_904, blocked.id]})

    assert response.status_code == 404
    assert response.json()["detail"] == "岗位不存在或已被删除：999904"


# ===== 2. 整批原子性 =====


def test_failed_resolution_writes_nothing_and_does_not_start_the_runner(
    client, db_session, fake_runner
):
    """一个坏 id 让整批不落库：没有批次、没有条目，运行器也没被启动。"""
    good = _job(db_session)
    good_second = _job(db_session, title="另一个岗位", source_url="https://www.zhipin.com/job/2")

    response = client.post("/api/apply/tasks", json={"job_ids": [good.id, good_second.id, 999_905]})

    assert response.status_code == 404
    assert db_session.query(ApplyTask).count() == 0
    assert db_session.query(ApplyTaskItem).count() == 0
    assert fake_runner.started is None


def test_successful_task_keeps_input_order_and_dedupes(client, db_session, fake_runner):
    """成功路径：条目顺序 = 输入顺序，重复勾选只投一次（位置取第一次出现处）。"""
    first = _job(db_session, title="第一个", source_url="https://www.zhipin.com/job/a")
    second = _job(db_session, title="第二个", source_url="https://www.zhipin.com/job/b")
    third = _job(db_session, title="第三个", source_url="https://www.zhipin.com/job/c")

    response = client.post(
        "/api/apply/tasks",
        json={"job_ids": [second.id, first.id, second.id, third.id]},
    )

    assert response.status_code == 200
    task_id = response.json()["id"]
    assert response.json()["total"] == 3
    rows = (
        db_session.query(ApplyTaskItem)
        .filter(ApplyTaskItem.task_id == task_id)
        .order_by(ApplyTaskItem.sort_order)
        .all()
    )
    assert [row.job_id for row in rows] == [second.id, first.id, third.id]
    assert fake_runner.started == task_id


def test_use_queue_path_still_skips_targets_with_deleted_jobs(client, db_session, fake_runner):
    """``use_queue=true``：岗位已删除的队列条目仍被跳过（批量取岗位后语义不变）。

    "岗位已删除"的库内形态就是队列条目的 ``job_id`` 被置空（FK ``ondelete=SET NULL``），
    这里直接构造那个形态，避免依赖 SQLite 是否开启了外键级联。
    """
    alive = _job(db_session)
    orphan = ApplyQueueItem(job_title="已删除的岗位", sort_order=2, status=QUEUE_STATUS_PENDING)
    db_session.add_all(
        [
            ApplyQueueItem(
                job_id=alive.id,
                job_title=alive.title,
                sort_order=1,
                status=QUEUE_STATUS_PENDING,
            ),
            orphan,
        ]
    )
    db_session.commit()

    response = client.post("/api/apply/tasks", json={"use_queue": True})

    assert response.status_code == 200
    assert response.json()["total"] == 1


# ===== 3. 查询预算：固定 2 条 + 逐项的 latest_match =====


@pytest.mark.parametrize("count", TARGET_SIZES)
def test_resolve_targets_select_count(db_session, count):
    """``_resolve_targets`` = 固定 2 条 + 每个目标 1 条 ``latest_match``（保留逐项）。

    修复前是 ``3 * count``（逐项 ``db.get`` + 逐项队列查询 + 逐项 ``latest_match``）。
    """
    jobs = [
        _job(db_session, title=f"岗位{i}", source_url=f"https://www.zhipin.com/job/{i}")
        for i in range(count)
    ]
    payload = ApplyTaskCreate(job_ids=[job.id for job in jobs])

    with _fresh_session() as session, _count_statements() as statements:
        targets = _tasks._resolve_targets(session, payload)

    selects = _selects(statements)
    assert len(targets) == count
    assert len(selects) == FIXED_TARGET_SELECTS + count, (
        f"{count} 个目标解析用了 {len(selects)} 条 SELECT"
        f"（预期 {FIXED_TARGET_SELECTS} 固定 + {count} 条逐项 latest_match）：\n"
        + "\n".join(selects)
    )


def test_resolve_targets_does_not_query_per_item_for_lookups(db_session):
    """岗位/队列条目的读取条数与目标数**无关**：多 10 个目标也只多 10 条 latest_match。

    与上一条互补：上一条钉总数，这一条钉"固定部分不会偷偷随 N 增长"。
    """
    small = [_job(db_session, source_url=f"https://www.zhipin.com/job/s{i}") for i in range(2)]
    large = [_job(db_session, source_url=f"https://www.zhipin.com/job/l{i}") for i in range(20)]

    def _fixed_cost(jobs: list[Job]) -> int:
        payload = ApplyTaskCreate(job_ids=[job.id for job in jobs])
        with _fresh_session() as session, _count_statements() as statements:
            _tasks._resolve_targets(session, payload)
        return len(_selects(statements)) - len(jobs)

    assert _fixed_cost(small) == FIXED_TARGET_SELECTS
    assert _fixed_cost(large) == FIXED_TARGET_SELECTS


# ===== 4. 批量版的等价性（结构性判据）=====


def _unique_column_sets(table) -> set[tuple[str, ...]]:  # noqa: ANN001
    """表上所有"唯一"约束的列组合（列级 ``unique=True``、表级 UNIQUE、唯一索引都算）。"""
    from sqlalchemy import UniqueConstraint

    sets = {
        tuple(column.name for column in constraint.columns)
        for constraint in table.constraints
        if isinstance(constraint, UniqueConstraint)
    }
    sets |= {
        tuple(column.name for column in index.columns) for index in table.indexes if index.unique
    }
    return sets


def test_job_match_analysis_job_id_is_unique_in_the_model() -> None:
    """``_queue._matches_by_job_id`` 能安全批量的**唯一依据**：job_id 上有唯一约束。

    ``_match.latest_match`` 是 ``filter(job_id == X).one_or_none()``——没有 ``order_by``，
    所以"批量 ``in_`` + 字典"与逐条读到的必然是同一行，不存在"最近一次"的窗口语义。

    **断言写在表元数据上，不连库**：上一版 ``inspect(engine)`` 在 ``-n 4`` 全量里拿到过
    空列表（那个 worker 当时的 engine 指向另一份 schema），单独跑却绿——"看运行顺序才
    成立"的证据不能当守卫。迁移与模型是否一致由
    ``test_baseline_schema::test_head_schema_matches_the_model_registry`` 负责，这里只钉
    "模型声明了这一条"。
    """
    sets = _unique_column_sets(JobMatchAnalysis.__table__)
    assert ("job_id",) in sets, (
        "job_match_analysis.job_id 上没有唯一约束——_queue._matches_by_job_id 的批量读"
        f"将不再等价于 latest_match，必须改回逐条。实际唯一约束：{sets}"
    )


def test_queue_item_job_id_is_unique_in_the_model() -> None:
    """``_queue_items_by_job_id`` 的多行保护针对的是一条**不可达**路径（约束仍在）。"""
    sets = _unique_column_sets(ApplyQueueItem.__table__)
    assert ("job_id",) in sets, f"apply_queue_item.job_id 上没有唯一约束：{sets}"
