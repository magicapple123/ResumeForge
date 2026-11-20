// SPDX-License-Identifier: Apache-2.0
/**
 * 桌面壳标题栏占用的顶部高度（`--rf-titlebar-height`，见 `styles/desktop-titlebar.css`）。
 *
 * 浮窗卡与悬浮球的拖拽限位都要让开这块区域，否则会被拖到系统按钮上方、点不到关闭。
 * 浏览器发行版没有标题栏、全屏（`data-hidden="true"`）时标题栏收起——两种都返回 0，
 * 行为与加入限位前完全一致。
 */
const FALLBACK_TITLEBAR_HEIGHT = 32;

export function readTopInset(): number {
  if (typeof document === "undefined") return 0;
  const bar = document.querySelector(".app-titlebar");
  if (!bar || bar.getAttribute("data-hidden") === "true") return 0;
  const px = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--rf-titlebar-height"),
  );
  return Number.isFinite(px) && px > 0 ? px : FALLBACK_TITLEBAR_HEIGHT;
}
