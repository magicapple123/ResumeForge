// SPDX-License-Identifier: Apache-2.0
/**
 * 求职助手的运行上限（工具轮次上限 / 整链时间预算）、上下文压缩的三个设置项，
 * 以及到顶后的「继续」入口。
 *
 * 两条上限都在设置页改，文案必须讲清"什么时候生效"：轮次是**下一轮**就生效，
 * 预算是**下一次提问**生效——用户按这一点决定要不要在生成途中改小。
 *
 * 压缩这一段要讲清"做了什么、原文还在不在"：遮蔽只换工具结果的正文、摘要只换更早的
 * 历史，两者都不删本地消息，所以文案不能写成"删除/清理"。两个阈值的关系（摘要必须大于
 * 遮蔽）写在 hint 里，校验失败时另有独立提示。
 */
const assistantLimits = {
  "assistantLimits.settings.title": "求职助手 · 运行上限与上下文压缩",
  "assistantLimits.settings.intro":
    "轮次上限决定一次回复里最多几轮工具调用；时间预算决定整条回复最多跑多少秒。改动随时生效，不必重启应用。",
  "assistantLimits.settings.rounds.label": "工具调用轮次上限",
  "assistantLimits.settings.rounds.unit": "轮",
  "assistantLimits.settings.rounds.hint":
    "达到上限时助手会先停下，由你决定是否点「继续」。生成途中改小，下一轮立即按新值收尾。",
  "assistantLimits.settings.budget.label": "单次回复时间预算",
  "assistantLimits.settings.budget.unit": "秒",
  "assistantLimits.settings.budget.hint":
    "覆盖全部工具轮次与模型输出，到期即中止本次回复。改动在下次提问时生效。",
  "assistantLimits.settings.compaction.title": "上下文压缩",
  "assistantLimits.settings.compaction.intro":
    "对话占用的窗口达到阈值时，助手会自动压缩旧上下文：先遮蔽早期工具结果的正文，还压不下来就把更早的历史写成摘要。两者都不删除本地消息，原文随时可还原。",
  "assistantLimits.settings.compaction.model.label": "摘要模型",
  "assistantLimits.settings.compaction.model.placeholder": "跟随当前对话模型",
  "assistantLimits.settings.compaction.model.hint":
    "留空即跟随当前对话所用的模型。摘要要吃掉整段历史，建议与主模型同档，不要用小模型。",
  "assistantLimits.settings.compaction.mask.label": "遮蔽阈值",
  "assistantLimits.settings.compaction.mask.unit": "%",
  "assistantLimits.settings.compaction.mask.hint":
    "窗口占用达到这个百分比后，先把最早的几组工具结果正文换成一行占位说明，消息条数与工具调用配对关系不变。",
  "assistantLimits.settings.compaction.summary.label": "摘要阈值",
  "assistantLimits.settings.compaction.summary.unit": "%",
  "assistantLimits.settings.compaction.summary.hint":
    "占用达到这个百分比后，把更早的历史压成一段摘要。必须大于遮蔽阈值，否则两档会互相覆盖。",
  "assistantLimits.settings.compaction.rangeHint": "两个阈值都必须在 {min}–{max} 之间。",
  "assistantLimits.settings.compaction.orderHint":
    "摘要阈值必须大于遮蔽阈值（当前遮蔽 {mask}%、摘要 {summary}%）。",
  "assistantLimits.settings.save": "保存设置",
  "assistantLimits.settings.saved": "设置已保存，下一次提问生效",
  "assistantLimits.settings.saveFailed": "保存设置失败，请稍后重试",
  "assistantLimits.continue.hint": "已达到 {rounds} 轮工具调用上限，助手先停在这里。",
  "assistantLimits.continue.action": "继续",
} as const;

export default assistantLimits;
