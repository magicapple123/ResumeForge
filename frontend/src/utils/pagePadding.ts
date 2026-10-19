/** 简历页边距（mm）：取值的唯一合法范围，以及"写进哪一处"的唯一实现（R1）。
 *
 * 为什么单独成文件：`react-refresh` 要求组件文件只导出组件；更重要的是这个范围必须
 * 与后端 `FORMAT_FIELDS.page_padding` 的 min/max **逐字一致**——两边不一致的表现是
 * "面板设了 30mm，导出还是默认值"（越界值被后端白名单整条丢弃），最难被发现的一类失败。
 */
import type { ResumeFormatConfig } from "../types/resumeFormat";

/** 与后端 `services/resume/resume_template_format.py` 的 page_padding min 一致。 */
export const MIN_PAGE_PADDING = 8;
/** 与后端 `services/resume/resume_template_format.py` 的 page_padding max 一致。 */
export const MAX_PAGE_PADDING = 26;

/** 把任意数字收进 8–26 并取整；NaN 一并挡在外面（回落到下限而不是把 NaN 发出去）。 */
export function clampPagePadding(value: number): number {
  if (!Number.isFinite(value)) return MIN_PAGE_PADDING;
  return Math.min(MAX_PAGE_PADDING, Math.max(MIN_PAGE_PADDING, Math.round(value)));
}

/**
 * 把导出面板的「页边距」写进预览与导出共用的那一处：`format_config.page_padding`。
 *
 * R1 之前面板写的是 `ExportRequest.margin_mm`——那个字段只有 PDF/Word 读，预览与 HTML
 * 只认 `page_padding`，于是"改面板值预览不变、PDF 变"。现在**只有一个落点**：面板值按
 * 8–26 clamp 后覆盖在预览草稿之上；`null` 表示用户没动它，原样透传预览的值（不凭空
 * 造一个 page_padding，否则"跟预览"会变成"盖掉预览"）。
 */
export function withPagePadding(
  base: ResumeFormatConfig | undefined,
  pagePadding: number | null,
): ResumeFormatConfig | undefined {
  if (pagePadding === null) return base;
  return { ...(base ?? {}), page_padding: clampPagePadding(pagePadding) };
}
