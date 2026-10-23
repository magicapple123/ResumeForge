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
import { cardAnchor, clamp, VIEWPORT_MARGIN } from "./overlayGeometry";
import type { Anchor, MenuState } from "./overlayGeometry";
import { getSelectionTarget, type SelectionTarget } from "./selectionTarget";
import "../../styles/aiPolish.css";

/** 菜单尺寸的估算值：只用于"不要整块掉出视口"的夹取（5 项 ≈ 150×210）。 */
const MENU_WIDTH = 150;
/** 右键菜单的高度估算：只用于把菜单本身夹进视口。 */
const MENU_HEIGHT = 210;

/**
 * 当前打开的 antd 弹窗里，卡片应该挂到哪一层。
 *
 * **为什么不能一律挂 body**：antd Modal 用焦点陷阱把焦点限制在 `.ant-modal` 子树里。
 * 卡片 portal 到 body 时在陷阱之外——点它的输入框，焦点会被拉回弹窗内最近的可聚焦
 * 元素（实测是右上角的关闭按钮），用户看到的就是"卡片明明在，字却一个也打不进去"
 * （2026-10-21 用户在手动调整里遇到的正是这个）。
 *
 * 挂 `.ant-modal` 而不是它的父层 `.ant-modal-wrap`：陷阱的根是 `role="dialog"` 的
 * `.ant-modal` 本身，落在 wrap 里仍算"外面"（实测焦点照样被拉走）。`.ant-modal`
 * 在入场动画结束后不带 transform，卡片自身的 `position: fixed` 仍按视口定位。
 *
 * 没有弹窗时返回 null（由调用方退回 body）——普通页面里没有焦点陷阱这回事。
 */
function modalPortalHost(): HTMLElement | null {
  const dialogs = Array.from(document.querySelectorAll<HTMLElement>(".ant-modal")).filter(
    (element) => element.getClientRects().length > 0 && element.style.display !== "none",
  );
  return dialogs.length > 0 ? dialogs[dialogs.length - 1] : null;
}

/**
 * 卡片落位的纯计算在 `overlayGeometry.ts`（见那里的 `cardAnchor`）：组件文件只导出
 * 组件，热更新才不会因为"顺手导出个函数"而整块刷新。
 */
export default function AiPolishLayer() {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [card, setCard] = useState<{
    target: SelectionTarget;
    anchor: Anchor;
    /** 卡片要挂到哪个容器：见 `modalPortalHost()`。 */
    host: HTMLElement | null;
  } | null>(null);
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
      const node = event.target;
      // 卡片自己的滚动（原文预览、结果框）不该把卡片关掉。
      if (node instanceof Node && cardRef.current?.contains(node)) return;
      // **焦点在卡片里时也不关**（2026-10-21）：卡片是 fixed 定位，页面一滚就与选区
      // 脱节，所以原本"滚动即关闭"。但用户正在卡片里打字时，`autoSize` 让输入框变高、
      // 浏览器为了露出光标会把外层弹窗滚一下——那次滚动与"用户离开了选区"毫无关系，
      // 却会让卡片当场消失，表现就是"输入框打不上字"（实际是卡片被关掉了）。
      const active = document.activeElement;
      if (active instanceof Node && cardRef.current?.contains(active)) return;
      // 滚动事件在捕获阶段监听，滚动容器可能是任何祖先：只有"滚动源在卡片外"才关。
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
    // 宿主在**打开这一刻**算好（不在渲染里读 DOM）：一次定死，避免先挂 body 再搬进
    // 弹窗导致卡片重新挂载、用户已经输入的要求被清空。
    setCard({ target: menu.target, anchor: cardAnchor(menu), host: modalPortalHost() });
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
      {card &&
        createPortal(
          <div className="rf-ai-polish-host" ref={cardRef} style={{ zIndex: layer.aiPolish }}>
            {/* key = 这一段选区的身份（偏移 + 长度，不用全文：超长文本当 key 太重）。
                不加它，React 会把同一个 `AiPolishCard` 实例复用到下一段文字上，卡片里
                上一段的改写结果、要求、错误全留着——「替换选中」于是能把**上一段**的
                结果写进新选区，直接改坏用户数据（2026-10-21 QA 复核 D2）。 */}
            <AiPolishCard
              key={`${card.target.start}:${card.target.end}:${card.target.text.length}`}
              target={card.target}
              left={card.anchor.left}
              top={card.anchor.top}
              onClose={closeCard}
              onReplaced={closeCard}
            />
          </div>,
          // 弹窗里必须挂进 `.ant-modal-wrap`（焦点陷阱之内），否则点输入框就会被
          // 拉回弹窗的关闭按钮——`modalPortalHost()` 的注释里写了完整原因。
          card.host ?? document.body,
        )}
    </>,
    document.body,
  );
}
