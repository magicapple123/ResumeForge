// SPDX-License-Identifier: Apache-2.0
/**
 * 主题切换的"圆形扩散"过渡（WF-09）。
 *
 * 为什么用 View Transitions 而不是给每个元素加 transition：一次切主题会改 `data-theme`
 * 与 antd 的整套 token，涉及上千个元素、上百条 CSS 变量。逐条声明 transition 既写不全，
 * 也会让所有交互都跟着变慢；View Transitions 只截两张整页快照，用 `clip-path: circle()`
 * 把新快照从按钮位置"推"出来，与新快照里到底有多少元素无关。
 *
 * 三个容易踩的点：
 * 1. **回调里只能等微任务，绝不能等 rAF**：回调 pending 期间浏览器不产生渲染帧，
 *    等 rAF 会自己把自己卡死，4 秒后以 "DOM update timed out" 中止（实测：等两帧 rAF 时
 *    过渡一次都播不出来，且期间所有截图都阻塞）。新快照在回调 resolve 之后的下一次渲染
 *    才截取，`await Promise.resolve()` 就足够让 React 的提交先落地；
 * 2. **半径要盖住最远的角**，否则动画结束时四个角还剩一块旧主题（`hypot(max(x, vw-x), …)`）；
 * 3. **连续快速切换时上一段过渡会被浏览器跳过**，它的 `finished` 会 reject。清理
 *    CSS 变量必须按"代"判断，否则会把正在跑的那一段的变量删掉、动画当场断掉。
 *
 * **标题栏覆盖层不在揭示里**（2026-11-20 第 4 条）：它是 Windows 画的独立不透明层，
 * 既不参与 `clip-path` 也不可动画。这里在 `apply()` 前后各读一次它的底色，把换色交给
 * `titlebarOverlay.ts` 的插值器——窗口对齐到"圆边缘扫过按钮区"的那 20 来毫秒。
 * 缓动曲线是**三处共用**的事实：本文件写 `--rf-theme-duration`、
 * `styles/theme-transition.css` 的 `rf-theme-reveal` 用 `cubic-bezier(0.22, 0.61, 0.36, 1)`，
 * `titlebarOverlay.ts` 的 `REVEAL_BEZIER` 复刻同一份——改一处必须改三处。
 */
import { beginTitlebarOverlayFlip } from "./titlebarOverlay";
import type { ResolvedTheme } from "./themeStore";

export interface ThemeTransitionOrigin {
  x: number;
  y: number;
}

/** 开灯慢、关灯快：深色→浅色要看清"灯亮起来"，浅色→深色只需确认已经切了。
 *  2026-11-20：380/280 → 560/460（社区主流 500–560ms；600 以上会像卡住，别再往上加）。 */
export const REVEAL_DURATION_MS: Record<ResolvedTheme, number> = { light: 560, dark: 460 };

type ViewTransitionLike = { finished: Promise<void> };
type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void | Promise<void>) => ViewTransitionLike;
};

const CSS_VARS = ["--rf-theme-x", "--rf-theme-y", "--rf-theme-r", "--rf-theme-duration"] as const;
/** 同一时刻只允许一段过渡在"掌权"：后发的那段会顶掉前一段的清理权。 */
let generation = 0;

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** 圆心到视口最远角的距离：扩散结束时四个角都要被新主题盖住。 */
export function revealRadius(x: number, y: number, width: number, height: number): number {
  return Math.hypot(Math.max(x, width - x), Math.max(y, height - y));
}

/** 取元素的矩形中心；元素不在（或没有布局）时退回视口中心。 */
export function themeSwitchOrigin(element: Element | null): ThemeTransitionOrigin {
  const width = typeof window === "undefined" ? 0 : window.innerWidth;
  const height = typeof window === "undefined" ? 0 : window.innerHeight;
  if (!element || typeof element.getBoundingClientRect !== "function") {
    return { x: width / 2, y: height / 2 };
  }
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return { x: width / 2, y: height / 2 };
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/**
 * 以 `origin` 为圆心扩散到 `next` 主题；不支持 View Transitions 或用户要求减少动态效果时
 * 直接 `apply()`，行为与改造前逐字一致。
 */
export function startThemeTransition(
  next: ResolvedTheme,
  origin: ThemeTransitionOrigin,
  apply: () => void,
): void {
  if (typeof document === "undefined" || typeof window === "undefined") {
    apply();
    return;
  }
  const doc = document as ViewTransitionDocument;
  if (typeof doc.startViewTransition !== "function" || prefersReducedMotion()) {
    apply();
    return;
  }

  const root = document.documentElement;
  const current = ++generation;
  // 取整只在这里做一次：写进 `--rf-theme-r` 的值与交给覆盖层插值器的半径必须同一份，
  // 否则"圆边缘在哪一刻扫过按钮区"会差一点点。
  const radius = Math.ceil(revealRadius(origin.x, origin.y, window.innerWidth, window.innerHeight));
  root.style.setProperty("--rf-theme-x", `${Math.round(origin.x)}px`);
  root.style.setProperty("--rf-theme-y", `${Math.round(origin.y)}px`);
  root.style.setProperty("--rf-theme-r", `${radius}px`);
  root.style.setProperty("--rf-theme-duration", `${REVEAL_DURATION_MS[next]}ms`);

  const clearVars = () => {
    // 只有最新一代才有权清理：被顶掉的那段 finished 会 reject，此时变量已归新的那段管。
    if (current !== generation) return;
    for (const name of CSS_VARS) root.style.removeProperty(name);
  };

  // 覆盖层换色（第 4 条）：**在 apply() 之前**开始——此刻读到的 CSS 值还是旧色。
  // 没有桌面标题栏（浏览器版）时它自己退化为 no-op。
  const overlay = beginTitlebarOverlayFlip({
    next,
    origin: { x: origin.x, y: origin.y },
    durationMs: REVEAL_DURATION_MS[next],
    radius,
  });

  let transition: ViewTransitionLike;
  try {
    transition = doc.startViewTransition(async () => {
      apply();
      // 只让出一个微任务：等 rAF 会在"回调 pending 期间不产生渲染帧"的规则下死锁。
      await Promise.resolve();
      // 新主题已落地（data-theme 与 CSS 变量都是新值）：起插值循环。
      overlay.start();
    });
  } catch {
    // 浏览器拒绝开新过渡（例如文档不可见）：退回直接切换，不要留下半截状态。
    clearVars();
    overlay.cancel();
    apply();
    return;
  }
  // 过渡被跳过（连续快速切换）时也要收尾：把覆盖层落到当前 CSS 值，并停掉帧循环。
  void transition.finished.then(clearVars, clearVars).then(() => overlay.cancel());
}
