// SPDX-License-Identifier: Apache-2.0
/**
 * 版式预设切换的纯计算：换版式时写 `format_name`，并清掉会被该预设覆盖的手动微调。
 *
 * 从 `components/resume/ResumeTemplateControls.tsx` 拆出来（2026-10-23）：那个文件是
 * 组件文件，再导出普通函数会让 `react-refresh/only-export-components` 失效。这个函数
 * 与 React 无关，拆出来之后 `formatPresetSwitch.test.ts` 断言的仍是同一份实现。
 */
import type { ResumeFormatConfig, ResumeLayout } from "../../types";

/**
 * 版式预设会覆盖的键。换版式时先清掉这些**手动覆盖**，让预设真正生效
 * （优先级：模板默认 < 版式预设 < 手动微调，手动值不清就会盖住新预设）。
 * 字号（`font_scale_adjust`）不在其中：预设本来就不管字号，用户调过的大小应当保留。
 *
 * ## 2026-10-23 补齐 5 个键
 *
 * `text_color` / `muted_color` 是**既有遗漏**：它们在 `FORMAT_FIELDS` 里、也进指纹，却
 * 一直没进这张表——于是"选一个配色不同的版式，发现文字颜色没变"，正是这条表要消灭的
 * 老问题（PRD §7.3 第 2 条）。
 *
 * 三个新系数（`name_scale` / `section_title_scale` / `entry_gap`）同理：版式预设不一定带
 * 它们，但用户手动调过的值留着就会盖住"紧凑"这类预设——切了版式却只改了名字，是同一个
 * 缺陷的另一种表现。
 */
const PRESET_OVERRIDABLE_KEYS = [
  "line_height",
  "page_padding",
  "section_gap",
  "accent",
  "line_color",
  "text_color",
  "muted_color",
  "name_scale",
  "section_title_scale",
  "entry_gap",
] as const;

/**
 * 换版式时算出新的 layout：写 `format_name`，并清掉会被这个预设覆盖的手动微调。
 *
 * 为什么必须清：渲染优先级是"模板默认 < 版式预设 < 手动微调"。用户之前拖过行距，
 * `format_config.line_height` 就一直是手动值，选「紧凑」也只是改了个名字——
 * 预览、滑杆都不会动。清掉之后滑杆回到预设值，用户想再微调还可以继续拖。
 */
export function layoutWithFormatPreset(
  layout: ResumeLayout,
  formatName: string,
  presets: { name: string; config: ResumeFormatConfig }[],
): ResumeLayout {
  const preset = presets.find((item) => item.name === formatName);
  const rest: Record<string, unknown> = { ...(layout.format_config ?? {}) };
  for (const key of PRESET_OVERRIDABLE_KEYS) delete rest[key];
  for (const key of Object.keys(preset?.config ?? {})) delete rest[key];
  return { ...layout, format_name: formatName, format_config: rest as ResumeFormatConfig };
}
