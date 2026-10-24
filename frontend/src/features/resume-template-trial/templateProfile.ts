// SPDX-License-Identifier: Apache-2.0
/**
 * W10 的模板档案：**只投影目录与代码里能证实的事实**，不另写一份能力矩阵。
 *
 * ## 两类信息，两个唯一来源
 *
 * 1. **模板档**（本文件）：篇幅档与标题字族。
 *    - 篇幅：后端 `resume_sample.density_group` 的判据是"模板默认行高 < 1.6 → roomy
 *      （一页装得多）"，取自 `TEMPLATE_LAYOUT_DEFAULTS` 实测。这里用目录下发的
 *      `template_layouts.line_height` 走**同一判据**，不写死模板名、不抄第二份数字。
 *    - 标题字族：目录下发的 `serif_heading`（衬线标题与精确 PDF 内置黑体不同）。
 *    - 照片：内置模板共享 `_resume_sections.j2` 的照片位点；自制模板取决于用户 HTML。
 * 2. **格式能力**（W11 的 `format_capabilities` 矩阵，经检查接口下发）：斜体/链接/
 *    分页/间距等"某个格式支不支持"的问题一律读矩阵，见 `TrialCapabilityStrip`。
 *
 * 所以本文件里**没有**"某模板导出支持什么""栏目几列"这类判定：目录没有下发栏目字段，
 * 而格式差异属于矩阵口径——在这里补一份就是第二套真相（lead 已明确要求引用矩阵）。
 */
import type { ResumeTemplateCatalog, ResumeTemplateOption } from "../../types";
import type { MessageKey } from "../../i18n";

/** 篇幅档：roomy = 行高小、一页装得多；regular = 常规；null = 目录没给基准。 */
export type TemplateDensity = "roomy" | "regular" | null;

export interface TemplateCapability {
  density: TemplateDensity;
  /** 照片位点：内置模板一定有；自制模板取决于用户自己的 HTML。 */
  photo: "builtin" | "custom";
  /** 已知模板档差异（来自目录 `serif_heading`；空数组 = 没有记录）。 */
  limitations: MessageKey[];
}

/** 后端 `resume_sample._ROOMY_LINE_HEIGHT` 的同值判据（两处注释互指）。 */
export const ROOMY_LINE_HEIGHT = 1.6;

/** 目录里某个模板的默认行高（旧后端没下发 → `null`，界面不猜）。 */
export function templateLineHeight(
  catalog: ResumeTemplateCatalog | undefined | null,
  template: string,
): number | null {
  const layout = catalog?.template_layouts?.[template];
  const value = layout?.line_height;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** 篇幅档：与后端 `density_group` 同判据（< 1.6 → roomy）。 */
export function templateDensity(
  catalog: ResumeTemplateCatalog | undefined | null,
  template: string,
): TemplateDensity {
  const lineHeight = templateLineHeight(catalog, template);
  if (lineHeight === null) return null;
  return lineHeight < ROOMY_LINE_HEIGHT ? "roomy" : "regular";
}

/** 模板档已知差异（目前只有目录能证实的标题字族差异）。 */
export function templateLimitations(
  option: Pick<ResumeTemplateOption, "serif_heading">,
): MessageKey[] {
  return option.serif_heading ? ["trial.limit.serif"] : [];
}

/** 一张卡片/一栏的模板档摘要。 */
export function templateCapability(
  option: Pick<ResumeTemplateOption, "name" | "custom" | "serif_heading">,
  catalog: ResumeTemplateCatalog | undefined | null,
): TemplateCapability {
  return {
    density: templateDensity(catalog, option.name),
    photo: option.custom ? "custom" : "builtin",
    limitations: templateLimitations(option),
  };
}

/**
 * 可对比的模板清单：目录里的模板，**并保证当前使用中的模板在列表里**。
 *
 * 旧记录可能用过一个已从选择器下线的模板（如 scholar / technical）：对比时左侧要能显示
 * "你现在用的是哪套"，不能因为它不在目录里就变成空白选项。
 */
export function templateChoices(
  catalog: ResumeTemplateCatalog | undefined | null,
  currentTemplate: string,
): ResumeTemplateOption[] {
  const templates = catalog?.templates ?? [];
  if (!currentTemplate || templates.some((item) => item.name === currentTemplate)) {
    return [...templates];
  }
  return [{ name: currentTemplate, label: currentTemplate, description: "" }, ...templates];
}
