// SPDX-License-Identifier: Apache-2.0
/**
 * 后台任务相关的全局文案：页头「后台任务」指示器与常驻任务条（进度、取消/移除），
 * 风险扫描 / 岗位优化建议 / 岗位解读的后台通知，以及生成与批次完成的统一提醒。
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
  // ── 常驻任务条 ──────────────────────────────────────────────
  "backgroundTasks.bar.heading": "正在进行",
  "backgroundTasks.bar.view": "查看",
  "backgroundTasks.bar.cancelAria": "取消{label}",
  "backgroundTasks.bar.elapsed": "已运行 {seconds} 秒",
  "backgroundTasks.bar.generating": "生成中…",
  // ── 风险扫描的后台通知 ──────────────────────────────────────
  "backgroundTasks.risk.running.title": "风险扫描进行中",
  "backgroundTasks.risk.running.description": "可以离开此页面，扫描会在后台继续",
  "backgroundTasks.risk.done.title": "风险扫描完成",
  "backgroundTasks.risk.done.description": "共 {count} 条风险点",
  "backgroundTasks.risk.failed.title": "风险扫描失败",
  "backgroundTasks.risk.failed.description": "可以回到简历预览重新扫描。",
  "backgroundTasks.risk.stateFailed": "风险扫描失败，请重试",
  // ── 岗位优化建议生成的后台通知 ──────────────────────────────
  "backgroundTasks.suggestion.running.title": "岗位优化建议生成中",
  "backgroundTasks.suggestion.running.description": "可以离开此页面，生成会在后台继续",
  "backgroundTasks.suggestion.done.title": "岗位优化建议已生成",
  "backgroundTasks.suggestion.done.description": "回到简历详情点「{action}」即可看到。",
  "backgroundTasks.suggestion.failed.title": "岗位优化建议生成失败",
  "backgroundTasks.suggestion.failed.description": "回到简历详情重新生成。",
  // ── 简历生成的完成 / 失败 / 取消提醒 ────────────────────────
  "backgroundTasks.resume.done.title": "简历已生成",
  "backgroundTasks.resume.done.description": "已自动保存到简历中心，可以继续微调或导出。",
  "backgroundTasks.resume.restored.description":
    "刷新前开始的生成任务已完成，简历已自动保存到简历中心。",
  "backgroundTasks.resume.failed.title": "简历生成失败",
  "backgroundTasks.resume.failed.description": "可以回到简历中心重试。",
  "backgroundTasks.resume.cancelled.title": "简历生成已取消",
  "backgroundTasks.status.unknownDetail": "任务状态未知：后端可能已重启或记录已被清理",
  "backgroundTasks.error.taskRecordGone": "任务记录已不存在",
  "backgroundTasks.confirm.gotIt": "知道了",
  // ── 「你没在看，但它跑完了」的统一口吻 ──────────────────────
  "backgroundTasks.announce.completed": "{label}已完成",
  "backgroundTasks.announce.completedHint": "结果已经可以查看了，回到刚才的页面即可。",
  "backgroundTasks.announce.failed": "{label}失败",
  "backgroundTasks.announce.failedHint": "可以回到刚才的页面重试。",
  // ── 岗位解读 ────────────────────────────────────────────────
  "backgroundTasks.jobAnalysis.completedHint": "回到岗位详情再点「{action}」即可看到。",
  "backgroundTasks.jobAnalysis.stateFailed": "生成岗位解读失败，请稍后重试",
  // ── 岗位批量适配度分析 ──────────────────────────────────────
  "backgroundTasks.jobMatch.done.title": "岗位适配度分析完成",
  "backgroundTasks.jobMatch.done.description":
    "已完成 {completed} 个岗位，{failed} 个岗位失败；结果已保存到分析记录。",
  "backgroundTasks.jobMatch.action.viewResults": "查看结果",
  "backgroundTasks.jobMatch.failed.title": "岗位适配度分析失败",
  "backgroundTasks.jobMatch.failed.description": "请稍后重试。",
  "backgroundTasks.jobMatch.cancelled.title": "岗位适配度分析已取消",
  "backgroundTasks.jobMatch.cancelled.description": "取消前已完成的结果仍已保存。",
  "backgroundTasks.jobMatch.label": "分析 {count} 个岗位",
  // ── 投递 / 采集批次完成通知 ──────────────────────────────────
  "backgroundTasks.batch.kindApply": "投递",
  "backgroundTasks.batch.kindCollect": "采集",
  "backgroundTasks.batch.kindFallback": "任务",
  "backgroundTasks.batch.statsApply": "成功 {succeeded} · 失败 {failed} · 跳过 {skipped}",
  "backgroundTasks.batch.statsCollect": "已暂存 {succeeded} 个岗位 · 跳过 {skipped} 个",
  "backgroundTasks.batch.completed": "{kind}批次 #{id} 已完成",
  "backgroundTasks.batch.failed": "{kind}批次 #{id} 失败",
  "backgroundTasks.batch.stopped": "{kind}批次 #{id} 已停止",
  "backgroundTasks.batch.failed.hint": "请到投递台查看失败原因",
  "backgroundTasks.batch.clickToView": "（点击查看投递台）",
} as const;

export default backgroundTasks;
