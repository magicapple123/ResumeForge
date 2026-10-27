// SPDX-License-Identifier: Apache-2.0
/**
 * 投投悬浮球（TouTou）：浮窗助手外壳、剪贴板片段夹、球体按钮提示、去改资料提示卡、
 * 保存浮卡、低打扰提示气泡与轮换标语。
 *
 * 助手卡片内嵌的侧栏助手页面能力不在这里——那部分归 `assistantUi`。本包只有投投这一层
 * 外壳的界面文案；标语表（`touTouTips.ts`）只存 key，渲染方在渲染期取文案。
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
  "touTou.orb.tooltip": "单击：打开求职助手；双击：打开投递剪贴板",
  "touTou.orb.ariaLabel": "打开求职助手",

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

  // ── 轮换标语（touTouTips） ──────────────────────────────────
  "touTou.tips.results": "写经历时优先交代结果，再补充你采取的动作和可核对的证据。",
  "touTou.tips.verbs": "JD 里反复出现的动词，通常就是简历筛选时最值得对齐的重点。",
  "touTou.tips.numbers": "简历里的每个数字都要能解释口径，面试官很可能会顺着数字追问。",
  "touTou.tips.applyMatch": "投递前确认岗位、简历版本和附件是否匹配，能少掉很多低级失误。",
  "touTou.tips.star": "面试答案可以先按 STAR 写骨架，再补上你的取舍、边界和复盘。",
  "touTou.tips.facts": "不确定一段经历怎么写时，可以让投投先查事实台账，再给出保守表述。",
  "touTou.tips.context": "简历通的助手支持关联岗位和简历，提问时带上上下文，建议会更具体。",
  "touTou.tips.verify": "生成结果先核对事实和个人边界，再导出或投递；AI 不能替你确认真实经历。",
} as const;

export default touTou;
