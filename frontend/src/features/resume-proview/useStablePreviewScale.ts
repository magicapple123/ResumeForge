// SPDX-License-Identifier: Apache-2.0
/**
 * 刷新预览时保持「纸面显示大小」不变（从 ResumePreview 拆出）。
 *
 * 背景：缩放读数 = fit 比例 × 用户缩放。制作台里改左栏参数会让预览重排；若此时
 * 头部警示条出现/消失（溢出提示等），纸面可用高度变了，fit 也跟着变——用户看到
 * 「明明放大了，刷新一下又小了」。这里在换文档后的短窗口内，把 fit 的变化按比值
 * 补进缩放，让纸面显示比例与刷新前一致；窗口缩放、拖栏宽不换文档，因此不补偿。
 */
import { useEffect, useRef } from "react";
import { MAX_ZOOM, MIN_ZOOM } from "../../components/resume-preview/config";

/** fit 变化后允许补偿的时间窗：只覆盖这次刷新的异步重排，不干扰很久之后拖窗口。 */
const REFRESH_WINDOW_MS = 2500;

/** 算出补偿后的缩放值；不需要改（无历史 / 已一致 / 用户没缩放）时返回 null。纯函数便于单测。 */
export function stableZoom(
  previousDisplayScale: number | null,
  fitScale: number,
  currentZoom: number,
): number | null {
  if (previousDisplayScale === null || fitScale <= 0) return null;
  // **用户没缩放（zoom = 1 = 适应页面）时不做任何补偿（Q21）**：fit 变了就如实让纸变大/变小。
  // 钉住"上一档显示比例"会把默认档从"适应画布"掰成 100%——右栏只有 654px 时纸仍是 794px，
  // 于是默认就横向溢出（用户口径："默认比例容易停在 100%，宽于右栏"）。补偿只服务于
  // "用户显式放大/缩小之后、刷新时别跳回 fit"。
  if (Math.abs(currentZoom - 1) < 1e-4) return null;
  const target = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, previousDisplayScale / fitScale));
  return Math.abs(target - currentZoom) < 1e-4 ? null : target;
}

/**
 * @param refreshToken 换文档的判据（html 字符串 / 页数）；只在它变化时开启补偿窗口。
 * @param displayScale 当前纸面显示比例（fit × 缩放），由几何计算给出。
 * @param fitScale 当前 fit 比例。
 * @param zoom 当前用户缩放系数。
 * @param setZoom 写回缩放系数。
 * @param enabled 只在**草稿口径**启用（Q21：精确模式与草稿缩放解耦）。
 *   精确模式里草稿画布被裁成 0 高/卸载，fit 会变，补偿逻辑会把"上一档显示比例"折算成
 *   一个新的缩放系数——那正是"切到精确后纸面变成 181%、横向溢出"的来源。关闭时清空基线，
 *   切回草稿后按当前值重新记录，不做任何跨口径补偿。
 */
export function useStablePreviewScale(
  refreshToken: unknown,
  displayScale: number,
  fitScale: number,
  zoom: number,
  setZoom: (next: number) => void,
  enabled = true,
): void {
  const lastRef = useRef<{ display: number; fit: number }>({
    display: Number.NaN,
    fit: Number.NaN,
  });
  const refreshRef = useRef<{ display: number; fit: number; until: number } | null>(null);
  const enabledRef = useRef(enabled);
  useEffect(() => {
    enabledRef.current = enabled;
    if (enabled) return;
    // 停用（精确口径）时不保留任何补偿基线：切回草稿的第一帧按当时的显示比例重新记。
    refreshRef.current = null;
    lastRef.current = { display: Number.NaN, fit: Number.NaN };
  }, [enabled]);

  // A：换文档 → 记下刷新前的显示比例，开启补偿窗口。
  useEffect(() => {
    if (!enabledRef.current) {
      refreshRef.current = null;
      return;
    }
    const previous = lastRef.current;
    refreshRef.current = Number.isFinite(previous.display)
      ? { ...previous, until: Date.now() + REFRESH_WINDOW_MS }
      : null;
  }, [refreshToken]);

  // B：窗口内的 fit 变化（头部提示条出现/消失）→ 按新旧 fit 比值补回缩放。
  useEffect(() => {
    if (!enabledRef.current) return;
    const refresh = refreshRef.current;
    if (!refresh || Date.now() > refresh.until) return;
    if (Math.abs(fitScale - refresh.fit) <= 1e-4) return;
    const target = stableZoom(refresh.display, fitScale, zoom);
    refresh.fit = fitScale;
    if (target !== null) setZoom(target);
  }, [fitScale, zoom, setZoom]);

  // C：记录本提交的显示比例；用户自己缩放时同步更新补偿基线（fit 没变才算用户缩放）。
  useEffect(() => {
    const previous = lastRef.current;
    const fitChanged = Math.abs(previous.fit - fitScale) > 1e-4;
    const refresh = refreshRef.current;
    if (refresh && !fitChanged && Math.abs(displayScale - previous.display) > 1e-4) {
      refresh.display = displayScale;
    }
    lastRef.current = { display: displayScale, fit: fitScale };
  });
}
