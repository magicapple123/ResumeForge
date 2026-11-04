// SPDX-License-Identifier: Apache-2.0
/**
 * 画布页数的**唯一口径**（问题 2 + 问题 3）。
 *
 * 这里只做一件事：把三个来源合成一组数，让"画几张纸 / 提示几页 / 哪几页不计入导出"
 * 不可能各算各的。
 *
 * | 来源 | 是什么 | 谁最可信 |
 * | --- | --- | --- |
 * | `pageLimit` | 用户设定的篇幅上限（导出按它截断） | 用户 |
 * | `reportedPages` | 服务端 `pagination/report` 的 `pages_needed`（真 PDF 排版） | **页数口径** |
 * | `measuredPages` | 浏览器 `measureResumeLayout` 数出来的列数 | 只作下界 |
 *
 * ## 为什么报告优先，但测量仍然参与
 *
 * 问题 3 的根因是两套排版引擎（浏览器 CSS 多列 / 服务端独立绘制器），页数天然会差一页。
 * 导出的页数以服务端为准，所以**看**的页数也必须以服务端为准，否则用户按草稿的直觉调页数，
 * 结果总是差一页。
 *
 * 但报告不能反过来把内容裁掉：CSS 多列只排 `column-count` 那么多列，`column-fill: auto`
 * 会把放不下的内容排到列盒外面、被 `overflow: hidden` 裁掉（问题 2 的"板块凭空消失"）。
 * 所以真正画几张纸取 `max(上限, 报告, 浏览器测量)`——**报告是口径，测量是"不许丢内容"的
 * 下界**。只有一种情形会让两者不等：报告比浏览器测量还小（引擎差异反向），此时多出来的
 * 那一页照样画出来，并把角标说清楚"超出上限，不计入导出"。
 *
 * ## 降级是单向的
 *
 * 拿不到报告（没有 `resumeId`、请求失败、断网）→ 退回浏览器测量，画布照常可用。
 * 报告回来后页数**只增不减地收敛到报告值**，不会在两者之间来回跳。
 */

// 需求 7B：0 = 不限篇幅。常量只在 `types/resume.ts` 定义一次，这里引用而不复制字面量。
import { UNLIMITED_PAGE_LIMIT } from "../../types";

/** 一页纸的页数与超额页的汇总。`visualPages` 就是画布上要画几张纸。 */
export interface PageCounts {
  /** 生效的篇幅上限（≥ 1）。**「不限篇幅」时等于 `pagesNeeded`**（没有上限可比）。 */
  pageLimit: number;
  /** 内容实际需要几页（报告优先；无报告时取浏览器测量）。 */
  pagesNeeded: number;
  /** 画布要画的纸张数 = `max(pageLimit, pagesNeeded)`。 */
  visualPages: number;
  /** 超出上限的纸张数 = `visualPages − pageLimit`（0 表示没有超额页）。 */
  overflowPages: number;
  /** 有超额页（提示条 / 角标 / 虚线都由它为真时出现）。 */
  overflow: boolean;
  /**
   * 用户选的是「不限篇幅」（`pageLimit === 0`）。
   *
   * 不限时 `overflow` 恒为 false、`overflowPages` 恒为 0：没有上限就没有"超额页"，
   * 也就不该出现"第 N 页起不计入导出"——那句话在不限篇幅下是错的（导出不裁剪）。
   */
  unlimited: boolean;
}

export interface PageCountInput {
  /** 用户设定的页数上限。**`0` = 不限篇幅**（合法值，不是"没设定"）。 */
  pageLimit: number;
  /** 服务端分页报告的页数；`null` / 不传 = 没有报告。 */
  reportedPages?: number | null;
  /** 浏览器测量得出的页数；`null` / 不传 = 没量到。 */
  measuredPages?: number | null;
  /** 单页高度已经装不下（模板探针给的信号）。两者都拿不到时用它兜底成"上限 + 1"。 */
  overflowSignal?: boolean;
}

/** 正整数才收，其余一律按 0（"没有这个来源"）。 */
function positiveOrZero(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

export function resolvePageCounts({
  pageLimit,
  reportedPages,
  measuredPages,
  overflowSignal = false,
}: PageCountInput): PageCounts {
  const reported = positiveOrZero(reportedPages);
  const measured = positiveOrZero(measuredPages);
  // 「不限篇幅」：用户没有设定上限，所以**没有"超额页"这回事**。
  //
  // 曾经把 0 折成 1（`Math.max(1, ...)`）当作"最严的一页"：画布于是声称"上限 1 页、
  // 第 2 页起不计入导出"，而实际导出 2 页、一个字节都没裁——提示条与红框全在说谎。
  // 这里的口径是：**生效上限 = 内容真实需要的页数**（报告 > 测量），超额页恒 0。
  // 数字不改写成别的值再塞回调用方（`pageLimit` 仍然是"画几张纸就是几页"的基准）。
  if (pageLimit === UNLIMITED_PAGE_LIMIT) {
    // 两个来源都拿不到时至少画一页；有溢出信号（单页装不下）但数不出页数时给 2 页，
    // 与"上限 + 1"的旧兜底同口径（多画一页不丢内容，只是不谎称上限）。
    const pagesNeeded = Math.max(1, overflowSignal ? 2 : 0, reported, measured);
    return {
      pageLimit: pagesNeeded,
      pagesNeeded,
      visualPages: pagesNeeded,
      overflowPages: 0,
      overflow: false,
      unlimited: true,
    };
  }
  const limit = Math.max(1, positiveOrZero(pageLimit) || 1);
  // 估计值：报告 > 测量 > 溢出信号（上限 + 1）> 上限。只取"更大"的那一个，
  // 是为了保证"报告比测量小"时也不裁内容（见文件头）。
  const estimate =
    reported > 0 ? reported : measured > 0 ? measured : overflowSignal ? limit + 1 : limit;
  const pagesNeeded = Math.max(1, estimate, measured);
  const visualPages = Math.max(limit, pagesNeeded);
  const overflowPages = Math.max(0, visualPages - limit);
  return {
    pageLimit: limit,
    pagesNeeded,
    visualPages,
    overflowPages,
    overflow: overflowPages > 0,
    unlimited: false,
  };
}
