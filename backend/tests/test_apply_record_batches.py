# SPDX-License-Identifier: Apache-2.0
"""投递记录按批次分组的守卫测试。

用户一次性投了好几个岗位时，这几条记录同属一个批次（一次「开始投递」= 一个
``ApplyTask``）。分组展示的语义：

- 分组键是**批次**，分页也按批次计（一页 N 个组）；
- 筛选（关键词 / 结果）作用在**记录**上：组内只出现命中的记录，没有命中记录的
  批次整体不出现；
- 批次头上的统计（成功/失败/跳过）是**批次自己的账**，不因筛选而变。
"""
import pytest
from app.models.apply import (
    FAILURE_CAPTCHA_REQUIRED,
    FAILURE_CATEGORY_LABELS,
    FAILURE_SELECTOR_INVALID,
    ITEM_STATUS_FAILED,
    ITEM_STATUS_SKIPPED,
    ITEM_STATUS_SUCCESS,
    TASK_KIND_APPLY,
    TASK_STATUS_COMPLETED,
    ApplyTask,
    ApplyTaskItem,
)
from app.services.apply import apply_service


@pytest.fixture
def batch_with_items(db_session):
    """两个批次：第一个 3 条（成/败/跳），第二个 1 条（成）。"""
    task_a = ApplyTask(
        kind=TASK_KIND_APPLY,
        status=TASK_STATUS_COMPLETED,
        total=3,
        processed=3,
        succeeded=1,
        failed=1,
        skipped=1,
        message="投递任务已完成",
    )
    task_b = ApplyTask(
        kind=TASK_KIND_APPLY,
        status=TASK_STATUS_COMPLETED,
        total=1,
        processed=1,
        succeeded=1,
    )
    db_session.add_all([task_a, task_b])
    db_session.flush()

    def item(task, sort_order, status, title, company):
        row = ApplyTaskItem(
            task_id=task.id,
            job_id=None,
            job_title=title,
            company=company,
            status=status,
            sort_order=sort_order,
        )
        db_session.add(row)
        return row

    item(task_a, 0, ITEM_STATUS_SUCCESS, "后端开发", "A公司")
    item(task_a, 1, ITEM_STATUS_FAILED, "全栈工程师", "B公司")
    item(task_a, 2, ITEM_STATUS_SKIPPED, "测试工程师", "C公司")
    item(task_b, 0, ITEM_STATUS_SUCCESS, "后端开发", "D公司")
    db_session.commit()
    return task_a, task_b


def test_batches_group_all_items_and_paginate_by_batch(db_session, batch_with_items):
    task_a, task_b = batch_with_items
    batches, total = apply_service.list_record_batches(db_session)
    assert total == 2
    assert [batch.id for batch in batches] == [task_b.id, task_a.id]  # 新批次在前
    first = batches[0]
    assert first.total == 1 and first.succeeded == 1
    assert [record.job_title for record in first.items] == ["后端开发"]
    second = batches[1]
    assert second.succeeded == 1 and second.failed == 1 and second.skipped == 1
    assert [record.status for record in second.items] == ["success", "failed", "skipped"]


def test_batch_page_size_limits_groups_not_records(db_session, batch_with_items):
    task_a, task_b = batch_with_items
    batches, total = apply_service.list_record_batches(db_session, page=1, page_size=1)
    assert total == 2
    assert len(batches) == 1
    assert batches[0].id == task_b.id
    # 第二页是剩下的那个批次，且它带全自己的 3 条记录。
    batches, total = apply_service.list_record_batches(db_session, page=2, page_size=1)
    assert total == 2
    assert [batch.id for batch in batches] == [task_a.id]
    assert len(batches[0].items) == 3


def test_result_filter_hides_records_and_empty_batches(db_session, batch_with_items):
    task_a, task_b = batch_with_items
    batches, total = apply_service.list_record_batches(db_session, result="failed")
    assert total == 1
    assert [batch.id for batch in batches] == [task_a.id]
    assert [record.job_title for record in batches[0].items] == ["全栈工程师"]
    # 批次统计不受筛选影响——它是这次投递自己的账。
    assert batches[0].failed == 1 and batches[0].succeeded == 1 and batches[0].skipped == 1


def test_keyword_filter_matches_title_or_company(db_session, batch_with_items):
    task_a, _ = batch_with_items
    batches, total = apply_service.list_record_batches(db_session, keyword="C公司")
    assert total == 1 and batches[0].id == task_a.id
    assert [record.company for record in batches[0].items] == ["C公司"]


def test_grouped_batches_summarise_failed_items_by_category(db_session, client):
    """#39 回归：批次里**真有**带分类的失败明细时，组头聚合必须是 `[{category,label,count}]`。

    这条正是"导出别名指错模型"能溜过既有用例的那个缺口：既有夹具里的失败条目
    ``failure_category`` 都是空串，聚合查询被 ``!= ""`` 滤掉，于是 ``failure_summary``
    恒为空列表——"用错模型"和"用对模型"在断言上完全等价，怎么跑都绿。
    只有造出「恰好有 failed 且带 failure_category 的明细」，才能把这条链路真正压到。

    同分类要真的累加（同因聚合的意义），无分类的失败条目不计入聚合（没有可展示的因）。
    """
    task = ApplyTask(
        kind=TASK_KIND_APPLY,
        status=TASK_STATUS_COMPLETED,
        total=4,
        processed=4,
        succeeded=1,
        failed=3,
    )
    db_session.add(task)
    db_session.flush()

    def failed(title: str, category: str) -> None:
        db_session.add(
            ApplyTaskItem(
                task_id=task.id,
                job_id=None,
                job_title=title,
                company="审计公司",
                status=ITEM_STATUS_FAILED,
                failure_category=category,
            )
        )

    failed("后端开发", FAILURE_SELECTOR_INVALID)
    failed("全栈工程师", FAILURE_SELECTOR_INVALID)
    failed("测试工程师", FAILURE_CAPTCHA_REQUIRED)
    # 失败但没有分类：能进「失败数」，但没有可聚合的因，不该出现在 failure_summary 里。
    failed("数据工程师", "")
    db_session.add(
        ApplyTaskItem(
            task_id=task.id,
            job_id=None,
            job_title="前端开发",
            company="审计公司",
            status=ITEM_STATUS_SUCCESS,
        )
    )
    db_session.commit()

    response = client.get("/api/apply/records/grouped")
    assert response.status_code == 200
    batch = next(item for item in response.json()["items"] if item["id"] == task.id)
    assert batch["failed"] == 3
    # 形状与取值都是契约：前端组头按 `category` 做筛选键、`label` 直接上屏、`count` 显示条数。
    # 顺序不比：聚合成 SQL GROUP BY 的产物，顺序没有承诺（按分类键取值比较）。
    summary = {entry["category"]: entry for entry in batch["failure_summary"]}
    assert summary == {
        FAILURE_SELECTOR_INVALID: {
            "category": FAILURE_SELECTOR_INVALID,
            "label": FAILURE_CATEGORY_LABELS[FAILURE_SELECTOR_INVALID],
            "count": 2,
        },
        FAILURE_CAPTCHA_REQUIRED: {
            "category": FAILURE_CAPTCHA_REQUIRED,
            "label": FAILURE_CATEGORY_LABELS[FAILURE_CAPTCHA_REQUIRED],
            "count": 1,
        },
    }
    # 标签必须是给人看的中文说明，不是枚举值本身（后端已翻好）。
    assert all(
        entry["label"] != entry["category"] for entry in batch["failure_summary"]
    )
