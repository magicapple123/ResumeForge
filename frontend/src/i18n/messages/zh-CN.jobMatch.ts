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
  "jobMatch.task.label": "适配「{job}」",
  "jobMatch.hint.starting": "正在启动分析…",
  "jobMatch.hint.progress": "正在逐条比对…（{percent}%）",
  "jobMatch.action.cancel": "取消分析",
  "jobMatch.error.cancelFailed": "取消失败，请稍后重试",
  "jobMatch.hardGate.met": "硬性条件已满足",
  "jobMatch.hardGate.unmet": "硬性条件未满足",
  "jobMatch.hardGate.unknown": "硬性条件待确认",
  "jobMatch.resume.label": "匹配简历",
  "jobMatch.resume.default": "默认岗位简历",
  "jobMatch.resume.loadError": "简历列表加载失败，请重试",
  "jobMatch.resume.retry": "重载简历",
  "jobMatch.resume.source": "分析简历：{title} · 第{revision}版",
  "jobMatch.resume.profileOnly": "分析来源：我的资料",
  "jobMatch.resume.unknownSource": "旧结果未记录简历来源",
  "jobMatch.resume.stale": "简历或岗位已变化，请重新分析",
  "jobMatch.textLevel.title": "文本级匹配（外部简历）",
  "jobMatch.textLevel.badge": "文本级",
  "jobMatch.textLevel.intro":
    "只比对「JD 抽出来的词」与「这份外部简历的正文字」：不读结构化字段与版式，也没有准入判断。它与上面的结构化匹配是两个口径，分母不同，结论不可互相比较，所以单独列在这里。",
  "jobMatch.textLevel.resume.label": "用哪份外部简历",
  "jobMatch.textLevel.resume.placeholder": "选一份有正文的外部简历",
  "jobMatch.textLevel.resume.noText": "（无正文）",
  "jobMatch.textLevel.resume.noTextHint":
    "这份没有提取到正文（可能是扫描件），无法做文本比对：先到简历中心做一次文本检查或补录正文",
  "jobMatch.textLevel.resume.someNoText":
    "灰掉的那几份没有提取到正文（多为扫描件），不能做文本比对：到简历中心为它做一次文本检查或补录正文后再来选。",
  "jobMatch.textLevel.resume.empty":
    "还没有可用于比对的外部简历。扫描件或缺文字层的文件没有正文，先在简历中心做文本检查或补录正文再来。",
  "jobMatch.textLevel.error.resumes": "外部简历列表加载失败，请重试",
  "jobMatch.textLevel.error.run": "文本级比对失败，请稍后重试",
  "jobMatch.textLevel.coverage": "字面覆盖",
  "jobMatch.textLevel.coverageValue": "{matched} / {target} 个词",
  "jobMatch.textLevel.resumeSource": "来源：{name} · {chars} 字",
  "jobMatch.textLevel.matched": "正文里出现",
  "jobMatch.textLevel.missing": "正文里没写",
  "jobMatch.textLevel.highlights": "正文摘录",
  "jobMatch.textLevel.highlightWords": "（命中：{words}）",
  "jobMatch.textLevel.empty.words": "这个 JD 没抽出可比对的词（描述与要求过短或全是通用说法）。",
} as const;

export default jobMatch;
