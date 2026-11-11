// SPDX-License-Identifier: Apache-2.0
/**
 * 版面状态的**唯一判据与唯一文案**（#24 24C）：占用率公式、页数推算、琥珀阈值、状态句。
 *
 * ## 为什么单独成文件
 *
 * 同一个数字要出现在两个地方：预览卡的诊断条（`ResumeDetailHead`）与制作台左栏的常驻
 * 状态条（`WorkbenchLayoutStatusBar`）。两份实现迟早在「分母算不算页边距」「四舍五入还是
 * 向上取整」「>100 还是 ≥100 才算警告」这些细节上分叉，而用户会把它当成 bug 报上来
 * （2026-11 #24 的一致性约束 1 就是这条）。
 *
 * 所以：公式在 {@link layoutFillPercent}（从 `ResumeDetailHead` 原来的第 107-111 行原样
 * 抽出来，行为逐字不变），阈值在 {@link FILL_ATTENTION_PERCENT} 与
 * {@link layoutNeedsAttention}，文案 key 只在 {@link layoutFillLabel} 与
 * {@link summarizeLayoutStatus} 里出现。**调用方不许自己再写一遍除法或再拼一遍句子。**
 *
 * ## 为什么本地算，不问后端
 *
 * 后端 `/layout/analyze` 的阈值（偏空 / 拥挤 / 溢出）只有它自己知道，但拖动滑杆时每动
 * 一格都问一次会把交互拖垮（#23 的 3.9s 教训）。制作台状态条只显示**本地算得出来的量**：
 * `占用率 = 正文高度 / (一页正文高 × 页数上限)`，与后端 `derive_pages` 同一个分数线；
 * 详细的结论（含"先动哪个旋钮"）留在弹层里，打开弹层时才请求。
 *
 * 代价是"偏空 / 拥挤"这两档在制作台看不到——它们是后端的判断，本地无法复现。不猜。
 */
import { t } from "../../i18n";
import type { LayoutMeasure } from "../../utils/resumeLayoutMeasure";
import type { PreviewLayoutStatus } from "../resume-preview/config";
import type { ResumeLayoutStatus } from "../../types";

/**
 * 占用率达到这个百分比就算"需要注意"（琥珀语义）。
 *
 * `100` 不是随手取的：预览卡里"溢出"的判据是后端 `status === "overflow"`，而本地能复现
 * 的等价条件是"正文比可用高度还高"，也就是 `usedHeight > pageContentHeight × pageLimit`，
 * 即占用率 **> 100%**。所以这里用严格大于，与后端口径对齐。
 */
export const FILL_ATTENTION_PERCENT = 100;

/**
 * 占用率百分比（四舍五入到整数）；算不出来时 `null`。
 *
 * 除法的分母是 `pageContentHeight × pageLimit`——**不是** `usedHeight / pageContentHeight`
 * 再除以别的页数：`pageLimit = 0`（"不限篇幅"）时没有分母，此时返回 `null` 而不是 0 或
 * Infinity（0 会被读成"版面是空的"，比没有结论更糟）。
 */
export function layoutFillPercent(measure: LayoutMeasure | null): number | null {
  if (!measure) return null;
  if (!(measure.pageContentHeight > 0) || !(measure.pageLimit > 0)) return null;
  const ratio = measure.usedHeight / (measure.pageContentHeight * measure.pageLimit);
  if (!Number.isFinite(ratio)) return null;
  return Math.round(ratio * 100);
}

/**
 * 占用率的**界面文案**（"占用 426%"）。预览卡的诊断徽标与制作台状态条用的是同一条 key。
 */
export function layoutFillLabel(measure: LayoutMeasure | null): string | null {
  const percent = layoutFillPercent(measure);
  return percent === null ? null : t("resume.diagnosis.fill", { percent });
}

/**
 * 内容实际需要几页。
 *
 * 优先用服务端分页报告（`layoutStatus.pagesNeeded`，`PreviewLayoutStatus` 的注释写明了
 * "服务端 pages_needed 优先"）：后端按真实 PDF 引擎排过，比浏览器的多列算法准。
 * 拿不到报告时退回本地推算 `ceil(usedHeight / pageContentHeight)`——少减一个极小数是
 * 为了让"刚好排满一页"不被浮点误差顶成两页（`100.0000001 → 2`）。
 */
export function layoutPagesNeeded(
  measure: LayoutMeasure | null,
  reported: number | null | undefined = null,
): number | null {
  if (typeof reported === "number" && Number.isFinite(reported) && reported > 0) {
    return Math.round(reported);
  }
  if (!measure || !(measure.pageContentHeight > 0)) return null;
  if (!Number.isFinite(measure.usedHeight) || measure.usedHeight <= 0) return 1;
  return Math.max(1, Math.ceil(measure.usedHeight / measure.pageContentHeight - 1e-6));
}

/** 超出所选页数上限几页（没超时为 0；`pageLimit = 0`（不限）时恒为 0）。 */
export function layoutOverflowPages(
  measure: LayoutMeasure | null,
  reported: number | null | undefined = null,
): number {
  if (!measure || !(measure.pageLimit > 0)) return 0;
  const needed = layoutPagesNeeded(measure, reported);
  if (needed === null) return 0;
  return Math.max(0, needed - measure.pageLimit);
}

/**
 * 会不会留琥珀色信号。
 *
 * 三个来源按**可信度**排序：
 * 1. 后端诊断状态（有就用它——它知道"偏空 / 拥挤"，本地不知道）；
 * 2. 画布报的溢出（后端诊断还没回来时的兜底，预览卡原本就是这个行为）；
 * 3. 本地占用率超过 {@link FILL_ATTENTION_PERCENT}（只有制作台会用到这里，因为它不问后端）。
 *
 * 健康（`healthy`）与未知（`unknown`）都不留颜色信号——那是"没问题"和"还说不准"，
 * 不该和警告用同一个视觉。
 */
export function layoutNeedsAttention(input: {
  status?: ResumeLayoutStatus | null;
  overflow?: boolean;
  fillPercent?: number | null;
}): boolean {
  const { status = null, overflow = false, fillPercent = null } = input;
  if (status) return status !== "healthy" && status !== "unknown";
  if (overflow) return true;
  return fillPercent !== null && fillPercent > FILL_ATTENTION_PERCENT;
}

/** 状态条要显示的全部数字（一次算完，调用方不再自己拆 `measure`）。 */
export interface LayoutStatusSummary {
  /** 占用率（整数百分比）；算不出来时 `null`。 */
  fillPercent: number | null;
  /** `占用 426%`（与预览卡逐字相同的 key）；算不出来时 `null`。 */
  badge: string | null;
  /** 内容需要几页；算不出来时 `null`。 */
  pagesNeeded: number | null;
  /** 页数上限；`0` = 不限篇幅。 */
  pageLimit: number;
  /** 超出几页（0 = 没超）。 */
  overflowPages: number;
  /** 是否需要琥珀色（见 `layoutNeedsAttention`）。 */
  attention: boolean;
  /**
   * 一整行状态句：`占用 426% · 需要 5 页 / 上限 1 页 · 超出 4 页`。
   * 还没量到版面时为 {@link layoutMeasuringText}。
   */
  summary: string;
}

/** "还没量到"的那句话（卡片首帧、iframe 尚未排版完都会经过这里）。 */
export function layoutMeasuringText(): string {
  return t("workbench.layoutStatus.measuring");
}

/**
 * 把实测高度折成状态条要的一整行。
 *
 * 三种句式（都是完整句子、占位符数量在中英包里一致）：
 * - 有超页：`占用 X% · 需要 N 页 / 上限 M 页 · 超出 K 页`
 * - 放得下：`占用 X% · 需要 N 页 / 上限 M 页`
 * - 不限篇幅：`占用 X% · 需要 N 页（篇幅不限）`
 */
export function summarizeLayoutStatus(input: {
  measure: LayoutMeasure | null;
  layoutStatus?: PreviewLayoutStatus | null;
}): LayoutStatusSummary {
  const { measure, layoutStatus = null } = input;
  const reported = layoutStatus?.pagesNeeded ?? null;
  const fillPercent = layoutFillPercent(measure);
  const pagesNeeded = layoutPagesNeeded(measure, reported);
  const pageLimit = measure && measure.pageLimit > 0 ? measure.pageLimit : 0;
  const overflowPages = layoutOverflowPages(measure, reported);
  const attention = layoutNeedsAttention({
    overflow: Boolean(layoutStatus?.overflow) || overflowPages > 0,
    fillPercent,
  });
  const badge = fillPercent === null ? null : t("resume.diagnosis.fill", { percent: fillPercent });
  let summary = layoutMeasuringText();
  if (pageLimit === 0 && pagesNeeded !== null) {
    // 不限篇幅：没有分母就**没有占用率**（`layoutFillPercent` 返回 null），这时只报页数，
    // 不编造一个百分比——左栏显示"占用 0%"比不显示更误导。
    summary = t("workbench.layoutStatus.summaryUnlimited", { pages: pagesNeeded });
  } else if (fillPercent !== null && pagesNeeded !== null) {
    if (overflowPages > 0) {
      summary = t("workbench.layoutStatus.summaryOverflow", {
        percent: fillPercent,
        pages: pagesNeeded,
        limit: pageLimit,
        over: overflowPages,
      });
    } else {
      summary = t("workbench.layoutStatus.summary", {
        percent: fillPercent,
        pages: pagesNeeded,
        limit: pageLimit,
      });
    }
  }
  return { fillPercent, badge, pagesNeeded, pageLimit, overflowPages, attention, summary };
}
