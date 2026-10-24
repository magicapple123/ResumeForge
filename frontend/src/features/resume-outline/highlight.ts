// SPDX-License-Identifier: Apache-2.0
/**
 * 大纲选中对象 → 画布高亮的**纯计算**部分（DOM 注入在
 * `components/resume/outline/useOutlineCanvasHighlight.ts`）。
 *
 * 画布是"后端模板渲染出的 HTML"的 iframe：每处文字都有 `data-resume-path`
 * （`_resume_sections.j2` / `_resume_blocks.j2`），所以高亮不需要重新渲染，只要按路径
 * 选择器注入一条样式。规则：
 *
 * - **条目级**用前缀匹配（`[data-resume-path^="experience.1."]`）：条目下的公司名、日期、
 *   每条要点都会亮——用户点的是"这条经历"，不是一个字段；
 * - **要点级**用精确匹配（`...description.0`）；
 * - **个人信息**展开成它实际有值的标量路径（空字段在模板里根本不存在，写进选择器也没用）。
 *
 * ## 为什么用 currentColor 而不是 `--rf-*`
 *
 * iframe 里是独立的简历文档（后端 HTML），**没有**应用的 `--rf-*` 变量；把深色主题的
 * token 名写进去只会得到透明背景。用 `color-mix(in srgb, currentColor …)` 从纸面文字色
 * 派生高亮，深浅主题下都成立，也避免在 JS 里硬编码色值（colorGuard 的口径）。
 */
import type { ResumeContent } from "../../types/resume";
import { entriesOf, findEntryIndex, pointIdsOf, PERSONAL_FIELDS } from "./model";
import type { OutlineHighlightTarget, OutlineSelection } from "./types";

export type { OutlineHighlightTarget };

/** 注入到每个 iframe 的 `<style>` 的 id；重复注入时按它替换而不是叠加。 */
export const OUTLINE_HIGHLIGHT_STYLE_ID = "rf-outline-highlight";

/**
 * 高亮声明。颜色全部从 `currentColor` 派生：纸面正文色是模板定的，我们只加一层淡淡底色
 * 与一圈描边；两个强度值改这一处即可。
 */
export const OUTLINE_HIGHLIGHT_DECLARATION =
  "background: color-mix(in srgb, currentColor 14%, transparent); " +
  "box-shadow: 0 0 0 1px color-mix(in srgb, currentColor 45%, transparent); " +
  "border-radius: 2px";

/** 路径只允许模板里真实出现的字符集（字母/数字/下划线/点），杜绝把用户数据拼进选择器。 */
const SAFE_PATH = /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/;

/** 选中对象对应的画布高亮目标（顺序稳定：先条目/要点本身，不依赖对象键序）。 */
export function resolveHighlightTargets(
  content: ResumeContent | null | undefined,
  selection: OutlineSelection | null | undefined,
): OutlineHighlightTarget[] {
  if (!content || !selection) return [];
  if (selection.kind === "personal") {
    const targets: OutlineHighlightTarget[] = [];
    for (const field of PERSONAL_FIELDS) {
      const value = content[field];
      if (typeof value === "string" && value.trim() !== "")
        targets.push({ path: field, prefix: false });
    }
    return targets;
  }
  const index = findEntryIndex(content, selection.field, selection.objectId);
  if (index < 0) return [];
  if (selection.kind === "entry") return [{ path: `${selection.field}.${index}`, prefix: true }];
  const entry = entriesOf(content, selection.field)[index];
  const pointIndex = pointIdsOf(entry, selection.pointField).indexOf(selection.pointId);
  if (pointIndex < 0) return [];
  return [
    {
      path: `${selection.field}.${index}.${selection.pointField}.${pointIndex}`,
      prefix: false,
    },
  ];
}

/**
 * 生成注入 iframe 的 CSS 文本。没有目标时返回空串（调用方据此清除旧样式）。
 *
 * 非法路径直接跳过而不是转义：路径来自我们自己的内容结构，出现非法字符说明调用方传错了，
 * 静默生成一条匹配不到任何东西的选择器只会掩盖问题。
 */
export function buildOutlineHighlightCss(
  targets: readonly OutlineHighlightTarget[],
  declaration: string = OUTLINE_HIGHLIGHT_DECLARATION,
): string {
  const rules: string[] = [];
  for (const target of targets) {
    if (!SAFE_PATH.test(target.path)) continue;
    const selector = target.prefix
      ? `[data-resume-path^="${target.path}."]`
      : `[data-resume-path="${target.path}"]`;
    rules.push(`${selector} { ${declaration}; }`);
  }
  return rules.join("\n");
}
