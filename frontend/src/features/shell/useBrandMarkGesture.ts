// SPDX-License-Identifier: Apache-2.0
/**
 * 侧栏品牌图标的三联手势 + 两个键盘兜底（P5-1 / P5-2 / P5-3 · 13-1·13-2·13-3·13-4）。
 *
 * 语义（**单击必须仍然是最容易按到的那个动作**）：
 * - 1 次 = 回到顶部，**当场执行**——等 400ms 静默窗口再滚会让单击变钝；
 * - 2 次 = 刷新当前页数据（`requestViewRefresh()`，不重载页面、不丢草稿、**不动滚动位置**）；
 * - 3 次 = 回首页；已经在首页时等价于刷新（用户此时想要的是"重来一遍"）。
 *
 * "双击不动滚动位置"是刻意补偿出来的：单击为了零延迟会立刻起滚，而双击的第一次点击
 * 也是单击，所以第二击到达时要把那一跳**撤销**（`restoreScrollSnapshot`）。否则长列表页
 * 双击刷新的副作用就是被弹回顶部——那正是"不用 `location.reload()`"想避免的体验。
 *
 * 计数怎么结算：最后一次点击之后静默 `BRAND_CLICK_SETTLE_MS` 才认定"点完了"。
 * 所以双击的刷新会晚 400ms 发生——这是刻意的：用户可能是想点第三下，
 * 提前刷新会白跑一轮请求。
 *
 * 为什么还要 `Alt+R` / `Alt+Home`：遮罩、弹层、抽屉打开时品牌图标被挡住（甚至被
 * `pointer-events` 拦掉），此时手势完全不可达。两个组合走 `ShortcutProvider` 的
 * 既有注册表（`useShortcut`），所以它们同样出现在设置页的快捷键表里、同样可以改键。
 *
 * 逻辑刻意不写在 `AppShell.tsx` 里：那个文件已经贴着 500 行硬预算。
 */
import { useCallback, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useShortcut } from "../shortcuts/useShortcutKeymap";
import { requestViewRefresh } from "./viewRefresh";

/** 连击结算窗口：最后一次点击之后静默这么久才认定"点完了"。 */
export const BRAND_CLICK_SETTLE_MS = 400;

/** 首页路径（三击的落点；已在这里时改为刷新）。 */
export const BRAND_HOME_PATH = "/";

export interface BrandMarkGesture {
  /** 挂到品牌图标的 `onClick` 上。 */
  onClick: () => void;
}

/**
 * 回到顶部。
 *
 * 三个滚动容器都要动：`.app-main`（外层，桌面形态下偶尔有 1–2px 溢出）、
 * `.app-content`（真正的滚动容器）与 `window`（浏览器版兜底）。
 */
function scrollToTop(): void {
  const scroller = document.querySelector<HTMLElement>(".app-main");
  const content = document.querySelector<HTMLElement>(".app-main .ant-layout-content");
  const position = { top: 0, behavior: "smooth" as const };
  if (typeof scroller?.scrollTo === "function") scroller.scrollTo(position);
  if (typeof content?.scrollTo === "function") content.scrollTo(position);
  if (typeof window.scrollTo === "function") window.scrollTo(position);
}

/** 三个滚动容器的位置快照（单击前拍、第二击时用来撤销那一跳）。 */
interface ScrollSnapshot {
  main: number;
  content: number;
  windowY: number;
}

function readScrollSnapshot(): ScrollSnapshot {
  const scroller = document.querySelector<HTMLElement>(".app-main");
  const content = document.querySelector<HTMLElement>(".app-main .ant-layout-content");
  return {
    main: scroller?.scrollTop ?? 0,
    content: content?.scrollTop ?? 0,
    windowY: typeof window.scrollY === "number" ? window.scrollY : 0,
  };
}

/**
 * 把滚动位置原地放回去（**瞬时**，不要 smooth）。
 *
 * 直接写 `scrollTop` / 用两参数 `window.scrollTo(x, y)`：按 CSSOM-View，新的滚动指令会
 * 中止正在进行的平滑滚动，所以"第一击已经开始往顶部滑"也会被这一步立刻拽回原位，
 * 用户看到的不是一路滚到顶再跳回来，而是刚起步就停住。
 */
function restoreScrollSnapshot(snapshot: ScrollSnapshot): void {
  const scroller = document.querySelector<HTMLElement>(".app-main");
  const content = document.querySelector<HTMLElement>(".app-main .ant-layout-content");
  if (scroller) scroller.scrollTop = snapshot.main;
  if (content) content.scrollTop = snapshot.content;
  if (typeof window.scrollTo === "function") window.scrollTo(0, snapshot.windowY);
}

export function useBrandMarkGesture(): BrandMarkGesture {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  /** 本轮连击已经点了几下；结算后归零。 */
  const clicks = useRef(0);
  /** 结算定时器句柄（0 = 没有挂着的结算）。 */
  const settleTimer = useRef(0);
  /** 第一击之前的滚动位置：第二击用它把"回顶部"撤销掉（双击只刷新，不该丢位置）。 */
  const scrollBeforeClick = useRef<ScrollSnapshot | null>(null);

  const clearSettleTimer = useCallback(() => {
    if (settleTimer.current !== 0) {
      window.clearTimeout(settleTimer.current);
      settleTimer.current = 0;
    }
  }, []);

  /** 回首页；已经在首页就刷新（三击与 Alt+Home 共用同一条语义）。 */
  const goHome = useCallback(() => {
    if (pathname === BRAND_HOME_PATH) {
      requestViewRefresh();
      return;
    }
    void navigate(BRAND_HOME_PATH);
  }, [navigate, pathname]);

  // 卸载时摘掉定时器：否则"点了两下就切页"会在 400ms 后触发一次没人要的刷新。
  useEffect(() => clearSettleTimer, [clearSettleTimer]);

  const onClick = useCallback(() => {
    clicks.current += 1;
    if (clicks.current === 1) {
      // 单击立刻生效：手势的第一层语义不能被结算窗口拖慢。
      // 先拍位置再滚——如果 400ms 内来了第二击，那是"双击刷新"，得把这一跳撤销。
      scrollBeforeClick.current = readScrollSnapshot();
      scrollToTop();
    } else if (clicks.current === 2 && scrollBeforeClick.current) {
      // 第二击到达 = 用户要的是刷新，不是回顶部：把第一击那一跳原地放回去。
      // 这样"双击刷新不动滚动位置"成立，而单击依然是零延迟的。
      restoreScrollSnapshot(scrollBeforeClick.current);
      scrollBeforeClick.current = null;
    }
    clearSettleTimer();
    if (clicks.current >= 3) {
      // 三击不等静默窗口：没有"第四下"这个动作，等 400ms 只会让回首页变慢。
      clicks.current = 0;
      scrollBeforeClick.current = null;
      goHome();
      return;
    }
    const settledCount = clicks.current;
    settleTimer.current = window.setTimeout(() => {
      settleTimer.current = 0;
      clicks.current = 0;
      scrollBeforeClick.current = null;
      // 只有双击才有事可做：单击的滚动已经在上面做完了。
      if (settledCount === 2) requestViewRefresh();
    }, BRAND_CLICK_SETTLE_MS);
  }, [clearSettleTimer, goHome]);

  // 键盘兜底：遮罩/弹层盖住图标时手势点不到，这两个组合必须可靠。
  useShortcut("refreshView", (event) => {
    event.preventDefault();
    requestViewRefresh();
  });
  useShortcut("goHome", (event) => {
    event.preventDefault();
    goHome();
  });

  return { onClick };
}
