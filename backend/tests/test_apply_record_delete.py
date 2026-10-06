"""投递记录删除的语义守卫。

用户明确选定的一档语义：**删了就真没了**——删掉的记录不再出现在列表里，也**不再计入
「每日上限」与首页统计**。这条最容易在实现时漏掉：漏了不会报错，只会让数字悄悄变大，
而用户的行为与他的理解正好相反。

单条删与整批删都要（用户原话），且都进退回收站（可恢复、可彻底删除）。
"""
import pytest
from app.models.apply import (
    ITEM_STATUS_FAILED,
    ITEM_STATUS_SUCCESS,
    TASK_KIND_APPLY,
    TASK_STATUS_COMPLETED,
    ApplyTask,
    ApplyTaskItem,
)
from app.models.profile import utcnow
from app.services.apply import apply_service
from app.services.apply._records import daily_success_count


@pytest.fixture
def batch_with_success(db_session):
    """一个批次、两条成功记录——两条都计进每日上限。"""
    task = ApplyTask(
        kind=TASK_KIND_APPLY,
        status=TASK_STATUS_COMPLETED,
        total=2,
        processed=2,
        succeeded=2,
    )
    db_session.add(task)
    db_session.commit()
    for index in range(2):
        db_session.add(
            ApplyTaskItem(
                task_id=task.id,
                job_title=f"岗位{index}",
                company="某公司",
                status=ITEM_STATUS_SUCCESS,
                finished_at=utcnow(),
            )
        )
    db_session.commit()
    return task


def _records(db_session) -> list:
    items, _total = apply_service.list_records(db_session, page=1, page_size=50)
    return items


def test_deleting_one_record_removes_it_from_the_list(db_session, batch_with_success):
    before = _records(db_session)
    assert len(before) == 2

    assert apply_service.delete_record(db_session, before[0].id) is True

    after = _records(db_session)
    assert len(after) == 1
    assert before[0].id not in {item.id for item in after}


def test_deleting_a_record_also_drops_it_from_the_daily_limit(db_session, batch_with_success):
    """**这条是本次改动最容易漏的一处。**

    每日上限是"你还能投几个"的依据。用户删掉一条成功记录就是要它不算数；
    不过滤的话上限会**悄悄放宽**，数字看起来正常，行为却与用户的理解相反。
    """
    assert daily_success_count(db_session) == 2

    apply_service.delete_record(db_session, _records(db_session)[0].id)

    assert daily_success_count(db_session) == 1


def test_deleting_a_whole_batch_clears_every_record_in_it(db_session, batch_with_success):
    assert apply_service.delete_record_batch(db_session, batch_with_success.id) is True

    assert _records(db_session) == []
    assert daily_success_count(db_session) == 0


def test_deleting_a_batch_leaves_the_batch_row_itself(db_session, batch_with_success):
    """批次本身不删：它是列表的分组键，删掉整组会消失、统计也会跳变。

    批次因此可能暂时成为"空组"，由界面收起（``list_record_batches`` 只返回有命中记录的批次）。
    """
    apply_service.delete_record_batch(db_session, batch_with_success.id)

    assert db_session.get(ApplyTask, batch_with_success.id) is not None


def test_a_deleted_record_cannot_be_retried(client, db_session, batch_with_success):
    """已删的记录**不该还能重投**——否则等于给了一条"知道 id 就能复活已删记录"的后门。"""
    record_id = _records(db_session)[0].id
    apply_service.delete_record(db_session, record_id)

    response = client.post(f"/api/apply/records/{record_id}/retry")

    assert response.status_code == 404


def test_deleting_a_missing_record_reports_not_found(client, db_session):
    assert client.delete("/api/apply/records/999999").status_code == 404
    assert client.delete("/api/apply/records/batches/999999").status_code == 404


def test_a_deleted_record_lands_in_the_trash(client, db_session, batch_with_success):
    """删除是**软删**：进回收站、能恢复，而不是直接抹掉。"""
    record_id = _records(db_session)[0].id
    assert client.delete(f"/api/apply/records/{record_id}").status_code == 204

    trashed = client.get("/api/trash").json()
    keys = {entry["type"] for entry in trashed.get("items", trashed if isinstance(trashed, list) else [])}
    assert "apply_record" in keys


def test_filtering_by_result_does_not_resurrect_deleted_records(db_session, batch_with_success):
    """按结果筛选是另一条查询路径，同样要过滤掉已删的。"""
    apply_service.delete_record(db_session, _records(db_session)[0].id)

    items, total = apply_service.list_records(db_session, result=ITEM_STATUS_SUCCESS, page=1, page_size=50)

    assert total == 1, "已删的记录不该从筛选这条路回来"


def test_batch_grouping_does_not_show_deleted_records(db_session, batch_with_success):
    """按批次分组的查询（界面实际用的那条）同样要过滤。"""
    apply_service.delete_record(db_session, _records(db_session)[0].id)

    batches, total = apply_service.list_record_batches(db_session, page=1, page_size=10)

    assert [item.id for batch in batches for item in batch.items] == [
        item.id for item in _records(db_session)
    ]
    assert total == 1


def test_deleting_only_failed_records_keeps_the_successful_ones(db_session):
    """混在同一个批次里时，单条删不该波及别人。"""
    task = ApplyTask(kind=TASK_KIND_APPLY, status=TASK_STATUS_COMPLETED, total=2, processed=2)
    db_session.add(task)
    db_session.commit()
    ok = ApplyTaskItem(
        task_id=task.id, job_title="成的", status=ITEM_STATUS_SUCCESS, finished_at=utcnow()
    )
    bad = ApplyTaskItem(
        task_id=task.id, job_title="败的", status=ITEM_STATUS_FAILED, finished_at=utcnow()
    )
    db_session.add_all([ok, bad])
    db_session.commit()

    apply_service.delete_record(db_session, bad.id)

    remaining = _records(db_session)
    assert [item.id for item in remaining] == [ok.id]
    assert daily_success_count(db_session) == 1
