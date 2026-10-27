// SPDX-License-Identifier: Apache-2.0
/**
 * 求职进度页：头部说明、统计读数、漏斗、筛选、空态与分页。
 *
 * 漏斗与筛选下拉里的状态名不在这里：那七个名字是**协议值 → 显示名**的映射
 * （`applied` / `screening` …，见 `types/tracker.ts`），与进度表单共用同一份词表，
 * 因此 `TrackerPage.tsx` 的 `TRACK_STATUS_LABEL_KEYS` 直接指向 `trackerForm.status.*`
 * ——同一个协议值在两处必须是同一个名字，各写一份迟早会漂。
 *
 * `types/tracker.ts` 的 `TRACK_STATUS_LABELS` 一个字都没动（`AnalyticsPage` 与列表卡片
 * 仍在用）。
 */
const trackerPage = {
  "trackerPage.title": "求职进度",
  "trackerPage.subtitle":
    "一家公司一个岗位一条记录，随对方发来的通知往前推进。投递台投出去的岗位会自动记一条「已投递」，之后的进展把通知粘进来即可。",
  "trackerPage.action.reminders": "提醒",
  "trackerPage.action.import": "从通知导入",
  "trackerPage.action.export": "导出",
  "trackerPage.action.create": "添加进度",
  "trackerPage.action.clearJobFilter": "清除岗位筛选",
  "trackerPage.export.csv": "导出 CSV（可直接用 Excel 打开）",
  "trackerPage.export.json": "导出 JSON",
  "trackerPage.error.deleteFailed": "删除失败",
  "trackerPage.error.exportFailed": "导出失败",
  "trackerPage.stats.error": "统计加载失败：{error}",
  "trackerPage.stat.total": "总数",
  "trackerPage.stat.active": "进行中",
  "trackerPage.stat.month": "本月投递",
  "trackerPage.stat.closed": "已结束",
  "trackerPage.funnel.tooltip": "{label}：{count} 条",
  "trackerPage.filter.statusAria": "求职进度状态筛选",
  "trackerPage.filter.allStatuses": "全部状态",
  "trackerPage.filter.searchPlaceholder": "搜索公司、岗位、备注或下一步",
  "trackerPage.linkedJob.prefix": "只看该岗位的投递：{label}",
  "trackerPage.linkedJob.unknownName": "岗位 #{id}",
  "trackerPage.linkedJob.deleted": "该岗位可能已删除",
  "trackerPage.empty.filtered": "没有符合条件的记录",
  "trackerPage.empty.initial":
    "还没有进度记录。投递台投出的岗位会自动出现在这里，也可以点「从通知导入」把邮箱里的进展整理进来。",
  "trackerPage.pagination.total": "共 {count} 条",
  "trackerPage.modal.reminderTitle": "日历提醒",
} as const;

export default trackerPage;
