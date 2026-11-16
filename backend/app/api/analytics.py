# SPDX-License-Identifier: Apache-2.0
"""求职数据看板接口（prefix ``/api/analytics``）。

纯本地聚合，不依赖 LLM，离线可用。口径见 ``services/analytics.py`` 的模块 docstring。

另有一条 ``GET /api/analytics/usage``：**非 token** 的外部服务用量（T16，OCR 页 / TTS 字符 /
ASR 秒 / 搜索次数）。它刻意不在看板的大 payload 里——看板每改趋势区间就整份重取，而用量是
另一条时间窗；放在这里让前端按需单独拉、单独显示三态。**响应里没有任何金额字段**。
"""

import logging
from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..dataset_registry import read_active_dataset_id
from ..schemas.analytics import DashboardOut, WeeklyGoalIn, WeeklyGoalOut
from ..schemas.usage import UsageExternalPayloadOut
from ..services.actions import add_action_route
from ..services.actions.catalog import registered_action
from ..services.analytics import build_dashboard_out
from ..services.analytics_goal import save_weekly_goal, weekly_goal_block
from ..services.analytics_usage import external_usage
from ..services.usage_counters import DEFAULT_WINDOW_DAYS, MAX_WINDOW_DAYS

logger = logging.getLogger(__name__)


router = APIRouter(prefix="/api/analytics", tags=["analytics"])


add_action_route(router, registered_action("get_analytics_overview"), route_path="/dashboard")


def read_dashboard(
    trend_months: int = Query(default=6, ge=1, le=24, description="趋势统计的自然月数（1..24）"),
    db: Session = Depends(get_db),
) -> DashboardOut:
    """投递总量 / 面试率 / 笔试通过率 / Offer 数 / 六阶段漏斗 / 月度趋势。

    薄壳：业务在 ``services.analytics.build_dashboard_out``（助手动作
    ``get_analytics_overview`` 调同一个函数）。路由入口由上面的 ``add_action_route`` 生成。
    """
    return build_dashboard_out(db, trend_months=trend_months)


@router.put("/weekly-goal", response_model=WeeklyGoalOut)
def write_weekly_goal(payload: WeeklyGoalIn, db: Session = Depends(get_db)):
    """设置/清除周投递目标（0 = 取消）。

    目标值存本数据集设置；只有统计页的「目标 vs 实际」一块读它，不参与任何投递流程。
    """
    save_weekly_goal(db, payload.target)
    return WeeklyGoalOut(**weekly_goal_block(db))


@router.get("/usage", response_model=UsageExternalPayloadOut)
def read_external_usage(
    days: int = Query(
        default=DEFAULT_WINDOW_DAYS,
        ge=1,
        le=MAX_WINDOW_DAYS,
        description="统计窗口的自然日数（含今天）",
    ),
    since: date | None = Query(default=None, description="窗口起点（与 days 同时给时取更窄的）"),
    db: Session = Depends(get_db),
) -> UsageExternalPayloadOut:
    """外部服务用量：OCR 页数 / TTS 字符数 / ASR 秒数 / 搜索次数。

    **只有数量，没有金额**（决策 #5：用量不折算金额）。没记过数时四项都是 0，
    前端据此渲染"0 页"而不是空白。
    """
    data: dict = {"external": external_usage(db, days=days, since=since)}
    try:
        data["dataset_id"] = read_active_dataset_id()
    except Exception:  # noqa: BLE001 - 数据集指针不可读时只是少了展示字段
        data["dataset_id"] = None
    return UsageExternalPayloadOut.model_validate(data)
