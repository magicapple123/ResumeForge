// SPDX-License-Identifier: Apache-2.0
/**
 * 看板导出（T13）：前端把已取到的数据拍成 CSV，**不再请求后端**。
 *
 * 为什么在前端：这份看板本来就是"当前筛选下的快照"，导出应该与屏幕上看到的一致；
 * 再加一个导出接口会引入第二份口径（含 generated_at 不同步）。
 *
 * 编码：带 UTF-8 BOM。Excel 在中文 Windows 上默认按 GBK 打开无 BOM 的 UTF-8，
 * 中文列名会变成乱码——这不是"可选优化"，是能不能用的问题。
 */
import { t } from "../../i18n";
import type { AnalyticsDashboard } from "../../types";

function escape(value: string | number): string {
  const text = String(value);
  return /[",\n]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
}

/** 拍成 `区块,指标,值` 三列；数字原样，比率保留 4 位小数（够复核，不假装精度）。 */
export function dashboardToCsv(data: AnalyticsDashboard): string {
  const overview = t("analyticsPage.export.overview");
  const goal = t("analyticsPage.export.goal");
  const rows: Array<[string, string, string | number]> = [
    [overview, t("analyticsPage.export.total"), data.total_applications],
    [overview, t("analyticsPage.export.valid"), data.valid_applications],
    [overview, t("analyticsPage.export.interviews"), data.interview_count],
    [overview, t("analyticsPage.export.interviewRate"), data.interview_rate.toFixed(4)],
    [overview, t("analyticsPage.export.offers"), data.offer_count],
    [overview, t("analyticsPage.export.offerRate"), data.offer_rate.toFixed(4)],
    [overview, t("analyticsPage.export.active"), data.active_count],
    [overview, t("analyticsPage.export.stalled"), data.stalled_count],
    [goal, t("analyticsPage.export.goalTarget"), data.weekly_goal.target],
    [goal, t("analyticsPage.export.goalDone"), data.weekly_goal.this_week_count],
  ];
  for (const stage of data.funnel)
    rows.push([t("analyticsPage.export.funnel"), stage.label, stage.count]);
  for (const point of data.trend)
    rows.push([t("analyticsPage.export.trend"), point.label, point.count]);
  for (const item of data.weekday)
    rows.push([t("analyticsPage.export.weekday"), item.label, item.count]);

  const header = [
    t("analyticsPage.export.section"),
    t("analyticsPage.export.metric"),
    t("analyticsPage.export.value"),
  ].join(",");
  const lines = [header, ...rows.map((row) => row.map(escape).join(","))];
  return `\uFEFF${lines.join("\r\n")}`;
}

/** 触发下载（浏览器端）。文件名带日期，避免多次导出互相覆盖。 */
export function downloadDashboardCsv(data: AnalyticsDashboard, today: string): void {
  const blob = new Blob([dashboardToCsv(data)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = t("analyticsPage.export.fileName", { date: today });
  anchor.click();
  URL.revokeObjectURL(url);
}
