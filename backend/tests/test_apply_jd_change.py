# SPDX-License-Identifier: Apache-2.0
"""15B JD 变更监控（被动式）：指纹比对、before→after、以及三个出口上的 ``jd_changed``。

设计前提（写在这里，因为它是本功能最容易被误解的地方）：**不主动重抓**。数据只来自 15A
的采集历史（``job_seen``），用户不去采集就看不到变更——UI 必须标明「下次采集时更新」。
因此本文件还钉住三条"不许说话"的出口：

- 没有历史 / 只有一条带指纹的采样 → ``changed=false``，before/after 都是空串
  （拿空值渲染成"从空变成了一段话"就是编造）；
- **没有正文的那次采样不参与比对**（详情抓取失败是采集抖动，不是企业改了 JD）；
- 队列条目不存在 → 404，而不是一份"没有变更"的空结论。

端点：``GET /api/apply/queue/{queue_id}/jd-change`` → ``{changed, before, after, seen_at}``。
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timedelta

from app.models.apply import (
    ITEM_STATUS_SUCCESS,
    QUEUE_STATUS_PENDING,
    TASK_KIND_APPLY,
    ApplyQueueItem,
    ApplyTask,
    ApplyTaskItem,
)
from app.models.job import JOB_STATUS_OPEN, Job
from app.models.job_seen import JobSeen
from app.services.apply._queue import list_queue
from app.services.apply._records import list_batch_items, list_record_batches, list_records
from app.services.apply.lifecycle import jd_change_of, seens_for_job

NOW = datetime(2026, 11, 11, 12, 0, 0)
BEFORE_JD = "负责订单系统的后端开发，要求熟悉 Python。"
AFTER_JD = "负责订单系统与结算平台的后端开发，要求熟悉 Python 与 Go。"


def _digest(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


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


def _seen(db_session, job: Job | None, *, days_ago: int, description: str = "") -> JobSeen:
    """一条采样；``description`` 为空即"那次没拿到正文"（``description_hash`` 留空）。"""
    text = description.strip()
    row = JobSeen(
        job_id=job.id if job is not None else None,
        title="后端开发",
        company="A公司",
        source_url="https://www.zhipin.com/job/1",
        seen_at=NOW - timedelta(days=days_ago),
        description_hash=_digest(text) if text else "",
        description_text=text[:2000],
    )
    db_session.add(row)
    db_session.commit()
    return row


def _queue_item(db_session, job: Job | None) -> ApplyQueueItem:
    item = ApplyQueueItem(
        job_id=job.id if job is not None else None,
        job_title="后端开发",
        company="A公司",
        greeting="您好，我有三年 Python 后端经验，想聊聊这个岗位。",
        sort_order=1,
        status=QUEUE_STATUS_PENDING,
    )
    db_session.add(item)
    db_session.commit()
    return item


def _changed(db_session, job: Job | None) -> dict:
    return jd_change_of(seens_for_job(db_session, job.id if job is not None else None))


# ===== 纯函数：指纹比对 =====


def test_changed_jd_reports_before_and_after(db_session):
    """两次指纹不同 → ``changed=true``，before/after 是那两次的正文，seen_at 是后一次。"""
    job = _job(db_session)
    _seen(db_session, job, days_ago=10, description=BEFORE_JD)
    _seen(db_session, job, days_ago=1, description=AFTER_JD)

    change = _changed(db_session, job)

    assert change["changed"] is True
    assert change["before"] == BEFORE_JD
    assert change["after"] == AFTER_JD
    assert change["seen_at"] == NOW - timedelta(days=1)


def test_unchanged_jd_reports_no_change(db_session):
    """同一份 JD 采两次 → ``changed=false``（before/after 相同，界面不显示徽标）。"""
    job = _job(db_session)
    _seen(db_session, job, days_ago=10, description=BEFORE_JD)
    _seen(db_session, job, days_ago=1, description=BEFORE_JD)

    change = _changed(db_session, job)

    assert change["changed"] is False
    assert change["before"] == change["after"] == BEFORE_JD


def test_no_history_reports_no_change_with_empty_texts(db_session):
    """没有采样 → ``changed=false`` 且 before/after 为空串（不许编造两段正文）。"""
    job = _job(db_session)

    change = _changed(db_session, job)

    assert change == {"changed": False, "before": "", "after": "", "seen_at": None}


def test_single_fingerprint_is_not_comparable(db_session):
    """只有一条带指纹的采样 → 无可比对，``changed=false``。"""
    job = _job(db_session)
    _seen(db_session, job, days_ago=5, description=BEFORE_JD)

    assert _changed(db_session, job)["changed"] is False


def test_sighting_without_description_does_not_count_as_a_change(db_session):
    """中间那次没抓到正文 → 跳过它，比较两侧有指纹的采样（否则抖动会被报成变更）。"""
    job = _job(db_session)
    _seen(db_session, job, days_ago=10, description=BEFORE_JD)
    _seen(db_session, job, days_ago=5, description="")  # 详情抓取失败的那一轮
    _seen(db_session, job, days_ago=1, description=BEFORE_JD)

    change = _changed(db_session, job)

    assert change["changed"] is False
    assert change["after"] == BEFORE_JD


def test_change_is_detected_across_a_gap_of_blank_sightings(db_session):
    """抖动之后真的改了 → 仍然要报（跳过空指纹不等于放弃比对）。"""
    job = _job(db_session)
    _seen(db_session, job, days_ago=20, description=BEFORE_JD)
    _seen(db_session, job, days_ago=10, description="")
    _seen(db_session, job, days_ago=1, description=AFTER_JD)

    assert _changed(db_session, job)["changed"] is True


# ===== 端点：形状与 404 =====


def test_endpoint_returns_the_agreed_shape(client, db_session):
    """``GET /queue/{id}/jd-change`` 的字段名与取值（前端按这些名字渲染）。"""
    job = _job(db_session)
    _seen(db_session, job, days_ago=10, description=BEFORE_JD)
    _seen(db_session, job, days_ago=1, description=AFTER_JD)
    item = _queue_item(db_session, job)

    response = client.get(f"/api/apply/queue/{item.id}/jd-change")

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"changed", "before", "after", "seen_at"}
    assert body["changed"] is True
    assert body["before"] == BEFORE_JD
    assert body["after"] == AFTER_JD
    assert body["seen_at"] == (NOW - timedelta(days=1)).isoformat(timespec="seconds")


def test_endpoint_without_history_is_false_and_null_seen_at(client, db_session):
    """无历史：``changed=false``、两段空串、``seen_at=null``。"""
    job = _job(db_session)
    item = _queue_item(db_session, job)

    body = client.get(f"/api/apply/queue/{item.id}/jd-change").json()

    assert body == {"changed": False, "before": "", "after": "", "seen_at": None}


def test_endpoint_404_for_missing_queue_item(client):
    """队列条目不存在 → 404，而不是一份"没有变更"的空结论（那是另一件事）。"""
    response = client.get("/api/apply/queue/999999/jd-change")

    assert response.status_code == 404


def test_endpoint_is_read_only(client, db_session):
    """连调两次，采样行数不变（与 15C/15D/15E 同一条只读纪律）。"""
    job = _job(db_session)
    _seen(db_session, job, days_ago=10, description=BEFORE_JD)
    _seen(db_session, job, days_ago=1, description=AFTER_JD)
    item = _queue_item(db_session, job)

    client.get(f"/api/apply/queue/{item.id}/jd-change")
    client.get(f"/api/apply/queue/{item.id}/jd-change")

    assert db_session.query(JobSeen).count() == 2


# ===== 列表出口：队列行与记录行上的 jd_changed =====


def test_queue_item_carries_jd_changed(client, db_session):
    """队列列表行带 ``jd_changed``（15B 的徽标来源）。"""
    job = _job(db_session)
    _seen(db_session, job, days_ago=10, description=BEFORE_JD)
    _seen(db_session, job, days_ago=1, description=AFTER_JD)
    _queue_item(db_session, job)

    (row,) = list_queue(db_session)

    assert row.jd_changed is True


def test_queue_item_without_change_is_false(db_session):
    """没改过 → ``false``（徽标不出现）。"""
    job = _job(db_session)
    _seen(db_session, job, days_ago=10, description=BEFORE_JD)
    _seen(db_session, job, days_ago=1, description=BEFORE_JD)
    _queue_item(db_session, job)

    (row,) = list_queue(db_session)

    assert row.jd_changed is False


def _record(db_session, job: Job | None) -> ApplyTaskItem:
    task = ApplyTask(kind=TASK_KIND_APPLY, status="completed", total=1, config={})
    db_session.add(task)
    db_session.commit()
    item = ApplyTaskItem(
        task_id=task.id,
        job_id=job.id if job is not None else None,
        job_title="后端开发",
        company="A公司",
        status=ITEM_STATUS_SUCCESS,
    )
    db_session.add(item)
    db_session.commit()
    return item


def test_record_row_carries_jd_changed(db_session):
    """投递记录行带 ``jd_changed``（"你投的岗位有 1 处变更"徽标）。"""
    job = _job(db_session)
    _seen(db_session, job, days_ago=10, description=BEFORE_JD)
    _seen(db_session, job, days_ago=1, description=AFTER_JD)
    _record(db_session, job)

    records, total = list_records(db_session)

    assert total == 1
    assert records[0].jd_changed is True


def test_record_without_history_is_false(db_session):
    """记录对应的岗位没有采样历史（手动录入的岗位）→ ``false``，不报错。"""
    job = _job(db_session)
    _record(db_session, job)

    records, _total = list_records(db_session)

    assert records[0].jd_changed is False


def test_record_with_missing_job_is_false(db_session):
    """记录对应的岗位已被删除（``job_id`` 置空）→ ``false``，不抛异常。"""
    _record(db_session, None)

    records, _total = list_records(db_session)

    assert records[0].jd_changed is False


# ===== #15-P1：记录行上的 queue_id（徽标点开抽屉的唯一入口）=====
#
# 徽标只是"改过了"这一句；before/after 的抽屉端点（``GET /queue/{id}/jd-change``）只认
# **队列条目 id**。记录表里没有这一列，所以出口必须按 job_id 反查出 queue_id ——
# 缺了它，徽标看得见、点不开（15B 的主功能静默失效）。


def test_record_carries_queue_id_of_its_queue_item(db_session):
    """记录关联的岗位在队列里 → ``queue_id`` 就是那条队列条目的 id（不是 job_id）。"""
    job = _job(db_session)
    _seen(db_session, job, days_ago=10, description=BEFORE_JD)
    _seen(db_session, job, days_ago=1, description=AFTER_JD)
    queue_item = _queue_item(db_session, job)
    _record(db_session, job)

    records, _total = list_records(db_session)

    assert records[0].queue_id == queue_item.id
    # 抽屉能打开的前提：徽标为真 + 有 id，两者必须同时成立。
    assert records[0].jd_changed is True


def test_record_without_queue_item_has_null_queue_id(db_session):
    """岗位已不在队列里（投完移出 / 用户删了条目）→ ``queue_id`` 为 null，不猜邻近条目。"""
    job = _job(db_session)
    _seen(db_session, job, days_ago=10, description=BEFORE_JD)
    _seen(db_session, job, days_ago=1, description=AFTER_JD)
    _record(db_session, job)

    records, _total = list_records(db_session)

    assert records[0].queue_id is None
    # "改过了"这件事仍然是真的：徽标照旧显示，只是点不开抽屉。
    assert records[0].jd_changed is True


def test_records_of_the_same_job_share_one_queue_id(db_session):
    """同一岗位的两条记录 → 同一个 ``queue_id``（反查是"按岗位"的，不是"按记录"的）。"""
    job = _job(db_session)
    _seen(db_session, job, days_ago=10, description=BEFORE_JD)
    _seen(db_session, job, days_ago=1, description=AFTER_JD)
    queue_item = _queue_item(db_session, job)
    _record(db_session, job)
    _record(db_session, job)

    records, total = list_records(db_session)

    assert total == 2
    assert [row.queue_id for row in records] == [queue_item.id, queue_item.id]


def test_batch_exports_carry_queue_id_on_both_paths(db_session):
    """批次出口的两条路径（整批带明细 / 展开后分页）都要带 ``queue_id``。

    这两条路径各自算过一次映射（``list_record_batches`` 与 ``list_batch_items``），
    只测其中一条会让另一条静默丢掉抽屉入口。
    """
    job = _job(db_session)
    _seen(db_session, job, days_ago=10, description=BEFORE_JD)
    _seen(db_session, job, days_ago=1, description=AFTER_JD)
    queue_item = _queue_item(db_session, job)
    record = _record(db_session, job)

    batches, _total = list_record_batches(db_session)
    (batch,) = batches
    (packed,) = batch.items

    page, _count = list_batch_items(db_session, record.task_id)

    assert packed.queue_id == queue_item.id
    assert page[0].queue_id == queue_item.id


def test_record_endpoint_exposes_queue_id_as_null_when_absent(client, db_session):
    """JSON 出口**一定带** ``queue_id`` 这个键（没有条目时是 null，不是缺字段）。

    前端按 ``record.queue_id ?? null`` 决定能不能点；字段整个不出现时前端读到的也是
    undefined，但契约上必须是显式 null——否则"后端没给"与"这个岗位不在队列里"就分不清了。
    """
    job = _job(db_session)
    _record(db_session, job)

    body = client.get("/api/apply/records").json()

    assert body["items"], "至少要有一条记录"
    assert "queue_id" in body["items"][0]
    assert body["items"][0]["queue_id"] is None
