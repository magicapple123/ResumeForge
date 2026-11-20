// SPDX-License-Identifier: Apache-2.0
/**
 * 标题栏覆盖层配色：**渲染层决定颜色**（2026-11-20 第 3 条），并跟着圆形揭示逐帧插值
 * （2026-11-20 第 4 条）。
 *
 * 为什么需要这个模块：
 *  1. 第 3 条——覆盖层底色曾经有两份真源（主进程 `TITLEBAR_THEME` 常量 + 页面 CSS），
 *     只能靠人记着同步。现在 CSS 的 `--rf-titlebar-bg` / `--rf-titlebar-symbol` 是唯一真源，
 *     这里读它们的**计算值**，随主题一起经 `desktop:set-theme` 推给主进程；主进程只剩
 *     "上报之前 / 非法值"的默认值。
 *  2. 第 4 条——覆盖层是 Windows 画的独立不透明层，无法参与 `clip-path` 揭示、也无法动画。
 *     它的换色时机原本完全独立于动画（`resolvedTheme` 一变就在第 0 帧发 IPC），
 *     而圆边缘要 90—110ms 才扫到按钮区，于是先"闪"一下。这里把换色对齐到"圆边缘扫过
 *     按钮区"的时间窗，并在窗内按覆盖比例插值。
 *
 * 三条容易踩的点：
 *  1. **缓动必须与 `styles/theme-transition.css` 的 `rf-theme-reveal` 逐字一致**
 *     （`cubic-bezier(0.22, 0.61, 0.36, 1)`）。这一条在 JS 与 CSS 两处互相写注释指认对方：
 *     只改一边就会让换色窗口与真实扩散错开，而且是静默错开（看起来"差不多"）。
 *  2. **颜色一律从 CSS 读，不要用主进程常量**——否则第 3 条刚消灭的双真源又回来了。
 *  3. **覆盖层只能整块换色**：`setTitleBarOverlay` 每次调用都可能重建按钮图层
 *     （`WinCaptionButtonContainer::UpdateBackground()`），所以窗内只发 2—3 帧，
 *     不做 60fps；颜色格式还必须是不透明 `#rrggbb`（alpha < 255 会让按钮连同字形消失，
 *     校验在主进程 desktop/lib/titlebar.js）。
 */
import type { ResolvedTheme } from "./themeStore";

/** 覆盖层底色的 CSS 变量（`styles/desktop-titlebar.css`，唯一真源）。 */
export const TITLEBAR_BG_VAR = "--rf-titlebar-bg";
/** 系统按钮图标色的 CSS 变量（同上）。 */
export const TITLEBAR_SYMBOL_VAR = "--rf-titlebar-symbol";

/**
 * 揭示动画的缓动曲线：**必须与 `styles/theme-transition.css` 的
 * `animation: rf-theme-reveal … cubic-bezier(0.22, 0.61, 0.36, 1)` 逐字一致**。
 */
export const REVEAL_BEZIER = [0.22, 0.61, 0.36, 1] as const;

export interface TitlebarOverlayColors {
  color?: string;
  symbolColor?: string;
}

/** 上报给主进程的载荷（`desktop:set-theme`）。颜色缺失时主进程用默认值兜底。 */
export interface TitlebarOverlayPayload extends TitlebarOverlayColors {
  theme: ResolvedTheme;
}

export interface OverlayPoint {
  x: number;
  y: number;
}

/** 按钮区（不可拖拽、系统绘制）的矩形，单位 CSS px。 */
export interface OverlayPlate {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 换色窗口：圆边缘"进入 / 离开"按钮区的时刻（毫秒）。 */
export interface OverlayFlipWindow {
  /** 圆心到按钮区最近点的距离 */
  near: number;
  /** 圆心到按钮区最远点的距离 */
  far: number;
  /** 圆边缘碰到按钮区（开始插值） */
  enterMs: number;
  /** 圆边缘离开按钮区（置终值） */
  leaveMs: number;
}

/** 帧调度入口：默认真实的 performance/rAF，测试注入假实现即可确定性推进。 */
export interface OverlayFlipRuntime {
  now(): number;
  requestFrame(callback: () => void): number;
  cancelFrame(handle: number): void;
  setTimer(callback: () => void, ms: number): number;
  clearTimer(handle: number): void;
}

export interface OverlayFlipHandle {
  /** false = 没有可用的覆盖层（浏览器版 / 桥缺失），调用方什么都不必做 */
  active: boolean;
  /** 在 `apply()` **之后**调用：读新色、起帧循环、结束时落到终值 */
  start(): void;
  /** 取消（被新一次切换顶掉 / 过渡失败）：落到当前 CSS 值，不留中间色 */
  cancel(): void;
}

const HEX_COLOR = /^#[0-9a-f]{6}$/;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 1);
}

/** CSS 自定义属性取到的是"作者写的原文"（`#f5f7fa`），只接受不透明 6 位十六进制。 */
function normalizeHexColor(raw: string | null | undefined): string | undefined {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return HEX_COLOR.test(value) ? value : undefined;
}

/**
 * 读当前生效的覆盖层颜色（CSS 计算值）。
 *
 * 只接受不透明 `#rrggbb`：CSS 变量被写成 `rgba()` / 8 位 hex 时这里返回 undefined，
 * 主进程据此回落到自己的默认值（宁可颜色不对，也不能让三颗按钮消失）。
 */
export function readTitlebarOverlayColors(
  doc: Document | null = typeof document === "undefined" ? null : document,
): TitlebarOverlayColors {
  const root = doc?.documentElement;
  if (!root || typeof getComputedStyle !== "function") return {};
  const style = getComputedStyle(root);
  const colors: TitlebarOverlayColors = {};
  const color = normalizeHexColor(style.getPropertyValue(TITLEBAR_BG_VAR));
  const symbolColor = normalizeHexColor(style.getPropertyValue(TITLEBAR_SYMBOL_VAR));
  if (color) colors.color = color;
  if (symbolColor) colors.symbolColor = symbolColor;
  return colors;
}

/**
 * 按钮区矩形：Window Controls Overlay 暴露的 titlebar-area 是**可拖拽区**（不含按钮），
 * 所以按钮区 = 它右侧剩下的那一条。
 *
 * API 缺失（浏览器版 / 旧壳）时返回 null，调用方退化为"延迟 0、一次切换"。
 * 单位天然是 CSS px（浏览器已做 DPI 换算），125% / 150% 缩放下不用自己乘。
 */
export function titlebarOverlayPlate(
  win: Window | null = typeof window === "undefined" ? null : window,
): OverlayPlate | null {
  const navigatorLike = win?.navigator as
    | (Navigator & {
        windowControlsOverlay?: { getTitlebarAreaRect?: () => DOMRect };
      })
    | undefined;
  const controls = navigatorLike?.windowControlsOverlay;
  if (!controls || typeof controls.getTitlebarAreaRect !== "function") return null;
  try {
    const area = controls.getTitlebarAreaRect();
    if (!area || !Number.isFinite(area.x) || !Number.isFinite(area.width)) return null;
    const left = area.x + area.width;
    const width = (win as Window).innerWidth - left;
    if (!(width > 0)) return null;
    return { x: left, y: 0, width, height: Number.isFinite(area.height) ? area.height : 0 };
  } catch {
    return null;
  }
}

/** 圆心到矩形的最近距离（圆心在矩形内时为 0）。 */
export function nearestDistanceToPlate(origin: OverlayPoint, plate: OverlayPlate): number {
  const dx = Math.max(plate.x - origin.x, 0, origin.x - (plate.x + plate.width));
  const dy = Math.max(plate.y - origin.y, 0, origin.y - (plate.y + plate.height));
  return Math.hypot(dx, dy);
}

/** 圆心到矩形最远角的距离。 */
export function farthestDistanceToPlate(origin: OverlayPoint, plate: OverlayPlate): number {
  return Math.max(
    Math.hypot(plate.x - origin.x, plate.y - origin.y),
    Math.hypot(plate.x + plate.width - origin.x, plate.y - origin.y),
    Math.hypot(plate.x - origin.x, plate.y + plate.height - origin.y),
    Math.hypot(plate.x + plate.width - origin.x, plate.y + plate.height - origin.y),
  );
}

/** 三次贝塞尔某一个分量的取值（`p0 = 0`、`p3 = 1` 的那种标准写法）。 */
function bezierComponent(t: number, p1: number, p2: number): number {
  const mt = 1 - t;
  return 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t;
}

/** 时间比例 -> 贝塞尔的参数 u（对 x 分量二分求逆，60 次足够精确）。 */
function paramAtTime(timeFraction: number): number {
  const target = clamp01(timeFraction);
  let low = 0;
  let high = 1;
  for (let index = 0; index < 60; index += 1) {
    const mid = (low + high) / 2;
    if (bezierComponent(mid, REVEAL_BEZIER[0], REVEAL_BEZIER[2]) < target) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

/**
 * 揭示进度（0—1）：与 CSS 的 `cubic-bezier(0.22, 0.61, 0.36, 1)` 同一函数。
 * `easeProgress(0) = 0`、`easeProgress(1) = 1`、区间内单调递增。
 */
export function easeProgress(timeFraction: number): number {
  const time = clamp01(timeFraction);
  if (time === 0) return 0;
  if (time === 1) return 1;
  const u = paramAtTime(time);
  return clamp01(bezierComponent(u, REVEAL_BEZIER[1], REVEAL_BEZIER[3]));
}

/** `easeProgress` 的反函数：给定进度求时间比例（二分 60 次）。 */
export function timeFractionAtProgress(progress: number): number {
  const target = clamp01(progress);
  if (target <= 0) return 0;
  if (target >= 1) return 1;
  let low = 0;
  let high = 1;
  for (let index = 0; index < 60; index += 1) {
    const mid = (low + high) / 2;
    if (easeProgress(mid) < target) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

/**
 * 换色窗口：圆边缘扫过按钮区的那一段。
 *
 * `radius` 必须是这次过渡实际写到 `--rf-theme-r` 的那个值（`revealRadius()` 的结果）——
 * 由调用方传入而不是在这里重算，既避免与 themeTransition 的公式分叉，也避免循环 import。
 *
 * @example 1650×997、圆心 (1122,52)、按钮区 138×32、R≈1467 时：near≈391、far≈531，
 *   560ms 的窗口约为 55ms—77ms（见测试里的实测值；任务书的 93/129ms 是按线性/`ease`
 *   估算的，与 CSS 的 `cubic-bezier(0.22,0.61,0.36,1)` 不符）。
 */
export function overlayFlipWindow(input: {
  origin: OverlayPoint;
  plate: OverlayPlate;
  radius: number;
  durationMs: number;
}): OverlayFlipWindow {
  const { origin, plate, radius, durationMs } = input;
  const near = nearestDistanceToPlate(origin, plate);
  const far = farthestDistanceToPlate(origin, plate);
  // 圆的半径按 ease(t) × radius 增长；求"半径长到 near / far"各自对应的时刻。
  const timeAt = (distance: number): number => {
    if (!(radius > 0) || !(durationMs > 0)) return 0;
    return timeFractionAtProgress(distance / radius) * durationMs;
  };
  const enterMs = timeAt(near);
  const leaveMs = Math.max(timeAt(far), enterMs);
  return { near, far, enterMs, leaveMs };
}

/** 圆已经盖住按钮区的比例：`near` 之前 0、`far` 之后 1，中间线性。 */
export function overlayCoverage(input: { radius: number; near: number; far: number }): number {
  const { radius, near, far } = input;
  if (!(far > near)) return radius >= far ? 1 : 0;
  return clamp01((radius - near) / (far - near));
}

/** `#rrggbb` -> 三个通道；非法值返回 null（插值退化为"直接用终值"）。 */
export function parseHexColor(
  value: string | undefined,
): { r: number; g: number; b: number } | null {
  const hex = normalizeHexColor(value);
  if (!hex) return null;
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  };
}

/**
 * sRGB 直插（138×32 的块、1—2 帧，不需要色彩空间库）。
 * @returns `#rrggbb`；任一入参非法时返回 null
 */
export function lerpHexColor(
  from: string | undefined,
  to: string | undefined,
  t: number,
): string | null {
  const a = parseHexColor(from);
  const b = parseHexColor(to);
  if (!a || !b) return null;
  const ratio = clamp01(t);
  const channel = (start: number, end: number) =>
    Math.round(start + (end - start) * ratio)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(a.r, b.r)}${channel(a.g, b.g)}${channel(a.b, b.b)}`;
}

/** 插值一组覆盖层颜色；某项非法时直接用终值（宁可突变，也不要发出非法色）。 */
export function mixOverlayColors(
  from: TitlebarOverlayColors,
  to: TitlebarOverlayColors,
  t: number,
): TitlebarOverlayColors {
  return {
    color: lerpHexColor(from.color, to.color, t) ?? to.color,
    symbolColor: lerpHexColor(from.symbolColor, to.symbolColor, t) ?? to.symbolColor,
  };
}

// ---- 上报与插值驱动 ---------------------------------------------------------

type OverlaySink = (payload: TitlebarOverlayPayload) => void;

const defaultRuntime: OverlayFlipRuntime = {
  now: () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
  requestFrame: (callback) => {
    if (typeof requestAnimationFrame === "function") return requestAnimationFrame(() => callback());
    return setTimeout(callback, 16) as unknown as number;
  },
  cancelFrame: (handle) => {
    if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(handle);
    else clearTimeout(handle);
  },
  setTimer: (callback, ms) => setTimeout(callback, ms) as unknown as number,
  clearTimer: (handle) => clearTimeout(handle),
};

/** 主进程上报出口（DesktopTitleBar 挂载时注册；浏览器版为 null）。 */
let sink: OverlaySink | null = null;
/** 正在驱动覆盖层的那一代；null = 没有过渡在掌权，逐帧之外的普通上报可以直接发。 */
let owner: number | null = null;
let generation = 0;

/** 注册/注销上报出口（组件挂载/卸载时调用）。 */
export function setTitlebarOverlaySink(next: OverlaySink | null): void {
  sink = next;
  if (!next) owner = null;
}

/**
 * 普通（非过渡）上报：把当前主题与 CSS 计算色推给主进程。
 *
 * 过渡进行中（`owner !== null`）时**丢弃**——那一段由插值器负责，否则会在第 0 帧
 * 就把覆盖层切成新色，正是第 4 条要修的那个"闪"。
 *
 * @returns 是否真的发出去了
 */
export function publishTitlebarOverlay(payload: TitlebarOverlayPayload): boolean {
  if (owner !== null || !sink) return false;
  sink(payload);
  return true;
}

/**
 * 开始一段"跟着揭示换色"的覆盖层驱动。
 *
 * 调用顺序（在 `startThemeTransition` 里）：
 *   1. `apply()` **之前**调用本函数 —— 此刻读到的 CSS 值还是旧色；
 *   2. `apply()` 落地（`data-theme` 变了、CSS 变量已是新值）之后调用 `start()`；
 *   3. 过渡被浏览器跳过 / 被新一次切换顶掉时调用 `cancel()`。
 *
 * 连续快速切换：每调用一次 `generation` 递增，旧的一段在所有写入点都比对代次，
 * 因此不会拿旧主题的终色盖掉新主题（第 4 条的"必须可取消"）。
 *
 * `radius` 必填：必须是这次过渡实际写到 `--rf-theme-r` 的值（`revealRadius()` 的结果）。
 * 由调用方传入而不是本模块重算，既不会与 reveal 的公式分叉，也不必让本模块反向 import
 * themeTransition（那会形成循环依赖：themeTransition 正是本模块的调用方）。
 */
export function beginTitlebarOverlayFlip(input: {
  next: ResolvedTheme;
  origin: OverlayPoint;
  durationMs: number;
  /** 这次过渡实际使用的半径（`revealRadius()` 的结果） */
  radius: number;
  runtime?: OverlayFlipRuntime;
}): OverlayFlipHandle {
  generation += 1;
  const current = generation;
  if (!sink) return { active: false, start: () => undefined, cancel: () => undefined };

  const runtime = input.runtime ?? defaultRuntime;
  const radius = input.radius;
  // apply() 之前读：这是"旧色"。
  const from = readTitlebarOverlayColors();
  const plate = titlebarOverlayPlate();

  owner = current;
  let frame: number | null = null;
  let timer: number | null = null;
  let startedAt = 0;
  let lastSent = 0;
  let settled = false;

  const stopScheduling = (): void => {
    if (frame !== null) runtime.cancelFrame(frame);
    if (timer !== null) runtime.clearTimer(timer);
    frame = null;
    timer = null;
  };

  const send = (payload: TitlebarOverlayPayload): void => {
    if (owner !== current || !sink) return;
    sink(payload);
  };

  /** 落到终值并交还"掌权"标记：必须有这一步，否则覆盖层会停在中间色。 */
  const settle = (colors: TitlebarOverlayColors): void => {
    if (settled) return;
    settled = true;
    stopScheduling();
    // 先发再交权：`send` 用"代"做闸门，先清 owner 会把这一帧自己也丢掉。
    send({ theme: input.next, ...colors });
    if (owner === current) owner = null;
  };

  return {
    active: true,
    start() {
      const to = readTitlebarOverlayColors();
      // 取不到几何（浏览器版 / 旧壳）或色值不全：延迟 0、不插值、一次切换，
      // 与"不支持 View Transitions"时的直通路径行为一致。
      if (!plate || !from.color || !to.color || !(radius > 0) || !(input.durationMs > 0)) {
        settle(to);
        return;
      }
      const { near, far, enterMs, leaveMs } = overlayFlipWindow({
        origin: input.origin,
        plate,
        radius,
        durationMs: input.durationMs,
      });
      startedAt = runtime.now();
      const step = (): void => {
        frame = null;
        if (owner !== current) return;
        const elapsed = runtime.now() - startedAt;
        if (elapsed >= leaveMs) {
          settle(to);
          return;
        }
        if (elapsed >= enterMs) {
          const revealed = easeProgress(elapsed / input.durationMs) * radius;
          const coverage = overlayCoverage({ radius: revealed, near, far });
          // 逐帧只发有变化的帧（1/255 的色阶以下肉眼无差，没必要再发一条 IPC）。
          if (Math.abs(coverage - lastSent) >= 1 / 255) {
            lastSent = coverage;
            send({ theme: input.next, ...mixOverlayColors(from, to, coverage) });
          }
        }
        frame = runtime.requestFrame(step);
      };
      frame = runtime.requestFrame(step);
      // 兜底：窗口在过渡期间被最小化时 rAF 会停摆，绝不能让覆盖层停在中间色。
      timer = runtime.setTimer(() => settle(to), leaveMs + 100);
    },
    cancel() {
      stopScheduling();
      if (owner !== current) return; // 已被新一代接管：一个字节都不要写
      if (settled) {
        owner = null;
        return;
      }
      settled = true;
      // 落到**当前** CSS 值（不是旧色也不是终值）：过渡被打断时页面已经在新主题上了。
      send({ theme: input.next, ...readTitlebarOverlayColors() });
      owner = null;
    },
  };
}

/** 测试用：清掉模块级状态（sink / 代次 / 掌权标记）。 */
export function resetTitlebarOverlayState(): void {
  sink = null;
  owner = null;
  generation = 0;
}
