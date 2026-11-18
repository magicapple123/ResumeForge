// SPDX-License-Identifier: Apache-2.0
/**
 * 右键浮层（排版 / 照片框）的层级：**贴在最高一层模态之上、antd 弹层之下**。
 *
 * ## 为什么不能写一个固定数字
 *
 * 浮层 `createPortal` 到 body，落在根层叠上下文里；宿主却是弹窗：
 * 制作台是 `.ant-modal-wrap.resume-zoom-workbench-wrap`（实测 z-index 3300），
 * 手动录入是普通 antd Modal（3100）。原来写死 `z-index: 1200`，两者都盖住它——
 * DOM 里有卡片、截图里没有、`elementFromPoint` 命中的是弹窗里的左栏提示，
 * 连组头都点不动（I-21 实测 2026-11-18）。
 *
 * 一个固定值也修不好：3349 在制作台里对（>3300），但手动录入弹窗里会盖住自己
 * 弹出来的 Select 下拉（该上下文弹层是 3100+50）。所以取"当前文档里最高的
 * `.ant-modal-wrap` + 49"：
 *
 * - `+49` 沿用 `.rf-inline-mark-mask` 的口径（popup-base + 50 − 1）：高一层模态，
 *   低一层该模态里的 antd 弹层（Tooltip / 下拉 / 取色器都从这里弹出来，
 *   盖住自己的浮层就等于控件点不开）。
 * - 没有模态（普通页面里的编辑器）时基准回落到 `popupBase`（3100），结果 3149。
 *
 * 只在打开时算一次：模态层级在浮层存活期间不会变（开着浮层去开另一张模态不是
 * 这条链路的场景）。
 */
const POPUP_BASE = 3100;
/** 与 antd 弹层的最小间隔：`popupBase + 50` 是 Dropdown / Tooltip 的自身偏移。 */
const ABOVE_MODAL = 49;

export function chipPopoverZIndex(doc: Document | undefined = globalThis.document): number {
  if (!doc) return POPUP_BASE + ABOVE_MODAL;
  let base = POPUP_BASE;
  for (const wrap of doc.querySelectorAll<HTMLElement>(".ant-modal-wrap")) {
    const z = Number.parseInt(getComputedStyle(wrap).zIndex, 10);
    if (Number.isFinite(z) && z > base) base = z;
  }
  return base + ABOVE_MODAL;
}
