// SPDX-License-Identifier: Apache-2.0
/**
 * 写作增强面板与划词右键菜单的展示文案：动作名、润色风格、翻译方向、话术版式、
 * 输入区的占位符与无障碍名、结果块标题，以及文本操作菜单的六个名字。
 *
 * 早期那批 `writing.hint.*` / `writing.action.apply` / `writing.action.copy` 等 key
 * 留在 `zh-CN.params.ts`；本包只收本次新增的、带二级前缀的 key，不与它们重名。
 */
const writing = {
  // ── 写作增强：动作选择器（Segmented）──────────────────────
  "writing.operation.star": "STAR 改写",
  "writing.operation.phrases": "话术生成",
  "writing.operation.polish": "风格润色",
  "writing.operation.translate": "中英互译",

  // ── 润色风格（单选组）────────────────────────────────────
  "writing.style.bigTech": "大厂风",
  "writing.style.conciseTech": "简洁干练风",
  "writing.style.campus": "应届生风",
  /** 单选组的无障碍名：视觉上它紧贴动作选择器，没有可见标题。 */
  "writing.style.ariaLabel": "润色风格",

  // ── 翻译方向（单选组）────────────────────────────────────
  "writing.direction.zh2en": "中译英",
  "writing.direction.en2zh": "英译中",
  /** 单选组的无障碍名。 */
  "writing.direction.ariaLabel": "翻译方向",

  // ── 话术版式（多选组与结果块标题共用）──────────────────────
  "writing.phraseMode.star": "STAR 版",
  "writing.phraseMode.resume": "简历版",
  "writing.phraseMode.interview": "面试口述版",
  /** 多选组的无障碍名。 */
  "writing.phraseMode.ariaLabel": "话术版式",

  // ── 输入区与结果块 ──────────────────────────────────────
  "writing.input.placeholder": "粘贴或输入一段简历描述",
  /** 输入框的无障碍名（它没有可见标签）。 */
  "writing.input.ariaLabel": "写作输入文本",
  "writing.action.generate": "生成",
  /** 生成失败且拿不到更具体的原因时的兜底。 */
  "writing.generate.failed": "生成失败，请重试",
  /** 单个结果块的标题。 */
  "writing.result.label": "结果",
  /** 结果框的无障碍名：它现在是可编辑的，说明要带上"能改"。 */
  "writing.result.ariaLabel": "生成结果，可直接编辑",
  /** 当前版本被用户手动改过时，结果区标题旁的小标记。 */
  "writing.result.edited": "已修改",
  /** 版本条上的版本号：v1 / v2 / …（字母 v 在两种语言里都这么写）。 */
  "writing.version.label": "v{index}",
  /** 版本条的无障碍名。 */
  "writing.version.ariaLabel": "结果版本",

  // ── 结果微调（polish-selection）──────────────────────────
  /** 微调区的小标题，后面跟着四个 chip。 */
  "writing.refine.label": "在这版上继续改：",
  "writing.refine.shorter": "更短",
  "writing.refine.specific": "更具体",
  "writing.refine.colloquial": "更口语",
  "writing.refine.quantify": "加量化",
  "writing.refine.customPlaceholder": "自定义要求，例如「突出增长数据」",
  /** 自定义要求输入框的无障碍名（占位符只是举例，不能当标签用）。 */
  "writing.refine.customAriaLabel": "自定义改写要求",
  "writing.refine.submit": "按我的要求改",
  /** 微调失败：结果区保持上一版，所以提示里要说清"原结果还在"。 */
  "writing.refine.failed": "微调失败，已保留原结果",

  // ── 用法提示的展开/收起（默认收起，见 ResumeWritingPanel）──
  "writing.hint.expand": "展开用法",
  "writing.hint.collapse": "收起",

  // ── 划词右键菜单 ────────────────────────────────────────
  /** 菜单容器的无障碍名。 */
  "writing.contextMenu.ariaLabel": "文本操作",
  "writing.contextMenu.cut": "剪切",
  "writing.contextMenu.copy": "复制",
  "writing.contextMenu.paste": "粘贴",
  "writing.contextMenu.selectAll": "全选",
  "writing.contextMenu.aiPolish": "AI 润色",
} as const;

export default writing;
