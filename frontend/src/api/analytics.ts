// SPDX-License-Identifier: Apache-2.0
/** 求职数据看板接口。 */
import type { AnalyticsDashboard, WeeklyGoal } from "../types";
import { buildQuery, request } from "./client";

export function getAnalyticsDashboard(trendMonths: number = 6): Promise<AnalyticsDashboard> {
  return request(`/analytics/dashboard${buildQuery({ trend_months: trendMonths })}`);
}

/** 设置/清除周投递目标（0 = 取消）。只影响统计页的「目标 vs 实际」一块。 */
export function putAnalyticsWeeklyGoal(target: number): Promise<WeeklyGoal> {
  return request("/analytics/weekly-goal", {
    method: "PUT",
    body: JSON.stringify({ target }),
  });
}
