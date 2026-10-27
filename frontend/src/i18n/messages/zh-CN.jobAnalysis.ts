// SPDX-License-Identifier: Apache-2.0
/**
 * 「岗位需求解读」弹窗：生成/取消/后台继续、过期提示、要求与建议两段正文、首次说明。
 *
 * 首次说明段落原来用 `<strong>不会</strong>` 强调，这里按既有先例（见 zh-CN.datasets.ts
 * 顶部注释）整段合成一个 key、去掉标签，强调改用「」表达：切成 before/middle/after 三段
 * 在英文里语序不通，而 i18n 没有富文本插值。
 */
const jobAnalysis = {
  "jobAnalysis.title": "岗位需求解读",
  "jobAnalysis.action.start": "开始生成",
  "jobAnalysis.action.regenerate": "重新生成",
  "jobAnalysis.action.regenerateAnalysis": "重新生成解读",
  "jobAnalysis.action.continueInBackground": "后台继续",
  "jobAnalysis.aria.cancel": "取消生成本次解读",
  "jobAnalysis.toast.cancelled": "已取消，本次生成结果不会保存",
  "jobAnalysis.elapsed": "已生成 {seconds} 秒",
  "jobAnalysis.running.title":
    "生成期间可以关掉这个弹窗去做别的，完成后会提醒你（弹窗 + 提示音）。",
  "jobAnalysis.running.body": "点「取消」会中断本次生成，结果不会保存。",
  "jobAnalysis.stale.title": "岗位内容改过，这份解读可能已过期",
  "jobAnalysis.stale.body": "生成于 {time}；重写岗位描述后建议重新生成。",
  "jobAnalysis.stale.bodyNoTime": "重写岗位描述后建议重新生成。",
  "jobAnalysis.confirm.regenerate.title": "重新生成岗位解读？",
  "jobAnalysis.confirm.regenerate.body": "当前这份解读会被新结果替换。",
  "jobAnalysis.section.requirements": "核心需求",
  "jobAnalysis.section.advice": "求职建议",
  "jobAnalysis.item.evidence": "依据：{value}",
  "jobAnalysis.item.rationale": "原因：{value}",
  "jobAnalysis.empty.requirements": "未提取到明确要求",
  "jobAnalysis.empty.advice": "暂无补充建议",
  "jobAnalysis.priority.high": "核心要求",
  "jobAnalysis.priority.medium": "重要要求",
  "jobAnalysis.priority.low": "加分项",
  "jobAnalysis.firstRun.title": "这一步会把岗位描述交给模型，整理出核心要求与求职建议",
  "jobAnalysis.firstRun.body":
    "读取的是这个岗位的标题、公司、岗位描述与你已保存的标签，「不会」发送整份简历或个人资料；通常需要 10–60 秒。生成期间可以关掉弹窗去做别的，完成后会提醒你。",
} as const;

export default jobAnalysis;
