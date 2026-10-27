// SPDX-License-Identifier: Apache-2.0
/**
 * 求职进度页的「从通知导入」弹窗：粘贴/截图、识别预览、勾选写入与结果提示。
 *
 * 状态名复用进度表单的 `trackerForm.status.*`——同一个协议值在两处必须是同一个名字，
 * 各写一份迟早会漂；合并结论（新增 / 更新 / 已是最新）只在本弹窗出现，放在本包。
 * `types/tracker.ts` 的 `TRACK_STATUS_LABELS` 一个字都没动（`TrackCard`、
 * `AnalyticsPage` 仍在用）。
 */
const trackerImport = {
  "trackerImport.dialog.title": "从通知导入进度",
  "trackerImport.dialog.intro":
    '把招聘邮件、短信或站内通知的内容粘贴进来（也可以贴截图）。识别结果先给你看"会发生什么"，你确认之后才会写入。',
  "trackerImport.dialog.placeholder": "在这里按 Ctrl+V 可以直接贴截图；纯文字通知直接粘进来即可。",
  "trackerImport.action.recognize": "识别并预览",
  "trackerImport.action.confirm": "确认写入勾选的 {count} 条",
  "trackerImport.engine.ai": "AI 识别",
  "trackerImport.engine.local": "本地关键词匹配",
  "trackerImport.empty.noResults": "还没有识别结果",
  "trackerImport.evidence.label": "依据：{evidence}",
  "trackerImport.toast.noInput": "请先粘贴通知内容，或上传截图、文档",
  "trackerImport.toast.noRecords": "没有识别出可用的进度记录",
  "trackerImport.toast.recognizeFailed": "识别失败",
  "trackerImport.toast.noneSelected": "请至少勾选一条",
  "trackerImport.toast.saveFailed": "保存失败",
  "trackerImport.result.created": "新增 {count} 条",
  "trackerImport.result.updated": "更新 {count} 条",
  "trackerImport.result.unchanged": "{count} 条已是最新",
  "trackerImport.result.separator": "，",
  "trackerImport.result.done": "已处理",
  "trackerImport.mergeAction.created": "新增记录",
  "trackerImport.mergeAction.updated": "更新进度",
  "trackerImport.mergeAction.unchanged": "已是最新，未改动",
} as const;

export default trackerImport;
