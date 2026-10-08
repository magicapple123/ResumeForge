/** 投投浮窗卡片的把手拖拽：视口夹取、键盘微调与「出现在悬浮球旁边」的打开定位。 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from "react";

/** 拖动时留在视口里的最小边距（与悬浮球拖拽一致）。 */
const VIEWPORT_MARGIN = 8;
/** 顶部最小余量：卡片可以更高，但把手必须永远在视口内、可达。 */
const TOP_MARGIN = 8;
/** 位移超过这个距离才算拖动（阈值内松手是点击，不吞掉子元素的点击）。 */
const DRAG_THRESHOLD_PX = 4;
/** 键盘方向键一次微调的距离。 */
const KEYBOARD_STEP_PX = 16;
/** 卡片与悬浮球之间留的间隙。 */
const ORB_GAP_PX = 12;
/** 悬浮球的兜底几何（球未渲染或量不到时按 CSS 默认的右下角位置算）。 */
const DEFAULT_ORB_SIZE = 64;
const DEFAULT_ORB_EDGE = 24;

interface CardMetrics {
  width: number;
  height: number;
}

export interface UseTouTouCardDragOptions {
  /** 从把手向上找卡片根元素用的选择器（卡片自身挂定位样式）。 */
  selector?: string;
  /** jsdom / 未渲染时的兜底尺寸。 */
  fallbackWidth?: number;
  fallbackHeight?: number;
}

export interface CardDragState {
  gripRef: RefObject<HTMLDivElement | null>;
  /** 存在自由位置时叠在卡片上的内联定位（优先级高于一切默认定位规则）。 */
  cardStyle: CSSProperties;
  dragging: boolean;
  handlePointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  handleKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  /**
   * 打开卡片时调用：把卡片摆到**悬浮球旁边**（按球的实际位置与贴边方向计算）。
   * 上一次拖动的位置不跨开关保留——用户期望"从球打开 = 球旁边"。
   */
  placeNextToOrb: () => void;
}

function readCardMetrics(element: HTMLElement | null, fallback: CardMetrics): CardMetrics {
  if (!element) return fallback;
  const rect = element.getBoundingClientRect();
  return {
    width: rect.width || fallback.width,
    height: rect.height || fallback.height,
  };
}

/** 把视口内任一点夹回「卡片完全可见」的范围；窗口缩放后也要落在界内。 */
export function clampCardPosition(
  left: number,
  top: number,
  metrics: CardMetrics,
): { left: number; top: number } {
  const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - metrics.width - VIEWPORT_MARGIN);
  // 高度方向只需保住把手：底部允许伸出视口（视口比卡片矮时仍能拖回来）。
  const maxTop = Math.max(TOP_MARGIN, window.innerHeight - TOP_MARGIN);
  return {
    left: Math.min(Math.max(VIEWPORT_MARGIN, left), maxLeft),
    top: Math.min(Math.max(TOP_MARGIN, top), maxTop),
  };
}

function readOrbGeometry(): { left: number; top: number; size: number; edge: string } {
  // 球拖到任意位置后 getBoundingClientRect 是唯一准确的来源；量不到时按 CSS
  // 默认（贴右下角）计算。贴边方向从球的 shell 类名读取，与吸附逻辑同源。
  const shell = document.querySelector(".tt-shell");
  const classes = shell?.className ?? "";
  const edge = classes.includes("is-edge-left")
    ? "left"
    : classes.includes("is-edge-top")
      ? "top"
      : classes.includes("is-edge-bottom")
        ? "bottom"
        : "right";
  const orb = shell?.querySelector(".tt");
  if (orb instanceof HTMLElement) {
    const rect = orb.getBoundingClientRect();
    if (rect.width > 0) {
      return { left: rect.left, top: rect.top, size: rect.width, edge };
    }
  }
  return {
    left: window.innerWidth - DEFAULT_ORB_EDGE - DEFAULT_ORB_SIZE,
    top: window.innerHeight - DEFAULT_ORB_EDGE - DEFAULT_ORB_SIZE,
    size: DEFAULT_ORB_SIZE,
    edge,
  };
}

function positionNextToOrb(
  orb: { left: number; top: number; size: number; edge: string },
  metrics: CardMetrics,
): { left: number; top: number } {
  const gap = ORB_GAP_PX;
  switch (orb.edge) {
    case "left":
      // 球贴左 → 卡片在球右侧，顶部对齐球顶。
      return clampCardPosition(orb.left + orb.size + gap, orb.top, metrics);
    case "top":
      // 球贴顶 → 卡片在球下方，右缘对齐球右缘。
      return clampCardPosition(
        orb.left + orb.size - metrics.width,
        orb.top + orb.size + gap,
        metrics,
      );
    case "bottom":
      // 球贴底 → 卡片在球上方，右缘对齐球右缘。
      return clampCardPosition(
        orb.left + orb.size - metrics.width,
        orb.top - metrics.height - gap,
        metrics,
      );
    default:
      // 球贴右 → 卡片在球左侧，底缘对齐球底缘。
      return clampCardPosition(
        orb.left - metrics.width - gap,
        orb.top + orb.size - metrics.height,
        metrics,
      );
  }
}

/**
 * 卡片拖拽 hook（挂在顶部「把手」元素上）。
 *
 * 与悬浮球拖拽（`useTouTouOrbDrag`）的差异：卡片**不吸附**——要求只是"不允许拖出
 * 视口"，自由定位 + 夹取即可，不引入第二套吸附状态机与 `context.edge` 打架。
 * 拖动位置只在卡片本次打开期间有效：每次从悬浮球打开都会通过
 * `placeNextToOrb` 重新摆到球旁边。
 */
export function useTouTouCardDrag(options: UseTouTouCardDragOptions = {}): CardDragState {
  const { selector = ".tt-assistant-card", fallbackWidth = 760, fallbackHeight = 680 } = options;
  const fallback = useMemo<CardMetrics>(
    () => ({ width: fallbackWidth, height: fallbackHeight }),
    [fallbackHeight, fallbackWidth],
  );
  const [freePosition, setFreePosition] = useState<{ left: number; top: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const gripRef = useRef<HTMLDivElement>(null);
  const originRef = useRef<{
    left: number;
    pointerX: number;
    pointerY: number;
    top: number;
    metrics: CardMetrics;
  } | null>(null);
  const movedRef = useRef(false);

  /** selector 在卡片生命周期里不变，放 ref 里避免每次渲染重建监听。 */
  const optionsRef = useRef({ selector, fallback });
  // ref 写入放 effect（Compiler 禁止渲染期写 ref）：options 只在事件回调里被读。
  useEffect(() => {
    optionsRef.current = { selector, fallback };
  });

  const findCard = (): HTMLElement | null => {
    const card = gripRef.current?.closest(optionsRef.current.selector);
    return card instanceof HTMLElement ? card : null;
  };

  useEffect(() => {
    const handleResize = () => {
      setFreePosition((current) => {
        if (!current) return current;
        return clampCardPosition(
          current.left,
          current.top,
          readCardMetrics(findCard(), optionsRef.current.fallback),
        );
      });
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const cardStyle = useMemo<CSSProperties>(() => {
    if (!freePosition) return {};
    // 内联样式优先级高于一切默认定位规则（含媒体查询），自由定位与默认位互斥。
    return {
      bottom: "auto",
      left: freePosition.left,
      right: "auto",
      top: freePosition.top,
    };
  }, [freePosition]);

  /**
   * 打开时摆到球旁边：位置按球当下位置与**卡片实测尺寸**现算，上一次拖到哪里的
   * 记录不再使用。
   *
   * 尺寸必须现量：兜底值（如剪贴板卡的 360×600）比真实卡片高/矮时，贴边计算会被
   * 系统性推偏，负 top 被 `clampCardPosition` 夹到 (8, 8)＝屏幕左上角（用户实测的
   * 「剪贴板跑到了左上角」就是这个原因）。
   */
  const placeNextToOrb = useCallback(() => {
    const metrics = readCardMetrics(findCard(), optionsRef.current.fallback);
    setFreePosition(positionNextToOrb(readOrbGeometry(), metrics));
  }, []);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const card = findCard();
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const metrics = readCardMetrics(card, optionsRef.current.fallback);
    originRef.current = {
      left: rect.left,
      pointerX: event.clientX,
      pointerY: event.clientY,
      top: rect.top,
      metrics,
    };
    movedRef.current = false;
    setDragging(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);

    const handleMove = (moveEvent: globalThis.PointerEvent) => {
      const origin = originRef.current;
      if (!origin) return;
      const deltaX = moveEvent.clientX - origin.pointerX;
      const deltaY = moveEvent.clientY - origin.pointerY;
      if (Math.abs(deltaX) > DRAG_THRESHOLD_PX || Math.abs(deltaY) > DRAG_THRESHOLD_PX) {
        movedRef.current = true;
      }
      if (!movedRef.current) return;
      const next = clampCardPosition(origin.left + deltaX, origin.top + deltaY, origin.metrics);
      setFreePosition(next);
    };
    const handleUp = () => {
      originRef.current = null;
      setDragging(false);
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
  };

  /** 键盘可访问性：聚焦把手后方向键微调，Enter/Esc 无动作（把手不是按钮）。 */
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? KEYBOARD_STEP_PX * 4 : KEYBOARD_STEP_PX;
    const deltas: Record<string, [number, number]> = {
      ArrowDown: [0, step],
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
    };
    const delta = deltas[event.key];
    if (!delta) return;
    event.preventDefault();
    setFreePosition((current) => {
      const card = findCard();
      const metrics = readCardMetrics(card, optionsRef.current.fallback);
      const base = current ?? {
        left: card ? card.getBoundingClientRect().left : VIEWPORT_MARGIN,
        top: card ? card.getBoundingClientRect().top : TOP_MARGIN,
      };
      return clampCardPosition(base.left + delta[0], base.top + delta[1], metrics);
    });
  };

  return { cardStyle, dragging, gripRef, handleKeyDown, handlePointerDown, placeNextToOrb };
}
