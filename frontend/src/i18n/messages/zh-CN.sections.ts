// SPDX-License-Identifier: Apache-2.0
/**
 * 简历版式控件 · 第一组「结构类」的界面文案：模板 / 版式 / 板块顺序 / 最大篇幅
 * （components/resume/ResumeTemplateControls.tsx）。
 *
 * 既有 sections.*（「按我的资料顺序排列」按钮与它的悬停说明）住在 zh-CN.fontDownload.ts；
 * 本文件新增的 key 一律带 templateControls 二级前缀，与它们区分开，不会重名。
 */
const sections = {
  // ── 模板 ─────────────────────────────────────────────
  /** 分组标签。 */
  "sections.templateControls.templateLabel": "模板",
  /** 未选中模板时的悬停说明。 */
  "sections.templateControls.templateTooltip": "打开模板预览，直接看到每种模板的真实效果",
  /** 已选中模板时，把模板自带的说明（description 来自后端目录）接在同一个提示里。 */
  "sections.templateControls.templateTooltipWithDescription":
    "{description}。点击打开预览，直接看到每种模板的真实效果",
  /** 模板按钮的无障碍名（工具栏里有两个下拉，按名字定位才稳）。 */
  "sections.templateControls.templateAriaLabel": "选择简历模板并预览效果",
  /** 自制模板 / 版式名字后面的后缀；英文值带前导空格，与名字之间留出间隔。 */
  "sections.templateControls.customSuffix": "（自制）",

  // ── 版式 ─────────────────────────────────────────────
  /** 分组标签（与 resume.format.label 同一个词）。 */
  "sections.templateControls.formatLabel": "版式",
  /** 版式下拉的悬停说明。 */
  "sections.templateControls.formatHint":
    "版式控制行高、页边距与强调色；可以在工作台里自制更多版式",
  /** 版式下拉的第一项：不覆盖模板自带的版式。 */
  "sections.templateControls.followTemplate": "跟随模板",

  // ── 板块顺序 ─────────────────────────────────────────
  /** 分组标签。 */
  "sections.templateControls.sectionsLabel": "板块",
  /** 顺序弹层的标题。 */
  "sections.templateControls.orderTitle": "调整板块顺序",
  /** 弹层里的链接按钮：清掉自定义顺序，回到默认排列。 */
  "sections.templateControls.orderReset": "恢复默认",
  /** 顺序列表的无障碍名。 */
  "sections.templateControls.orderListAriaLabel": "简历板块顺序",
  /** 触发按钮的无障碍名。 */
  "sections.templateControls.orderTriggerAriaLabel": "调整简历板块顺序",
  /** 顺序弹层里的主动同步动作。 */
  "sections.templateControls.orderSyncProfile": "与资料顺序同步",
  /** 触发按钮的悬停说明：点明调整的是哪些板块。 */
  "sections.templateControls.orderTriggerHint":
    "调整个人总结、教育经历、项目经历等板块在简历里的先后顺序",
  /** 触发按钮的文字（未调整）。 */
  "sections.templateControls.orderTrigger": "顺序",
  /** 触发按钮的文字（已调整）：标出这份简历有自己的顺序。 */
  "sections.templateControls.orderTriggerAdjusted": "顺序·已调整",
  /** 列表行的上移按钮悬停说明。 */
  "sections.templateControls.orderMoveUp": "上移",
  /** 上移按钮的无障碍名：必须带上板块名，读屏才知道移的是哪一个。 */
  "sections.templateControls.orderMoveUpAria": "把{label}上移",
  /** 列表行的下移按钮悬停说明。 */
  "sections.templateControls.orderMoveDown": "下移",
  /** 下移按钮的无障碍名。 */
  "sections.templateControls.orderMoveDownAria": "把{label}下移",
  /** 列表底部的常驻说明：顺序影响哪些产物、页眉为什么不在排序范围内。 */
  "sections.templateControls.orderHint":
    "顺序对预览、PDF、Word 与文本导出同时生效；页眉（姓名、求职意向、联系方式）固定在最前。",
  /** 自建板块行的固定位置标签（渲染器固定排在系统板块之后）。 */
  "sections.templateControls.customFixedTag": "固定末尾",
  "sections.templateControls.customFixedHint": "自建板块固定排在系统板块之后",
  /** 正文没有任何可排序板块时的空态。 */
  "sections.templateControls.orderEmpty": "当前简历还没有可排序的内容板块",

  // ── 最大篇幅 ─────────────────────────────────────────
  /** 分组标签（与 bilingual.layout.pages 同一个词）。 */
  "sections.templateControls.pageLimitLabel": "最大篇幅",
  /** 段控的悬停说明：说清最多几页，以及内容少时不会硬撑满。 */
  "sections.templateControls.pageLimitHint":
    "简历内容最多排几页 A4；内容少时会自然留白，不会硬撑满",
  /** 段控的每一项：2 页。 */
  "sections.templateControls.pageLimitPages": "{count} 页",
} as const;

export default sections;
