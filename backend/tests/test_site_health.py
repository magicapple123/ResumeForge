"""站点健康度测试：纯判据（哪种失败算"改版"、哪种不算）、读库归因、以及 API 端点。

立场：把"采集悄悄抓不到东西"的静默失败变成**看得见、且不误报**的 degraded 标记。最容易错的
两件事——把环境/用户侧问题（需登录、验证码、超时、真没搜到）误算成"站点改版"，以及在样本
不足时报警——都在这里逐条钉住。

（拆分说明：读库归因与 API 端点在 test_site_health_records.py；site_key/failure category
记录层、detail missing 台账与浏览器错误归因在 test_site_health_detail.py。``_summary``
留在本文件。）
"""
from __future__ import annotations

import pytest
from app.models.apply import (
    FAILURE_CAPTCHA_REQUIRED,
    FAILURE_LOGIN_REQUIRED,
    FAILURE_NETWORK_TIMEOUT,
    FAILURE_SELECTOR_INVALID,
)
from app.services.site_health import (
    MIN_SAMPLES_FOR_DEGRADED,
    RECENT_COLLECT_WINDOW,
    STATUS_DEGRADED,
    STATUS_OK,
    evaluate_site_health,
)


def _summary(
    *,
    status: str = "completed",
    failure_category: str = "",
    succeeded: int = 0,
    detail_missing: int = 0,
    created_at: str = "2024-01-01T00:00:00",
) -> dict:
    return {
        "status": status,
        "failure_category": failure_category,
        "succeeded": succeeded,
        "detail_missing": detail_missing,
        "created_at": created_at,
    }


# ===== 纯判据：算作"站点可能改版"的信号 =====


def test_selector_failure_marks_the_site_degraded():
    """选择器失效（页面结构变化）是"改版"最直接的证据——有样本、出现一次即报警。"""
    health = evaluate_site_health(
        [
            _summary(status="completed", succeeded=3),
            _summary(status="failed", failure_category=FAILURE_SELECTOR_INVALID),
        ]
    )

    assert health.status == STATUS_DEGRADED
    assert health.selector_failures == 1
    assert any("改版" in reason for reason in health.reasons)


def test_success_with_mostly_empty_detail_marks_the_site_degraded():
    """"能采到列表、却读不出详情"是本功能最该捕获的漂移——任务显示成功，JD 却全是空的。"""
    health = evaluate_site_health(
        [
            _summary(status="completed", succeeded=8, detail_missing=8),
            _summary(status="completed", succeeded=4, detail_missing=0),
        ]
    )

    assert health.status == STATUS_DEGRADED
    assert health.detail_drift_runs == 1
    assert any("详情" in reason for reason in health.reasons)


# ===== 纯判据：明确**不算**的信号（防误报）=====


@pytest.mark.parametrize(
    "category",
    [FAILURE_LOGIN_REQUIRED, FAILURE_CAPTCHA_REQUIRED, FAILURE_NETWORK_TIMEOUT],
)
def test_environment_and_user_side_failures_are_not_degraded(category):
    """需登录 / 验证码 / 超时是**环境或用户侧**问题，把它们算成"站点改版"会天天误报。"""
    health = evaluate_site_health(
        [
            _summary(status="failed", failure_category=category),
            _summary(status="completed", succeeded=2, detail_missing=0),
        ]
    )

    assert health.status == STATUS_OK
    assert health.reasons == []


def test_genuinely_empty_result_is_not_degraded():
    """真的没搜到（succeeded=0）不是漂移：采集器"成功但没新增"是正常结果。"""
    health = evaluate_site_health(
        [
            _summary(status="completed", succeeded=0),
            _summary(status="completed", succeeded=0),
        ]
    )

    assert health.status == STATUS_OK


def test_partial_detail_missing_is_not_degraded():
    """只有部分详情为空（未过半）不算漂移——单条偶发抓不到是正常的。"""
    health = evaluate_site_health(
        [
            _summary(status="completed", succeeded=8, detail_missing=2),
            _summary(status="completed", succeeded=10, detail_missing=4),
        ]
    )

    assert health.status == STATUS_OK
    assert health.detail_drift_runs == 0


def test_exactly_half_detail_missing_is_not_degraded():
    """恰好一半不算"超过一半"——阈值是严格大于，边界不误报。

    这里**必须放两条样本**：只有 1 条时"样本 < 2 恒为 ok"的闸门会先返回，即使把判据写成
    `>=`（恰好在边界误报）这条用例也照样绿——那样它只是"看起来在测边界"，实际什么都没测。
    带上第 2 条正常样本，`detail_drift_runs` 才会真正被边界值驱动。
    """
    health = evaluate_site_health(
        [
            _summary(status="completed", succeeded=4, detail_missing=2),  # 恰好一半
            _summary(status="completed", succeeded=10, detail_missing=0),
        ]
    )

    assert health.sampled == 2
    assert health.detail_drift_runs == 0
    assert health.status == STATUS_OK


def test_just_over_half_detail_missing_is_degraded():
    """刚过一半就报警：3 条里 2 条详情缺失（2 > 1.5）——从**另一侧**钉住同一个边界，
    保证阈值既不是"大于等于"、也不是"远远超过"才报。"""
    health = evaluate_site_health(
        [
            _summary(status="completed", succeeded=3, detail_missing=2),
            _summary(status="completed", succeeded=10, detail_missing=0),
        ]
    )

    assert health.detail_drift_runs == 1
    assert health.status == STATUS_DEGRADED


def test_the_window_only_looks_at_the_latest_five_collections():
    """窗口只取最近 5 次：第 6 次（更早的 selector_invalid）必须被排除。

    不设窗口，上周那次改版造成的失败会长期压着标记不放，"这周已经修好"也不会消失——
    用户很快就不再相信这个标记。
    """
    recent_five = [_summary(status="completed", succeeded=3) for _ in range(5)]
    older_sixth = _summary(status="failed", failure_category=FAILURE_SELECTOR_INVALID)

    health = evaluate_site_health([*recent_five, older_sixth])

    assert health.sampled == RECENT_COLLECT_WINDOW == 5
    assert health.selector_failures == 0
    assert health.status == STATUS_OK


def test_a_user_stopped_run_does_not_count_toward_detail_drift():
    """用户中途停止的采集只反映用户行为，其残缺统计不得算成站点漂移。"""
    health = evaluate_site_health(
        [
            _summary(status="stopped", succeeded=1, detail_missing=1),
            _summary(status="completed", succeeded=3, detail_missing=0),
        ]
    )

    assert health.status == STATUS_OK


# ===== 纯判据：样本不足时不报警 =====


def test_a_single_run_never_alarms_even_when_it_looks_bad():
    """样本不足（只有 1 次记录）时宁可不报，也不要制造噪声。"""
    health = evaluate_site_health([_summary(status="failed", failure_category=FAILURE_SELECTOR_INVALID)])

    assert health.status == STATUS_OK
    assert health.reasons == []
    assert health.sampled == 1


def test_no_runs_is_ok():
    health = evaluate_site_health([])

    assert health.status == STATUS_OK
    assert health.sampled == 0
    assert MIN_SAMPLES_FOR_DEGRADED >= 2


def test_evaluate_tolerates_broken_summaries():
    """摘要字段可能来自被改坏的 JSON——判据必须容错，绝不能因此抛异常。"""
    health = evaluate_site_health(
        [
            {"status": "completed", "succeeded": "坏值", "detail_missing": None},
            {"status": "completed", "succeeded": 5, "detail_missing": 0},
        ]
    )

    assert health.status == STATUS_OK
