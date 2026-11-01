# SPDX-License-Identifier: Apache-2.0
"""投递记录失败子码 / 分类筛选 / 「只重试这 N 条」（#39）守卫测试。

钉住四件事：

1. 失败分类筛选在**组头**与**明细**上语义同源——组头显示「1 条记录」时，展开的明细也必须
   只剩 1 条（旧版漏把 failure_category 传给明细端点，组头 1 条、明细仍 6 条）；
2. 失败三段稳定码由分类 + 诊断文本收敛而来：同一个 selector_invalid 大类下，
   「页面改版」「加载超时」「没跳到目标地址」分属三个不同子码（界面的建议因此能不同）；
3. HTTP 出参带 failure_step / failure_target / failure_reason，且组头带 retryable_count；
4. POST /records/retry-batch 只挑命中筛选的失败记录，一条都没有时 404，不建空批次。
"""

import pytest
from app.models.apply import (
    FAILURE_CAPTCHA_REQUIRED,
    FAILURE_LOGIN_REQUIRED,
    FAILURE_SELECTOR_INVALID,
    ITEM_STATUS_FAILED,
    ITEM_STATUS_SUCCESS,
    STEP_GREETING,
    TASK_KIND_APPLY,
    TASK_STATUS_COMPLETED,
    TASK_STATUS_PENDING,
    ApplyTask,
    ApplyTaskItem,
)
from app.models.job import Job
from app.services.apply.failure_taxonomy import (
    REASON_CAPTCHA_REQUIRED,
    REASON_LOGIN_REQUIRED,
    REASON_PAGE_NOT_NAVIGATED,
    REASON_RENDER_TIMEOUT,
    REASON_SELECTOR_MISSING,
    REASON_SITE_CHANGED,
    REASON_UNKNOWN,
    TARGET_CHAT_INPUT,
    TARGET_JOB_CARD,
    classify_failure,
)
from app.services.apply.task_apply import mark_failed

# ===== 分类 + 诊断 → 三段稳定码 =====


@pytest.mark.parametrize(
    ("detail", "reason", "step", "target"),
    [
        (
            "第 1 步「打开投递入口」的岗位卡片未渲染出来（页面加载超时 20s）",
            REASON_RENDER_TIMEOUT,
            "opening",
            TARGET_JOB_CARD,
        ),
        (
            "第 2 步「打招呼」的聊天输入框未找到（页面改版，选择器命中 0 个）",
            REASON_SITE_CHANGED,
            STEP_GREETING,
            TARGET_CHAT_INPUT,
        ),
        (
            "页面没有切换到目标地址，仍在岗位列表页",
            REASON_PAGE_NOT_NAVIGATED,
            "opening",
            None,
        ),
        ("某个控件找不到了", REASON_SELECTOR_MISSING, "unknown", None),
    ],
)
def test_selector_failures_are_split_into_stable_subcodes(detail, reason, step, target):
    """同一个 selector_invalid 大类，必须能分出三种完全不同的处理方式。"""
    codes = classify_failure(FAILURE_SELECTOR_INVALID, detail)
    assert codes.reason == reason
    assert codes.step == step
    if target is not None:
        assert codes.target == target


def test_non_selector_categories_map_to_their_own_reason():
    assert classify_failure(FAILURE_LOGIN_REQUIRED, "需要先登录").reason == REASON_LOGIN_REQUIRED
    assert (
        classify_failure(FAILURE_CAPTCHA_REQUIRED, "弹出滑块验证码").reason
        == REASON_CAPTCHA_REQUIRED
    )
    assert classify_failure("", "").reason == REASON_UNKNOWN


def test_explicit_codes_win_over_text_inference():
    """调用方知道得比诊断文本多（例如适配器标了阶段），显式码要优先。"""
    codes = classify_failure(
        FAILURE_SELECTOR_INVALID, "某个控件找不到了", step=STEP_GREETING, target="send_button"
    )
    assert codes.step == STEP_GREETING
    assert codes.target == "send_button"


def test_mark_failed_writes_the_three_columns(db_session):
    task = ApplyTask(kind=TASK_KIND_APPLY, status=TASK_STATUS_COMPLETED, total=1)
    db_session.add(task)
    db_session.flush()
    item = ApplyTaskItem(task_id=task.id, job_title="岗位", company="公司")
    db_session.add(item)
    db_session.commit()

    mark_failed(
        db_session,
        task,
        item,
        FAILURE_SELECTOR_INVALID,
        "第 2 步「打招呼」的聊天输入框未找到（页面改版，选择器命中 0 个）",
    )
    db_session.refresh(item)
    assert item.failure_step == STEP_GREETING
    assert item.failure_target == TARGET_CHAT_INPUT
    assert item.failure_reason == REASON_SITE_CHANGED


# ===== HTTP：字段 / 筛选同源 / 重试批次 =====


@pytest.fixture
def failed_batch(db_session):
    """一个批次：成功 1 条 + 失败 3 条（登录 1、验证码 1、选择器失效 1），岗位都还在。"""
    task = ApplyTask(
        kind=TASK_KIND_APPLY,
        status=TASK_STATUS_COMPLETED,
        total=4,
        processed=4,
        succeeded=1,
        failed=3,
    )
    db_session.add(task)
    jobs = [Job(title=f"岗位{index}", company="示例公司") for index in range(4)]
    db_session.add_all(jobs)
    db_session.flush()
    rows = [
        (ITEM_STATUS_SUCCESS, "", "", "", "", ""),
        (ITEM_STATUS_FAILED, FAILURE_LOGIN_REQUIRED, "login_required", "opening", "", "需要登录"),
        (
            ITEM_STATUS_FAILED,
            FAILURE_CAPTCHA_REQUIRED,
            "captcha_required",
            "submitting",
            "",
            "需要验证码",
        ),
        (
            ITEM_STATUS_FAILED,
            FAILURE_SELECTOR_INVALID,
            "site_changed",
            "greeting",
            "chat_input",
            "第 2 步「打招呼」的聊天输入框未找到（页面改版）",
        ),
    ]
    for index, (status, category, reason, step, target, detail) in enumerate(rows):
        db_session.add(
            ApplyTaskItem(
                task_id=task.id,
                job_id=jobs[index].id,
                job_title=jobs[index].title,
                company=jobs[index].company,
                status=status,
                failure_category=category,
                failure_reason=reason,
                failure_step=step,
                failure_target=target,
                failure_detail=detail,
                sort_order=index,
            )
        )
    db_session.commit()
    return task


def test_record_out_carries_the_three_stable_codes(client, failed_batch):
    records = client.get("/api/apply/records", params={"result": "failed"}).json()["items"]
    assert sorted(item["failure_reason"] for item in records) == [
        "captcha_required",
        "login_required",
        "site_changed",
    ]
    assert all("failure_step" in item and "failure_target" in item for item in records)


def test_failure_category_filter_applies_to_group_and_items(client, failed_batch):
    """#39 的缺陷本体：组头按分类筛了，展开的明细也必须筛。"""
    grouped = client.get(
        "/api/apply/records/grouped",
        params={"include_items": "false", "failure_category": FAILURE_LOGIN_REQUIRED},
    )
    assert grouped.status_code == 200
    batch = grouped.json()["items"][0]
    assert batch["matched_count"] == 1
    assert batch["retryable_count"] == 1

    items = client.get(
        f"/api/apply/records/batches/{failed_batch.id}/items",
        params={"failure_category": FAILURE_LOGIN_REQUIRED},
    ).json()
    # 明细与组头对得上：只剩那一条登录失败。
    assert items["total"] == 1
    assert items["items"][0]["failure_category"] == FAILURE_LOGIN_REQUIRED


def test_grouped_retryable_count_excludes_success_and_follows_filters(client, failed_batch):
    batch = client.get("/api/apply/records/grouped").json()["items"][0]
    # 4 条里 3 条失败：成功那条不该被算进"可重投"。
    assert batch["retryable_count"] == 3
    assert batch["matched_count"] == 4

    only_captcha = client.get(
        "/api/apply/records/grouped",
        params={"failure_category": FAILURE_CAPTCHA_REQUIRED},
    ).json()["items"][0]
    assert only_captcha["retryable_count"] == 1


def test_retry_batch_rejects_an_unknown_failure_category(client, failed_batch):
    response = client.post(
        "/api/apply/records/retry-batch",
        json={"task_id": failed_batch.id, "failure_category": "不存在"},
    )
    assert response.status_code == 422


def test_retry_batch_404_when_no_failed_record_matches(client, failed_batch):
    response = client.post(
        "/api/apply/records/retry-batch",
        json={"task_id": failed_batch.id, "failure_category": "profile_insufficient"},
    )
    assert response.status_code == 404


def test_retry_batch_creates_one_task_for_the_matching_jobs(
    client, db_session, failed_batch, monkeypatch
):
    """只选命中筛选的失败记录，并把它们的岗位去重后交给一个批次。"""
    from app.services.apply import apply_service as service_module

    task = ApplyTask(kind=TASK_KIND_APPLY, status=TASK_STATUS_PENDING, total=2)
    db_session.add(task)
    db_session.commit()
    captured = {}

    def fake_create(_db, payload):
        captured["job_ids"] = payload.job_ids
        return task

    monkeypatch.setattr(service_module, "create_apply_task", fake_create)
    response = client.post(
        "/api/apply/records/retry-batch",
        json={"task_id": failed_batch.id, "failure_category": FAILURE_SELECTOR_INVALID},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["retried"] == 1
    # 选择器失效只有一条 → 只重投那一条的岗位。
    assert len(captured["job_ids"]) == 1
    assert body["task"]["kind"] == "apply"

    captured.clear()
    all_failed = client.post(
        "/api/apply/records/retry-batch", json={"task_id": failed_batch.id}
    ).json()
    assert all_failed["retried"] == 3
    assert len(captured["job_ids"]) == 3
