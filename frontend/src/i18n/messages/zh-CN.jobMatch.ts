// SPDX-License-Identifier: Apache-2.0
/**
 * 岗位匹配分析弹窗：结论、准入提示、投递建议与操作。
 *
 * 三类硬性条件的显示名（已满足 / 未满足 / 待确认）与三组条件标题由本包提供，
 * 组件里的状态映射常量只存 labelKey。准入结论与五类状态名仍来自
 * `types/apply/match.ts`（与批量结果面板共用），不在本包内。
 */
const jobMatch = {
  "jobMatch.empty.none": "暂无条目",
  "jobMatch.error.load": "读取匹配分析失败，请稍后重试",
  "jobMatch.error.analyze": "生成匹配分析失败，请稍后重试",
  "jobMatch.toast.doneTitle": "匹配度分析已完成",
  "jobMatch.toast.doneInDetail": "回到岗位详情点「匹配度分析」即可看到结论。",
  "jobMatch.toast.doneHere": "结论已在本窗口更新。",
  "jobMatch.error.title": "匹配度分析失败",
  "jobMatch.error.retryHint": "（可回到岗位详情重试）",
  "jobMatch.toast.cleared": "已清除该岗位的匹配结论",
  "jobMatch.error.clearFailed": "清除失败",
  "jobMatch.page.title": "岗位匹配度分析",
  "jobMatch.page.subtitle":
    "对照你已保存的个人资料与简历逐条判断（与只读招聘原文的「岗位需求解读」不同）",
  "jobMatch.action.retry": "重试",
  "jobMatch.hint.background":
    "分析期间可以关掉这个窗口去做别的，完成后会弹通知并响一声（只要页面没刷新）。",
  "jobMatch.empty": "这个岗位还没有做过匹配分析",
  "jobMatch.intro":
    "分析会读取你的个人资料与简历，对每条招聘要求给出「已匹配 / 表达缺口 / 证据不足 / 真实缺口 / 待确认」五类结论。未配置大模型时会走本地降级（各条均为「待确认」），不假装做过 AI 比对。",
  "jobMatch.action.start": "开始分析",
  "jobMatch.field.job": "该岗位",
  "jobMatch.field.model": "分析模型",
  "jobMatch.model.local": "本地降级（未配置大模型）",
  "jobMatch.field.verdict": "准入结论",
  "jobMatch.field.hardGate": "硬性门槛",
  "jobMatch.warning.gaps": "存在真实缺口：默认不自动投递，需要你在加入投递台时逐条确认。",
  "jobMatch.warning.unknown": "含证据不足或待确认的条目：加入投递台时需要你逐条确认。",
  "jobMatch.section.advice": "投递建议",
  "jobMatch.section.score": "匹配度参考分",
  "jobMatch.section.scope": "口径说明",
  "jobMatch.action.reanalyze": "重新分析",
  "jobMatch.action.clear": "清除结论",
  "jobMatch.condition.jdQuote": "招聘原文：{quote}",
  "jobMatch.condition.evidence": "依据：{evidence}",
  "jobMatch.condition.evidenceMissing": "资料中未提供",
  "jobMatch.group.hardConditions": "硬性条件",
  "jobMatch.group.coreAbilities": "核心能力",
  "jobMatch.group.bonusItems": "加分项",
  "jobMatch.hardGate.met": "硬性条件已满足",
  "jobMatch.hardGate.unmet": "硬性条件未满足",
  "jobMatch.hardGate.unknown": "硬性条件待确认",
} as const;

export default jobMatch;
