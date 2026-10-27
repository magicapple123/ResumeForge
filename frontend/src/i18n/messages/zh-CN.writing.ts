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
