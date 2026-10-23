// SPDX-License-Identifier: Apache-2.0
/**
 * 断点单一事实源。三个消费方：
 *   1. TS/TSX —— 直接 import BREAKPOINTS / mqMax / mqMin；
 *   2. CSS    —— `:root` 的 `--rf-bp-*`（design-tokens.css），由 breakpointGuard 比对；
 *   3. @media —— 只能用字面量，由 breakpointGuard 检查"数值必须属于本表"。
 *
 * 为什么不用 antd 的 screen token（576/768/992/1200/1600）：那六个数是"视口"档，而本应用
 * 真正稀缺的是"内容盒"（视口 − 侧栏 200 − 内容内边距 48 − 滚动条 ≈10）。992 对应的内容盒
 * 只有 900，1200 对应 952，都落在同一个密度档内部，作为整页布局的决策点太靠里。
 *
 * 改这里 = 改规则。每个数都有来源：
 *   phone  767  —— 沿用 mobile.css 现值；1024×768 竖屏与 1366@175% 的上沿；antd md 的 −1
 *   narrow 1092 —— 1366 ÷ 1.25 向下取整：用户的底线机型一旦开 125% 缩放
 *   base   1366 —— 用户明确给出的"最低支持线"
 *   wide   1536 —— 1920 ÷ 1.25：最常见的笔记本默认缩放
 *   huge   1920 —— 1080p @100%
 *   ultra  2048 —— 2560 ÷ 1.25：2.5K 屏 @125%
 */
export const BREAKPOINTS = {
  phone: 767,
  narrow: 1092,
  base: 1366,
  wide: 1536,
  huge: 1920,
  ultra: 2048,
} as const;

export type BreakpointName = keyof typeof BREAKPOINTS;

export const BREAKPOINT_VALUES: readonly number[] = Object.values(BREAKPOINTS);

/** 生成 max-width 媒体查询串，供 TSX 里的 matchMedia 用（与 CSS 的 max-width 同义）。 */
export const mqMax = (name: BreakpointName) => `(max-width: ${BREAKPOINTS[name]}px)`;

/** 生成 min-width 媒体查询串。 */
export const mqMin = (name: BreakpointName) => `(min-width: ${BREAKPOINTS[name]}px)`;
