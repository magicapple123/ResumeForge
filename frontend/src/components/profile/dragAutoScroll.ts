/** 拖拽期自动滚动：指针贴近滚动容器上下边缘时连续滚动，让条目/分区能跨屏移动。
 *
 * 去掉「拖拽期分区塌缩」之后，整页保持真实高度，被拖卡片可以拖出视口——没有自动
 * 滚动的话，跨屏拖拽就完全做不到（用户按住卡片走到屏幕边缘，页面纹丝不动）。
 *
 * 本模块只负责「滚多少」，不碰几何：几何由调用方按 `onTick` 收到的滚动量平移
 * （`stackTop -= delta`）。刻意**不重新量 DOM**：滚动不改变项高与间距，重排后
 * 前缀和仍然成立，重新量反而会把「滚动中途 content-visibility 生效」这类噪声
 * 引进来。
 */

/** 触发自动滚动的边缘带宽（px）。 */
export const AUTO_SCROLL_EDGE_PX = 64;
/** 每帧最大滚动步长（px，约 60fps 下 1680px/s）。 */
export const AUTO_SCROLL_MAX_STEP_PX = 28;

/**
 * 从某个元素向上找到真正的滚动父级（第一个 `overflow-y: auto|scroll` 且内容超高的
 * 祖先），找不到就退回文档滚动元素。
 *
 * 本应用的滚动发生在内层 `.app-content`（`overflow-y: auto`）而不是 window 上，
 * 所以 `window.scrollTo` 完全无效——必须定位到该元素再改 `scrollTop`。
 */
export function resolveScrollParent(element: HTMLElement | null): HTMLElement | null {
  let node: HTMLElement | null = element?.parentElement ?? null;
  while (node) {
    const { overflowY } = window.getComputedStyle(node);
    const scrollable = overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay";
    if (scrollable && node.scrollHeight > node.clientHeight) return node;
    node = node.parentElement;
  }
  const root = document.scrollingElement;
  return root instanceof HTMLElement ? root : document.documentElement;
}

/**
 * 本帧应滚动的像素（正数向下、负数向上、0 不动）。
 *
 * 指针进入上下各 `edge` 像素的带状区域后线性加速：刚进带内步长最小 1px，贴边时
 * 达到 `max`；离开两条带（含正好在带边界上）返回 0。
 */
export function edgeScrollDelta(
  pointerY: number,
  rectTop: number,
  rectBottom: number,
  edge: number = AUTO_SCROLL_EDGE_PX,
  max: number = AUTO_SCROLL_MAX_STEP_PX,
): number {
  if (edge <= 0 || max <= 0 || rectBottom <= rectTop) return 0;
  const topZone = rectTop + edge;
  if (pointerY < topZone) {
    const ratio = Math.min(1, (topZone - pointerY) / edge);
    return -Math.max(1, Math.round(ratio * max));
  }
  const bottomZone = rectBottom - edge;
  if (pointerY > bottomZone) {
    const ratio = Math.min(1, (pointerY - bottomZone) / edge);
    return Math.max(1, Math.round(ratio * max));
  }
  return 0;
}

/** 从 `translateY(-12.5px)` 里取出位移值；无 transform 时为 0。 */
export function readTranslateY(transform: string): number {
  const match = /translateY\(\s*(-?[\d.]+)px\s*\)/.exec(transform);
  if (!match) return 0;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : 0;
}

/** 元素**布局**上缘（不含跟手 transform）：松手补偿要拿它做锚点。 */
export function layoutTopWithoutTransform(element: HTMLElement): number {
  return element.getBoundingClientRect().top - readTranslateY(element.style.transform);
}

/**
 * 松手后补偿「content-visibility 回落」造成的整页位移。
 *
 * 拖拽期所有分区都强制 `content-visibility: visible`（真实高度），松手后离屏分区退回
 * `contain-intrinsic-size` 占位高度 → 内容整体变矮 → 被拖卡（以及整页）在松手那一帧
 * 往上跳（真机实测长卡片跳 466px）。这里在 React 提交后的同一帧按「布局上缘变化量」
 * 反向补偿 scrollTop，让卡片视觉位置保持稳定。
 *
 * 用 `requestAnimationFrame` 而不是立即执行：class 的回退发生在 React 提交里，提交在
 * 事件结束时刷；rAF 回调仍在该帧绘制前，所以不会闪一帧。若浏览器滚动锚定已经补偿过，
 * 这里量到的差值≈0，不会重复补偿。
 */
/** 松手补偿最多收敛多少帧（到上限也必须恢复锚定，不能常驻 `none`）。 */
export const RELEASE_SETTLE_MAX_FRAMES = 10;
/** 连续多少帧残差 ≤1px 才认为布局稳定（`basic_info` 这类占位高回退会晚一帧）。 */
export const RELEASE_SETTLE_STABLE_FRAMES = 2;

export function compensateReleaseShift(
  element: HTMLElement,
  container: HTMLElement,
  beforeLayoutTop: number,
  afterRestore?: () => void,
): void {
  /**
   * 松手后的布局回落不是一次到位的：React 提交 + 各分区 `content-visibility` 占位高
   * 回退可能**跨帧**（真机实测 `basic_info` 的 420 → 458.3 比其它分区晚一帧，固定
   * 补 3 帧会漏掉那 38.3px）。所以改成「收敛式」：
   * - 每帧量残差并补掉；
   * - **连续两帧**残差 ≤1px 才恢复 `overflow-anchor`；
   * - 最多等 `RELEASE_SETTLE_MAX_FRAMES` 帧，到上限无条件恢复（绝不常驻 none）。
   *
   * 恢复仍要再隔一帧：同帧恢复时 Chrome 会把这次布局变动重新纳入锚定，与补偿叠加。
   */
  const finish = () => {
    if (afterRestore) window.requestAnimationFrame(afterRestore);
  };
  const settle = (remaining: number, stableFrames: number) => {
    window.requestAnimationFrame(() => {
      const afterLayoutTop = element.getBoundingClientRect().top;
      const delta = afterLayoutTop - beforeLayoutTop;
      const stable = Math.abs(delta) <= 1;
      if (!stable) container.scrollTop += delta;
      const nextStable = stable ? stableFrames + 1 : 0;
      if (nextStable >= RELEASE_SETTLE_STABLE_FRAMES || remaining <= 1) {
        finish();
        return;
      }
      settle(remaining - 1, nextStable);
    });
  };
  settle(RELEASE_SETTLE_MAX_FRAMES, 0);
}

/** 仅供测试：清空引用计数缓存（jsdom 里帧不一定跑，计数会跨用例残留）。 */
export function resetScrollAnchoringStateForTests(): void {
  anchoringStates.delete(document.documentElement);
}

/**
 * 拖拽期关闭浏览器滚动锚定（`overflow-anchor: none`），返回**幂等**的释放函数。
 *
 * 为什么必须关：换位会让被拖卡跨槽（实测跨 2 槽 = 890px），布局变动时 Chrome 的
 * scroll anchoring 会调 scrollTop 去"保持视口"，随后 `scroll` 事件又触发我们的几何
 * 平移与闩锁锚点平移 → 指针几乎不用动就再次换位 → 再 anchoring，形成正反馈：
 * QA 实测 B6c 10/10 翻转、邻卡 −594↔−1484 弹跳 890px；把 `.app-content` 的
 * `overflow-anchor` 关掉后同一抖动立刻回到 0/10。
 *
 * **引用计数**：松手补偿是跨帧收敛的，其间的窗口里用户可能已经开始下一次拖拽。
 * 若只记一个 `previous`，第二次 disable 会把 `previous` 记成 `"none"`，旧恢复随后
 * 执行就会把锚定重新打开（环路复现）。这里按容器计数：
 * - 只有 0→1 的那次记录真实 `previous` 并置 `none`；
 * - 每次释放只减计数，**计数归零**才恢复样式；
 * 因此旧回调即使在新拖拽开始后才执行，也只会还掉自己那份计数，不会碰样式
 * （比"发现序号变了就直接 return"更安全：直接 return 会泄漏一份 none，永远恢复不了）。
 */
const anchoringStates = new WeakMap<HTMLElement, { count: number; previous: string }>();

export function disableScrollAnchoring(container: HTMLElement): () => void {
  let state = anchoringStates.get(container);
  if (!state) {
    state = { count: 0, previous: container.style.getPropertyValue("overflow-anchor") };
    anchoringStates.set(container, state);
  }
  // 防御性重申：即使计数没归零（例如上一次拖拽的恢复还没跑），也保证当前是 none。
  if (container.style.getPropertyValue("overflow-anchor") !== "none") {
    container.style.setProperty("overflow-anchor", "none");
  }
  state.count += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = anchoringStates.get(container);
    if (!current) return;
    current.count -= 1;
    if (current.count > 0) return;
    if (current.previous) container.style.setProperty("overflow-anchor", current.previous);
    else container.style.removeProperty("overflow-anchor");
    anchoringStates.delete(container);
  };
}

export interface EdgeAutoScrollerOptions {
  /** 滚动容器（`resolveScrollParent` 的返回值）。 */
  container: HTMLElement;
  /** 每次真正发生滚动时回调滚动量（正数=内容上移，调用方据此平移 stackTop）。 */
  onTick: (scrollDelta: number) => void;
  /**
   * 该方向是否还有位移空间。返回 false 时本帧不滚动、也不再继续排帧
   * （下一次 `update` 会重新起帧，空间恢复后自动续上）。
   *
   * 用途：被拖卡已经 clamp 在栈底/栈顶时，指针继续贴边只会让页面空转——
   * 卡片钉住不动、页面狂滚，用户会以为拖拽失效（QA 实测空转 648px、跟手误差涨到 432.9px）。
   */
  canScroll?: (scrollDelta: number) => boolean;
  edge?: number;
  maxStep?: number;
}

export interface EdgeAutoScroller {
  /** 报告最新指针位置；还没起帧时起一帧。 */
  update: (pointerY: number) => void;
  /** 停止并取消挂起的 rAF（pointerup / pointercancel / 卸载必须调用）。 */
  stop: () => void;
}

/**
 * 创建一个按帧驱动的边缘滚动器。
 *
 * 只有「本帧确实滚动了」才继续排下一帧；指针不动时留给下一次 `update` 重新起帧，
 * 避免拖拽静止期间空转 rAF。`stop()` 幂等。
 */
export function createEdgeAutoScroller({
  container,
  onTick,
  canScroll,
  edge = AUTO_SCROLL_EDGE_PX,
  maxStep = AUTO_SCROLL_MAX_STEP_PX,
}: EdgeAutoScrollerOptions): EdgeAutoScroller {
  let pointerY = 0;
  let frame: number | null = null;
  let running = true;

  const step = () => {
    frame = null;
    if (!running) return;
    const isRoot = container === document.scrollingElement;
    const rect = isRoot ? null : container.getBoundingClientRect();
    const rectTop = rect ? rect.top : 0;
    const rectBottom = rect ? rect.bottom : window.innerHeight;
    const delta = edgeScrollDelta(pointerY, rectTop, rectBottom, edge, maxStep);
    if (delta === 0) return;
    // 该方向已经没有位移空间（被拖卡 clamp 在栈边界）：不滚、不排帧，避免空转。
    if (canScroll && !canScroll(delta)) return;
    const before = container.scrollTop;
    container.scrollTop = before + delta;
    const applied = container.scrollTop - before;
    if (applied === 0) return;
    onTick(applied);
    frame = window.requestAnimationFrame(step);
  };

  return {
    update(nextPointerY: number) {
      pointerY = nextPointerY;
      if (!running || frame !== null) return;
      frame = window.requestAnimationFrame(step);
    },
    stop() {
      running = false;
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
        frame = null;
      }
    },
  };
}
