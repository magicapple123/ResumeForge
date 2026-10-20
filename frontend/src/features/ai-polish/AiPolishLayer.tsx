// SPDX-License-Identifier: Apache-2.0
/**
 * 全局 AI 润色：选中一段文字后**右键**，指针旁浮出文本菜单；选区落在可编辑元素里时
 * 菜单里多一项「AI 润色」。
 *
 * 为什么挂在 `MainLayout` 根节点、并且用 `createPortal` 到 `body`：编辑器、岗位详情
 * 都是 antd 弹窗，它们把内容挂到 `body` 末尾。只有文档级监听 + body 级门户才能既听见
 * 那些弹窗里的选区，又把菜单画在它们之上。
 *
 * 为什么不再「选中就弹按钮」：选字是复制粘贴、拖拽、双击选中这些日常动作的一部分，
 * 每到一处都顶出一个按钮会打断它们。右键是用户明确表达「对这段文字做点什么」。
 *
 * 隐私边界：这里只把 `target.text`（用户选中的那一段）交给卡片，卡片也只把它发给
 * 后端——不读简历、不带字段上下文。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { layer } from "../../theme/tokens";
import AiPolishCard from "./AiPolishCard";
import SelectionContextMenu from "./SelectionContextMenu";
import { getSelectionTarget, type SelectionTarget } from "./selectionTarget";
import "../../styles/aiPolish.css";

/** 与视口边缘的最小间距。 */
const VIEWPORT_MARGIN = 8;
/** 菜单尺寸的估算值：只用于"不要整块掉出视口"的夹取（5 项 ≈ 150×210）。 */
const MENU_WIDTH = 150;
const MENU_HEIGHT = 210;
const CARD_WIDTH = 344;
/** 卡片高度的估算值：只用于"不要整张掉出视口"的夹取。 */
const CARD_ESTIMATED_HEIGHT = 420;
/** 卡片与菜单之间留一点缝，避免两张浮层贴在一起。 */
const CARD_GAP = 6;

interface Anchor {
  left: number;
  top: number;
}

interface MenuState {
  /** 指针位置（已夹进视口）。 */
  x: number;
  y: number;
  /** 选区在可编辑元素里时才有；决定菜单里出不出现「AI 润色」。 */
  target: SelectionTarget | null;
  /** 选中的文字。非可编辑区里没有 `target`，只能靠它复制。 */
  text: string;
}

function clamp(value: number, min: number, max: number): number {
  // 视口窄于控件时 max < min：此时贴着左边，保证起点可见。
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

/** 卡片挂在菜单下方，与菜单左对齐（都已夹进视口）。 */
function cardAnchor(menu: MenuState): Anchor {
  return {
    left: clamp(menu.x, VIEWPORT_MARGIN, window.innerWidth - CARD_WIDTH - VIEWPORT_MARGIN),
    top: clamp(
      menu.y + MENU_HEIGHT + CARD_GAP,
      VIEWPORT_MARGIN,
      window.innerHeight - CARD_ESTIMATED_HEIGHT - VIEWPORT_MARGIN,
    ),
  };
}

export default function AiPolishLayer() {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [card, setCard] = useState<{ target: SelectionTarget; anchor: Anchor } | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      const node = event.target;
      // 卡片自己的输入框里右键是用户在写字：放行原生菜单。
      if (node instanceof Node && cardRef.current?.contains(node)) return;

      const selection = window.getSelection();
      const target = getSelectionTarget();
      // `target` 覆盖 input/textarea（选区不在 `window.getSelection()` 里），
      // 否则用文档选区兜底，这样普通段落里的文字也能复制。
      const text = target?.text || selection?.toString() || "";
      // 没有选中文字：不拦截，保持浏览器原生菜单。
      if (!text.trim()) return;

      event.preventDefault();
      setMenu({
        x: clamp(event.clientX, VIEWPORT_MARGIN, window.innerWidth - MENU_WIDTH - VIEWPORT_MARGIN),
        y: clamp(
          event.clientY,
          VIEWPORT_MARGIN,
          window.innerHeight - MENU_HEIGHT - VIEWPORT_MARGIN,
        ),
        target,
        text,
      });
    };

    document.addEventListener("contextmenu", onContextMenu);
    return () => document.removeEventListener("contextmenu", onContextMenu);
  }, []);

  useEffect(() => {
    if (!card) return;
    const close = () => setCard(null);
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

  const closeMenu = useCallback(() => {
    setMenu(null);
  }, []);

  const openCard = useCallback(() => {
    if (!menu?.target) return;
    setCard({ target: menu.target, anchor: cardAnchor(menu) });
    setMenu(null);
  }, [menu]);

  const closeCard = useCallback(() => {
    setCard(null);
  }, []);

  return createPortal(
    <>
      {menu && (
        <SelectionContextMenu
          x={menu.x}
          y={menu.y}
          target={menu.target}
          text={menu.text}
          onClose={closeMenu}
          onAiPolish={openCard}
        />
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
