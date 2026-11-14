// SPDX-License-Identifier: Apache-2.0
/**
 * 求职助手「上下文用量」面板（需求 #6）。
 *
 * 两个口径必须分开写在界面上，所以文案也分开：标题旁的「估算」标的是启发式估算
 * （`estimate_tokens`），底栏「上一轮实测输入」标的是服务商真正报告的 `prompt_tokens`。
 * 两者不合并、不换算——混在一处会让用户以为百分比是服务商口径。
 */
const contextUsage = {
  /** chip 上的短名（窄栏会隐藏它，只留细环 + 百分比）。 */
  "contextUsage.chip": "上下文",
  "contextUsage.aria.chip": "上下文用量",
  "contextUsage.title": "上下文用量",
  "contextUsage.aria.close": "关闭上下文用量",
  /** 标题右侧的小字：主指标全部是估算值。 */
  "contextUsage.estimate": "估算",
  "contextUsage.used": "已使用 {used} / {window}",
  "contextUsage.partial": "部分数据",
  "contextUsage.bucket.system": "系统提示词",
  "contextUsage.bucket.tools": "工具定义与结果",
  "contextUsage.bucket.conversation": "对话消息",
  "contextUsage.bucket.connectors": "界面上下文与附件",
  "contextUsage.bucket.skills": "技能",
  /** 0 值行按数据来源分两种说法：`partial` 时是「没参与估算」，否则是「真为 0」。 */
  "contextUsage.partialNote": "本次只估算了系统提示词与对话消息，工具、技能、附件未参与本轮估算",
  "contextUsage.emptyNote": "本次没有可估算的内容",
  "contextUsage.zeroNote": "另有 {count} 类为 0",
  /** 底栏实测值：与服务商账单口径一致，单独一行，不参与任何换算。 */
  "contextUsage.actual": "上一轮实测输入 {tokens} tokens",
  "contextUsage.actualUnknown": "本次未报告",
  "contextUsage.noWindow": "未设置上下文窗口",
  "contextUsage.goSettings": "去设置",
  /** 折叠区标题：窗口与压缩的配置项默认收起，第一层只留读数与动作。 */
  "contextUsage.settings.title": "窗口与压缩设置",
  "contextUsage.window.label": "上下文窗口",
  "contextUsage.window.source.manual": "手动设置",
  "contextUsage.window.source.reference": "参考表",
  "contextUsage.window.source.fallback": "未知模型",
  "contextUsage.early.label": "本次提前压缩",
  "contextUsage.early.placeholder": "跟随全局阈值",
  "contextUsage.early.trigger": "触发点 {trigger}（占窗口 {percent}）",
  "contextUsage.early.hint": "仅对本次对话生效，调低会更早压缩",
  "contextUsage.window.mismatch": "窗口可能偏大，请调低后重试",
  "contextUsage.window.sourceLine": "{source} · 只影响使用这个模型的对话",
  "contextUsage.window.custom": "自定义",
  "contextUsage.window.customPlaceholder": "填入窗口大小",
  "contextUsage.window.saved": "上下文窗口已保存",
  "contextUsage.window.saveFailed": "保存上下文窗口失败，请重试",
  "contextUsage.window.preset32k": "32K",
  "contextUsage.window.preset64k": "64K",
  "contextUsage.window.preset128k": "128K",
  "contextUsage.window.preset200k": "200K",
  "contextUsage.window.preset1m": "1M",
  /** 模型窗口参考：只读列表；未知型号按保守值展示，当前模型在表里标出来。 */
  "contextUsage.window.reference.trigger": "模型窗口参考",
  "contextUsage.window.reference.title": "各家模型的上下文窗口",
  "contextUsage.window.reference.hint":
    "未知型号按 {tokens} 保守估算；模型配置里手填的窗口优先于本表。",
  "contextUsage.window.reference.currentLine": "当前模型：{model} · {source}",
  "contextUsage.window.reference.noModel": "当前未配置模型",
  "contextUsage.window.reference.column.model": "模型",
  "contextUsage.window.reference.column.window": "上下文窗口",
  "contextUsage.window.reference.column.reference": "官方文档",
  "contextUsage.window.reference.open": "查看",
  "contextUsage.window.reference.currentBadge": "当前",
  "contextUsage.window.reference.failed": "加载失败，请稍后重试。",
  "contextUsage.window.reference.retry": "重试",
  "contextUsage.window.reference.empty": "暂时没有可展示的型号。",
  /** 压缩状态（#10）：三件事分开说——遮蔽了几条、摘要了几轮、当前占多少。 */
  "contextUsage.compaction.title": "压缩状态",
  "contextUsage.compaction.none": "尚未压缩",
  "contextUsage.compaction.status": "已遮蔽 {masked} 条工具结果 · 已摘要 {turns} 轮",
  "contextUsage.compaction.range": "压缩前 {before} · 压缩后 {after}",
  "contextUsage.compaction.saved": "省下 {percent}%",
  "contextUsage.compaction.keepOriginal": "原文仍在本地，可随时还原",
  "contextUsage.compaction.restoreBody": "摘要会被清空，原文仍在本地",
  "contextUsage.compaction.action.compact": "压缩上下文",
  "contextUsage.compaction.action.now": "立即压缩",
  "contextUsage.compaction.action.restore": "还原原文",
  "contextUsage.compaction.preview": "预计从 {before} 降到 {after}，覆盖 {turns} 轮",
  "contextUsage.compaction.nothing": "最近 6 轮之内无需压缩",
  "contextUsage.compaction.confirmHint": "压缩会消耗一次模型调用",
  "contextUsage.compaction.toast.compacted": "已压缩 {turns} 轮对话",
  "contextUsage.compaction.toast.restored": "已还原原文",
  "contextUsage.compaction.toast.failed": "压缩失败，请稍后重试",
} as const;

export default contextUsage;
