// SPDX-License-Identifier: Apache-2.0
/**
 * 简历风险扫描面板：扫描状态、风险分类词表、风险点列表、AI 增强开关与结果提示。
 *
 * 五类风险的展示名与说明按「分类 → label / description」成对存放，组件里只保留
 * `RiskCategory` 协议值到 key 的映射；说明卡里带 `<strong>` 内嵌的段落按既有先例
 * 整段合成一条 key、去掉标签，强调改用「」表达（同 zh-CN.datasets.ts）。
 */
const riskPanel = {
  "riskPanel.scanAt": "扫描于 {time}",
  "riskPanel.llmUsed": "含模型增强",
  "riskPanel.llmOff": "不含模型增强",
  "riskPanel.stale.title": "简历内容已修改，建议重新扫描",
  "riskPanel.action.rescan": "重新扫描",
  "riskPanel.summary": "共 {count} 条风险点",
  "riskPanel.empty": "未发现明显风险点",
  "riskPanel.action.retry": "重试",
  "riskPanel.error.title": "风险扫描失败",
  "riskPanel.enhance.aria": "AI 增强",
  "riskPanel.enhance.label": "AI 增强",
  "riskPanel.claimTag": "事实台账 #{id}",
  "riskPanel.suggestion": "建议：",
  "riskPanel.followUp": "追问准备（{count}）",
  "riskPanel.category.duplicate.label": "查重",
  "riskPanel.category.duplicate.description": "同一要点在简历里重复出现",
  "riskPanel.category.sensitive.label": "敏感词",
  "riskPanel.category.sensitive.description": "身份证号 / 银行卡号 / 精确生日 / 住址 / 薪资",
  "riskPanel.category.exaggeration.label": "夸大",
  "riskPanel.category.exaggeration.description":
    "「精通」「全球第一」这类绝对化表述与 ≥100% 的量化",
  "riskPanel.category.deepDive.label": "深挖风险点",
  "riskPanel.category.deepDive.description": "面试官会追问的强主张（联动事实台账给出准备方向）",
  "riskPanel.category.compliance.label": "合规校验",
  "riskPanel.category.compliance.description": "保密 / 未公开 / 涉密等 NDA 相关表述",
  "riskPanel.severity.high": "高",
  "riskPanel.severity.medium": "中",
  "riskPanel.severity.low": "低",
  "riskPanel.scanDuration": "用时 {duration}",
  "riskPanel.intro.summary":
    "扫描只做检查与提示，「不会改写任何正文」——发现的问题要不要改、怎么改都由你决定。",
  "riskPanel.intro.estimatedTime":
    "预计耗时：本地规则通常 1–3 秒；开启 AI 增强一般十几秒，最长 45 秒后自动降级为本地结果。",
  "riskPanel.intro.background": "扫描期间可以关掉这个窗口，扫描会在后台继续，完成后会提醒你。",
  "riskPanel.action.start": "开始扫描",
  "riskPanel.scanning.elapsed": "正在扫描…已用时 {elapsed}s",
  "riskPanel.scanning.hint": "可以关闭此窗口，扫描会继续",
  "riskPanel.enhance.note.on":
    "开启后会把遮罩后的简历发给本机配置的模型复核（姓名/电话/邮箱/公司等已遮蔽），台账只发结构信息。",
  "riskPanel.enhance.note.off": "已关闭：只用本地规则，不会向模型发送任何内容。",
  "riskPanel.enhance.tooltip.on":
    "开启时会把你已配置的模型拿来复核简历——只发送遮罩后的正文（姓名/电话/邮箱/公司等已遮蔽），台账只发条数与承担程度这类结构信息，不发送条目原文。关掉后只用本地规则，完全不联网。",
} as const;

export default riskPanel;
