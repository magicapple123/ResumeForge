// SPDX-License-Identifier: Apache-2.0
/**
 * 页头「后台任务」指示器：任务行的进度与取消/移除、弹层标题与常驻提示、操作反馈。
 */
const backgroundTasks = {
  "backgroundTasks.label": "后台任务",
  "backgroundTasks.aria.viewTasks": "查看后台任务",
  "backgroundTasks.popover.title": "正在进行的任务",
  "backgroundTasks.tooltip.running": "{count} 个任务正在进行",
  "backgroundTasks.status.preparing": "正在准备…",
  "backgroundTasks.status.unknown": "任务状态未知",
  "backgroundTasks.progress.received": "已接收 {count} 字",
  "backgroundTasks.progress.processed": "已处理 {done}/{total} 个岗位",
  "backgroundTasks.progress.currentJob": "当前：{title}",
  "backgroundTasks.action.cancel": "取消",
  "backgroundTasks.action.remove": "移除",
  "backgroundTasks.jobAnalysis.label": "岗位解读",
  "backgroundTasks.jobAnalysis.running": "正在生成岗位解读…",
  "backgroundTasks.toast.cancelled": "已取消「{name}」",
  "backgroundTasks.toast.cancelRequested": "已请求取消「{name}」",
  "backgroundTasks.toast.dismissed": "已移除「{name}」",
  "backgroundTasks.toast.cancelFailed": "取消失败，请稍后重试",
  "backgroundTasks.toast.jobAnalysisCancelled": "已取消岗位解读",
  "backgroundTasks.hint.keepsRunning": "关掉窗口也会继续跑，完成后会弹窗提醒并响一声。",
} as const;

export default backgroundTasks;
