// SPDX-License-Identifier: Apache-2.0
/**
 * 多分辨率适配新增的界面文案（2026-10-23）。
 *
 * 单独成文件的两个原因：
 * 1. `zh-CN.ts` 已 463 行，逼近 500 行预算——本轮文案再塞进去就顶格；
 * 2. `i18n/messages/**` 是 `cjkRatchet` 的**迁移目的地**（被排除在扫描外），
 *    新增文案写在这里天然合规，不需要行内豁免。
 *
 * key 前缀统一 `responsive.`：一眼能看出属于"不同视口下的形态"而不是某个业务域。
 * 助手外壳（页头说明、浮窗历史、回到底部）的通用文案也在本包的 `responsive.assistant.*`
 * 下：这些控件会随档位在页内 / 抽屉 / 浮层之间换位置，归"形态"比归某个业务域更贴切。
 */
const responsive = {
  /** 制作台动作条：单栏时打开左栏参数抽屉。 */
  "responsive.action.params": "排版参数",
  /** 制作台动作条：两栏/单栏时打开中栏内容抽屉。 */
  "responsive.action.editContent": "编辑内容",
  /** 参数抽屉标题。 */
  "responsive.drawer.params.title": "排版参数",
  /** 内容抽屉标题。 */
  "responsive.drawer.content.title": "内容编辑",
  /** A4 画布触底后的缩放读数：`55% · 已到最小可读缩放`。 */
  "responsive.a4.minScaleLabel": "{value}% · 已到最小可读缩放",
  /** 触底提示：解释"纸比窗口大"不是坏了，并给两条出路。 */
  "responsive.a4.minScaleHint": "窗口太窄，可拖动查看整页，或放大窗口、收起侧栏",
  /** 简历中心 · 卡片视图（<1092）的排序与动作。 */
  "responsive.resumes.sort": "排序",
  "responsive.resumes.sort.updated": "最近修改",
  "responsive.resumes.sort.created": "创建时间",
  "responsive.resumes.sort.title": "标题",
  "responsive.resumes.sort.job": "目标岗位",
  "responsive.resumes.card.meta": "更新于 {time}",
  "responsive.resumes.order.asc": "升序",
  "responsive.resumes.order.desc": "降序",
  "responsive.resumes.select.page": "全选本页",
  "responsive.resumes.select.none": "取消全选",
  "responsive.resumes.select.one": "选择这份简历",
  "responsive.resumes.total": "共 {count} 条",
  "responsive.resumes.empty": "暂无简历",
  "responsive.resumes.general": "通用简历",
  "responsive.resumes.preview": "预览 / 导出",
  "responsive.resumes.rename": "重命名",
  "responsive.resumes.note": "编辑备注",
  "responsive.resumes.favorite": "收藏",
  "responsive.resumes.unfavorite": "取消收藏",
  "responsive.resumes.remove": "删除",
  "responsive.resumes.remove.confirm": "删除这份简历？",
  "responsive.resumes.remove.body": "删除后可以在回收站恢复；{note}",
  /** 二次确认按钮必须写具体动作（AGENTS 禁用「确定/取消」泛动词）：确认 = 删除对象。 */
  "resumes.remove.confirm.ok": "删除这份简历",
  /** 取消侧同样写具体动作（不删这份，而不是泛泛的「取消」）。 */
  "resumes.remove.confirm.cancel": "先不删",
  "responsive.resumes.more": "更多操作",
  /** 助手历史会话（平板档收进抽屉）：页头按钮与抽屉标题。 */
  /** 浮窗里的短标签（与抽屉的长标签区分）。 */
  "responsive.assistant.historyShort": "历史",
  "responsive.assistant.history": "历史会话",
  /** 助手历史会话抽屉标题。 */
  "responsive.assistant.history.title": "历史会话",

  /** 助手页头：会话还没有标题时的兜底标题。 */
  "responsive.assistant.defaultTitle": "AI 求职助手",
  /** 助手消息旁的显示名（整页形态）。 */
  "responsive.assistant.label": "求职助手",
  /** 助手消息旁的显示名（浮窗形态，用吉祥物的名字）。 */
  "responsive.assistant.shortLabel": "投投",
  /** 页头说明：回复用的模型来自设置页。 */
  "responsive.assistant.headerNote": "当前回复由「设置」中的模型配置提供。",
  /** 浮窗历史按钮的无障碍名。 */
  "responsive.assistant.aria.history": "查看投投历史",
  /** 浮窗历史层背板的关闭入口（键盘用户除 Esc 之外的出口）。 */
  "responsive.assistant.aria.closeHistory": "关闭历史记录",
  /** 流式期间上翻后出现的「回到底部」按钮（aria-label 与 title 共用一条）。 */
  "responsive.assistant.scrollBottom": "回到底部",
} as const;

export default responsive;
