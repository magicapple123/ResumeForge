// SPDX-License-Identifier: Apache-2.0
/**
 * 「试用模板」（W10 / P1-05）这一批**新增**的界面文案。
 *
 * 拆法与其他领域一致：扁平点分 key、一个默认导出、`as const`；登记到
 * `messages/zh-CN.namespaces.ts`（import + spread 各一行），主文件 `zh-CN.ts` 不动。
 *
 * ## 术语
 *
 * - **模板** = 外观骨架；**版式** = 参数预设；**排版参数** = 行距/页边距/字号等数值；
 *   **版面** = 排出来的效果。试用只说"模板"，覆盖只说"排版覆盖"。
 * - 页数措辞与制作台/精确预览同一套：「按当前设置约需 N 页（上限 M 页）」，不写
 *   "示例放得下"这类会误导的结论——示例内容**不测页数**，测的是用户当前内容。
 */

const trial = {
  // ── 视图切换与标题 ─────────────────────────────────────────
  /** 模板一览工具条上的入口按钮。 */
  "trial.action.open": "试用与对比",
  /** 单张模板卡片上的入口：只试用这一套。 */
  "trial.action.try": "试用模板",
  /** 对比视图的返回入口。 */
  "trial.action.back": "返回模板一览",
  /** 对比视图的退出（不改任何东西）。 */
  "trial.action.cancel": "退出试用",
  /** 对比视图标题。 */
  "trial.title": "试用与对比",
  /** 对比视图的一句话说明。 */
  "trial.hint": "并排比较两套模板，正文与排版参数一致",

  // ── 预览内容：示例 / 我的内容 ───────────────────────────────
  "trial.mode.label": "预览内容",
  "trial.mode.demo": "示例内容",
  "trial.mode.current": "我的内容",
  /** 没有简历记录时只能看示例（禁用態的说明）。 */
  "trial.mode.unavailable": "当前没有可用的简历内容，只能看示例",
  /** 示例模式的诚实说明：不测页数。 */
  "trial.mode.demoNote": "示例内容只用于看模板外观，不测你的篇幅",
  /** 当前内容模式的说明。 */
  "trial.mode.currentNote": "按当前内容真实排版测量页数",

  // ── 两侧的选择器 ───────────────────────────────────────────
  "trial.side.left": "左侧",
  "trial.side.right": "右侧",
  "trial.template.label": "模板",
  "trial.badge.current": "使用中",
  "trial.badge.trial": "试用中",

  // ── 排版覆盖：保留 / 重设 ───────────────────────────────────
  "trial.override.label": "排版覆盖",
  "trial.override.keep": "保留当前排版覆盖",
  "trial.override.keepHint": "行距、颜色等手动参数继续生效",
  "trial.override.reset": "采用模板默认",
  "trial.override.resetHint": "清空手动排版覆盖，回到模板默认参数",
  /** 宿主没有提供"清空覆盖"的通道：如实禁用而不是假装生效。 */
  "trial.override.unavailable": "当前入口不支持重设覆盖，请先在排版参数里清空",

  // ── 采纳 ───────────────────────────────────────────────────
  "trial.adopt": "用这个模板",
  /** 已经是当前模板：按钮禁用说明。 */
  "trial.adopt.disabled": "已经是当前模板",
  /** 采纳成功提示（Toast ≤20 字，含对象）。 */
  "trial.adopt.done": "已换用「{name}」",

  // ── 页数测量（真实 PDF 口径）─────────────────────────────────
  "trial.measure.loading": "正在测量页数",
  "trial.measure.failed": "页数测量失败",
  /** 与制作台/精确预览同一套措辞。 */
  "trial.measure.pages": "按当前设置约需 {pages} 页（上限 {limit} 页）",
  /** 没有 pagesNeeded（旧后端）时退回实排页数。 */
  "trial.measure.pagesPlain": "实际 {pages} 页（上限 {limit} 页）",
  /** 溢出提示：导出会截断到上限。 */
  "trial.measure.overflow": "超出上限，导出会截断到上限页",
  /** 示例模式不测页数的原因（放在测量位）。 */
  "trial.measure.demo": "示例内容不测页数",
  /** 当前内容还没保存过（没有简历 id），PDF 测量无从谈起。 */
  "trial.measure.unsaved": "当前内容还没保存过，无法测量页数",

  // ── 预览加载 ───────────────────────────────────────────────
  "trial.preview.loading": "正在渲染预览",
  "trial.preview.failed": "预览渲染失败",
  "trial.preview.retry": "重试",

  // ── 模板能力卡片（图库与对比共用）────────────────────────────
  "trial.density.label": "篇幅",
  /** 后端 density_group 的 roomy 档：行高小、一页装得多。 */
  "trial.density.roomy": "适合内容多",
  "trial.density.regular": "适合常规篇幅",
  "trial.photo.label": "照片",
  "trial.photo.builtin": "支持",
  "trial.photo.custom": "取决于自制模板",
  "trial.columns.label": "栏目",
  "trial.columns.single": "单栏",
  "trial.columns.grid": "技能网格",
  "trial.export.label": "导出",
  "trial.export.all": "HTML / PDF / Word",
  /** Word 的结构近似说明（一句话，放在对比视图脚注）。 */
  "trial.export.wordNote": "Word 保留结构与文字，不承诺与模板像素一致",

  // ── 格式能力（矩阵口径，W11 下发）────────────────────────────
  "trial.capability.title": "格式能力",
  "trial.capability.allSupported": "HTML / PDF / Word 均支持",
  "trial.capability.pending": "格式能力矩阵暂不可用",
  "trial.capability.more": "导出与格式差异见「试用与对比」",

  // ── 已知格式差异 ───────────────────────────────────────────
  "trial.limit.title": "已知差异",
  "trial.limit.serif": "标题为衬线字族，精确 PDF 用内置黑体，字形可能不同",
  "trial.limit.none": "没有已知格式差异",
} as const;

export default trial;
