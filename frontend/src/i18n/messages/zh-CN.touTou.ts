// SPDX-License-Identifier: Apache-2.0
/**
 * 投投悬浮球（TouTou）：浮窗助手外壳、剪贴板片段夹、球体按钮提示、去改资料提示卡、
 * 保存浮卡、低打扰提示气泡，以及 #27 的页面感知 / 划词动作 / 动作面板 / 中断预算 /
 * 顺便问 / 提案撤销六项。
 *
 * 助手卡片内嵌的侧栏助手页面能力不在这里——那部分归 `assistantUi`。本包只有投投这一层
 * 外壳的界面文案；动作与信号的 label 只存 key，渲染方在渲染期取。
 */
const touTou = {
  // ── 助手浮窗外壳（TouTouAssistantCard） ─────────────────────
  "touTou.assistant.ariaLabel": "投投求职助手",
  "touTou.assistant.description":
    "投投可以帮助你解决简历通使用问题、分析简历和岗位，并在明确要求时操作允许的数据。",
  "touTou.assistant.gripLabel": "拖动投投助手卡片",
  "touTou.assistant.gripTitle": "按住拖动卡片",
  "touTou.assistant.close": "关闭投投助手",

  // ── 剪贴板片段夹（TouTouClipboardCard） ─────────────────────
  "touTou.clipboard.ariaLabel": "投投剪贴板",
  "touTou.clipboard.title": "投投剪贴板",
  "touTou.clipboard.gripLabel": "拖动投投剪贴板",
  "touTou.clipboard.close": "关闭投投剪贴板",
  "touTou.clipboard.hint": "把要反复粘贴的资料存成片段，点一下就复制。",
  "touTou.clipboard.add": "新增片段",
  "touTou.clipboard.limitReached": "片段已达上限（{count} 条）",
  "touTou.clipboard.empty": "还没有片段：把常贴的内容存进来，随时一键复制。",
  "touTou.clipboard.copy": "复制",
  "touTou.clipboard.edit": "编辑",
  "touTou.clipboard.delete": "删除",
  "touTou.clipboard.deleteConfirm": "删除这条片段？",
  "touTou.clipboard.untitled": "未命名片段",
  "touTou.clipboard.saved": "已保存片段",
  "touTou.clipboard.deleted": "已删除片段",
  "touTou.clipboard.copied": "已复制「{title}」",
  "touTou.clipboard.copyFailed": "复制失败，请手动选择内容复制",
  "touTou.clipboard.emptyContent": "内容不能为空",
  "touTou.clipboard.titlePlaceholder": "片段名称（留空则取内容前 20 字，最多 {max} 字）",
  "touTou.clipboard.contentPlaceholder": "片段内容（复制时按这里保存的原文粘贴）",
  "touTou.clipboard.contentLimit": "已达 {max} 字上限",
  "touTou.clipboard.cancel": "取消",
  "touTou.clipboard.save": "保存",

  // ── 球体按钮（TouTouOrbButton） ─────────────────────────────
  "touTou.orb.tooltip":
    "单击：打开求职助手；双击：打开投投剪贴板；长按：打开动作面板；选中文字后按 {shortcut}：打开划词动作",
  "touTou.orb.ariaLabel": "打开求职助手",
  "touTou.orb.signals": "{count} 件事可以帮你看看",

  // ── 去改资料提示卡（TouTouProfilePromptCard） ───────────────
  "touTou.profilePrompt.ariaLabel": "修改我的资料",
  "touTou.profilePrompt.title": "想补充或修改资料？",
  "touTou.profilePrompt.close": "关闭提示卡",
  "touTou.profilePrompt.edit": "去编辑",

  // ── 保存浮卡（TouTouSaveCard） ──────────────────────────────
  "touTou.save.ariaLabel": "保存简历资料",
  "touTou.save.title": "资料有未保存的修改",
  "touTou.save.save": "保存资料",
  "touTou.save.cancel": "取消",

  // ── 低打扰提示气泡（TouTouTip） ─────────────────────────────
  "touTou.tip.close": "关闭投投提示",

  // ── 动作目录（#27A/#27C：本页动作与搜索全部） ───────────────
  "touTou.action.openAssistant": "打开投投助手",
  "touTou.action.sideAsk": "顺便问一句",
  "touTou.action.openClipboard": "打开投投剪贴板",
  "touTou.action.goJobs": "去岗位广场挑岗位",
  "touTou.action.goApply": "去投递队列",
  "touTou.action.goResumes": "去简历工作台",
  "touTou.action.goProfile": "去我的资料",
  "touTou.action.goMaterials": "去资料箱",
  "touTou.action.goKnowledge": "去知识库",
  "touTou.action.goFavorites": "去收藏夹",
  "touTou.action.goInterview": "去面试准备",
  "touTou.action.goClaims": "去事实台账",
  "touTou.action.goTracker": "去投递跟进",
  "touTou.action.searchAll": "搜索全部动作",

  // ── 动作面板（#27C） ────────────────────────────────────────
  "touTou.panel.title": "投投动作面板",
  "touTou.panel.pageSection": "本页动作",
  "touTou.panel.allSection": "全部动作",
  "touTou.panel.selectionSection": "选中的文本",
  "touTou.panel.searchPlaceholder": "搜索动作",
  "touTou.panel.empty": "没有匹配的动作",
  "touTou.panel.close": "关闭动作面板",
  "touTou.panel.sideAskPlaceholder": "顺便问一句，Alt+Enter 发送",
  "touTou.panel.sideAskSend": "发送侧问",
  "touTou.panel.sideAskHint": "侧问只回答这一次：不进对话、不写历史、不调用工具",
  "touTou.panel.sideAskEmpty": "先写下要问的内容",
  "touTou.panel.answerTitle": "投投的回答",
  "touTou.panel.asking": "投投正在想…",
  "touTou.panel.failed": "没答上来：{reason}",
  "touTou.panel.back": "返回动作列表",
  "touTou.panel.muted": "已关闭 {count} 类提示",
  "touTou.panel.restoreMuted": "恢复提示",

  // ── 划词动作（#27A） ────────────────────────────────────────
  "touTou.selection.bar": "选中文本动作",
  "touTou.selection.regionResume": "简历经历",
  "touTou.selection.regionJob": "岗位描述",
  "touTou.selection.regionClipboard": "剪贴板",
  "touTou.selection.regionText": "页面文本",
  "touTou.selection.rewrite": "改写这段话",
  "touTou.selection.star": "按 STAR 补结构",
  "touTou.selection.numbers": "找出可量化的数字",
  "touTou.selection.checkDuplicates": "查重复条目",
  "touTou.selection.jdMatch": "这条要求我够吗",
  "touTou.selection.keywords": "提取关键词",
  "touTou.selection.explain": "解释这段",
  "touTou.selection.copy": "复制",
  "touTou.selection.saveMaterial": "存进资料库",
  "touTou.selection.recognize": "识别填资料",
  "touTou.selection.asking": "投投正在看这段文字…",
  "touTou.selection.copied": "已复制这段文字",
  "touTou.selection.copyFailed": "复制失败，请手动复制",
  "touTou.selection.saved": "已存进资料库「{title}」",
  "touTou.selection.saveFailed": "存进资料库失败：{reason}",
  "touTou.selection.duplicateNone": "没有发现重复条目",
  "touTou.selection.duplicateFound": "发现 {count} 条疑似重复",
  "touTou.selection.duplicateCriteria":
    "判据：同一分区、锚点相等或前缀，且日期与角色不冲突（复用 #20）",
  "touTou.section.educations": "教育经历",
  "touTou.section.experiences": "工作经历",
  "touTou.section.campusExperiences": "校园经历",
  "touTou.section.projects": "项目经历",

  // ── 页面信号（#27B） ───────────────────────────────────────
  "touTou.signal.layoutOverflow.title": "这页装不下：约需 {needed} 页，上限 {limit} 页",
  "touTou.signal.layoutOverflow.action": "看怎么压到 {limit} 页",
  "touTou.signal.queueUnsupported.title": "队列里有 {count} 条岗位的来源不支持自动投递",
  "touTou.signal.queueUnsupported.action": "去看看这批岗位",
  "touTou.signal.profileMissing.title": "资料还缺 {count} 项关键信息",
  "touTou.signal.profileMissing.action": "去补资料",
  "touTou.signal.resumeUnsaved.title": "资料有未保存的修改",
  "touTou.signal.resumeUnsaved.action": "去保存",
  "touTou.signal.mute": "这类别再提示",
  "touTou.signal.muted": "已关闭这类提示",
  "touTou.signal.openPanel": "打开动作面板",

  // ── 提案卡与撤销（#27F，依赖 #13D） ────────────────────────
  "touTou.proposal.ariaLabel": "投投的操作提案",
  "touTou.proposal.title": "投投建议这样改",
  "touTou.proposal.writeTitle": "投投申请修改这些内容",
  "touTou.proposal.diffAdded": "新增",
  "touTou.proposal.diffRemoved": "删除",
  "touTou.proposal.before": "现在",
  "touTou.proposal.after": "改成",
  "touTou.proposal.apply": "按这个改",
  "touTou.proposal.reject": "先不改",
  "touTou.proposal.applied": "已按提案修改",
  "touTou.proposal.undo": "撤销这次修改",
  "touTou.proposal.undoHint": "整份简历恢复到版本 {version}，不是只撤这一个字段",
  "touTou.proposal.undone": "已恢复到版本 {version}",
  "touTou.proposal.failed": "这次没改成：{reason}",
  "touTou.proposal.undoFailed": "撤销失败：{reason}",
  "touTou.proposal.unsupported": "该操作暂不支持撤销",
  "touTou.proposal.pending": "预览与撤销的接线等助手写操作合入后启用",
} as const;

export default touTou;
