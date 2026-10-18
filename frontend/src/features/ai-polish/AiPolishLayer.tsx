/**
 * 全局 AI 润色：选中任意输入框（或可编辑区）里的一段文字后，选区下方浮出「AI 润色」。
 *
 * 为什么挂在 `MainLayout` 根节点、并且用 `createPortal` 到 `body`：编辑器、岗位详情
 * 都是 antd 弹窗，它们把内容挂到 `body` 末尾。只有文档级监听 + body 级门户才能既听见
 * 那些弹窗里的选区，又把按钮画在它们之上。
 *
 * 隐私边界：这里只把 `target.text`（用户选中的那一段）交给卡片，卡片也只把它发给
 * 后端——不读简历、不带字段上下文。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { layer } from "../../theme/tokens";
import AiPolishCard from "./AiPolishCard";
import type { SelectionRect } from "./measureSelectionRect";
import { getSelectionTarget, type SelectionTarget } from "./selectionTarget";
import "../../styles/aiPolish.css";

/** 选区变化的观察防抖：拖选过程中 `selectionchange` 会连发几十次。 */
const DEBOUNCE_MS = 150;
/** 与视口边缘的最小间距。 */
const VIEWPORT_MARGIN = 8;
const TRIGGER_WIDTH = 96;
const TRIGGER_HEIGHT = 28;
/** 按钮与选区之间留一点缝，避免遮住最后一行字。 */
const TRIGGER_GAP = 6;
const CARD_WIDTH = 344;
/** 卡片高度的估算值：只用于"不要整张掉出视口"的夹取。 */
const CARD_ESTIMATED_HEIGHT = 420;

interface Anchor {
  left: number;
  top: number;
}

function clamp(value: number, min: number, max: number): number {
  // 视口窄于控件时 max < min：此时贴着左边，保证起点可见。
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

function triggerAnchor(rect: SelectionRect): Anchor {
  return {
    left: clamp(rect.left, VIEWPORT_MARGIN, window.innerWidth - TRIGGER_WIDTH - VIEWPORT_MARGIN),
    top: clamp(
      rect.bottom + TRIGGER_GAP,
      VIEWPORT_MARGIN,
      window.innerHeight - TRIGGER_HEIGHT - VIEWPORT_MARGIN,
    ),
  };
}

function cardAnchor(triggerTop: number, rect: SelectionRect): Anchor {
  return {
    left: clamp(rect.left, VIEWPORT_MARGIN, window.innerWidth - CARD_WIDTH - VIEWPORT_MARGIN),
    top: clamp(
      triggerTop + TRIGGER_HEIGHT + 4,
      VIEWPORT_MARGIN,
      window.innerHeight - CARD_ESTIMATED_HEIGHT - VIEWPORT_MARGIN,
    ),
  };
}

export default function AiPolishLayer() {
  const [trigger, setTrigger] = useState<{ target: SelectionTarget; anchor: Anchor } | null>(null);
  const [card, setCard] = useState<{ target: SelectionTarget; anchor: Anchor } | null>(null);
  /** 卡片打开期间冻结按钮的重新计算（否则卡片里的输入会把选区变化传进来）。 */
  const cardOpenRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(() => {
    if (cardOpenRef.current) return;
    const next = getSelectionTarget();
    setTrigger(next ? { target: next, anchor: triggerAnchor(next.rect) } : null);
  }, []);

  useEffect(() => {
    const schedule = () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        refresh();
      }, DEBOUNCE_MS);
    };
    // selectionchange 覆盖键盘选择与拖选，mouseup/keyup 覆盖"选区没变但焦点换了"的情况。
    document.addEventListener("selectionchange", schedule);
    document.addEventListener("mouseup", schedule);
    document.addEventListener("keyup", schedule);
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      document.removeEventListener("selectionchange", schedule);
      document.removeEventListener("mouseup", schedule);
      document.removeEventListener("keyup", schedule);
    };
  }, [refresh]);

  useEffect(() => {
    if (!card) return;
    const close = () => {
      cardOpenRef.current = false;
      setCard(null);
    };
    const onScroll = (event: Event) => {
      // 卡片自己的滚动（原文预览、结果框）不该把卡片关掉。
      const node = event.target;
      if (node instanceof Node && cardRef.current?.contains(node)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [card]);

  const openCard = useCallback(() => {
    if (!trigger) return;
    cardOpenRef.current = true;
    setCard({
      target: trigger.target,
      anchor: cardAnchor(trigger.anchor.top, trigger.target.rect),
    });
    setTrigger(null);
  }, [trigger]);

  const closeCard = useCallback(() => {
    cardOpenRef.current = false;
    setCard(null);
    setTrigger(null);
  }, []);

  return createPortal(
    <>
      {trigger && !card && (
        // 原生 button 而不是 antd Button：后者自带 `position: relative` 等样式，
        // 会和这里的 fixed 定位抢同一条声明（antd 的 CSS-in-JS 注入更晚，会赢）。
        <button
          type="button"
          className="rf-ai-polish-trigger"
          style={{ left: trigger.anchor.left, top: trigger.anchor.top, zIndex: layer.aiPolish }}
          // 保住输入框里的选区：点按钮不该让"要改的那段文字"先被取消选中。
          onMouseDown={(event) => event.preventDefault()}
          onClick={openCard}
        >
          AI 润色
        </button>
      )}
      {card && (
        <div className="rf-ai-polish-host" ref={cardRef} style={{ zIndex: layer.aiPolish }}>
          <AiPolishCard
            target={card.target}
            left={card.anchor.left}
            top={card.anchor.top}
            onClose={closeCard}
            onReplaced={closeCard}
          />
        </div>
      )}
    </>,
    document.body,
  );
}
