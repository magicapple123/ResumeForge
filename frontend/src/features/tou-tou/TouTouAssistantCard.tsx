// SPDX-License-Identifier: Apache-2.0
/**
 * 投投浮窗助手：只负责卡片外壳（含可拖动把手），内部直接复用侧栏助手页面能力。
 *
 * 焦点相关的两件事不在这里做，但必须知道它们存在：
 * - **不让弹窗的焦点陷阱把焦点抢走**：由 `touTouCardGuards.ts` 在 document 冒泡阶段
 *   拦截（`AppShell` 启动时装一次）。本组件只负责"焦点真的进来之后"的行为。
 * - **打开即聚焦输入框**：卡片不自己聚焦。`AssistantPage` 收 `autoFocusComposer`
 *   后交给 `AssistantComposer`，由它在 textarea 真正挂载时聚焦 —— 这里 `children`
 *   是 `Suspense` 包着的懒加载页面，卡片先渲染、textarea 后挂载，裸 `autoFocus`
 *   会落空。
 *
 * 本卡的 Esc 分两层：document 那层（守卫）负责"别顺带关掉下层弹窗"，卡片根节点这
 * 一层负责"关掉卡片自己"。
 */

import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { useEffect, useRef } from "react";
import { ConfigProvider } from "antd";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { layer } from "../../theme/tokens";
import { useTouTou } from "./touTouContext";
import { useTouTouCardDrag } from "./useTouTouCardDrag";
import { shouldTouTouCardCloseOnKeyDown } from "./touTouCardGuards";
import "./tou-tou-assistant.css";

interface Props {
  children: ReactNode;
  onClose: () => void;
  open: boolean;
}

export default function TouTouAssistantCard({ children, onClose, open }: Props) {
  useLocale();
  const { edge } = useTouTou();
  // 豁免判定的基准节点（"卡片内有没有开着的弹层"要问它）。
  const cardRef = useRef<HTMLElement | null>(null);
  // 拖拽 hook 必须在 `open` 早退之前调用：条件调用会打乱 React hooks 的调用序约束。
  const { cardStyle, dragging, gripRef, handleKeyDown, handlePointerDown, placeNextToOrb } =
    useTouTouCardDrag();
  // 每次从悬浮球打开都重新摆到球旁边：上一次拖动的位置不跨开关保留。
  useEffect(() => {
    if (open) placeNextToOrb();
  }, [open, placeNextToOrb]);
  // Esc 关卡片：`shouldTouTouCardCloseOnKeyDown` 里已经排除输入法组合、被内层
  // preventDefault、以及 `+` 面板正开着这三种情况（详见该函数注释）。
  // 内层用 React `stopPropagation()` 消费掉的 Esc 根本到不了这里。
  // 传 `nativeEvent`：`isComposing` 只在原生事件上（React 合成事件没有这个字段）。
  const handleCardKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (shouldTouTouCardCloseOnKeyDown(event.nativeEvent, cardRef.current)) onClose();
  };
  if (!open) return null;

  return (
    // 类名是守卫的豁免判据（`TOU_TOU_FOCUS_EXEMPT_SELECTOR`）：改名要两边一起改，
    // `touTouCardGuards.test.ts` 有一条用例把这两个字面量钉在一起。
    <section
      ref={cardRef}
      className={`tt-assistant-card is-edge-${edge}${dragging ? " is-dragging" : ""}`}
      role="dialog"
      aria-label={t("touTou.assistant.ariaLabel")}
      aria-describedby="tt-assistant-card-description"
      style={cardStyle}
      onKeyDown={handleCardKeyDown}
    >
      <p id="tt-assistant-card-description" className="tt-assistant-card-sr-only">
        {t("touTou.assistant.description")}
      </p>
      {/*
        把手：按住这里拖动卡片。放在卡片最上层、关闭按钮（z-index: 4）之下——
        把手区域内没有其它交互元素，拖拽与点击天然互斥。
      */}
      <div
        ref={gripRef}
        className="tt-assistant-card-grip"
        role="button"
        tabIndex={0}
        aria-label={t("touTou.assistant.gripLabel")}
        title={t("touTou.assistant.gripTitle")}
        onPointerDown={handlePointerDown}
        onKeyDown={handleKeyDown}
      />
      <button
        type="button"
        className="tt-assistant-card-close"
        aria-label={t("touTou.assistant.close")}
        onClick={onClose}
      >
        ×
      </button>
      {/*
        卡片内弹层基准抬层：全局 zIndexPopupBase（3100）配 antd 的组件偏移
        （+50~+80）到不了卡片（3400）之上，Select 下拉 / Tooltip / 图片预览从
        这里挂到 body 后会被卡片盖住（用户看是"下拉被裁掉"）。局部把基准提到
        layer.cardPopup（3550），弹层落在 3600~3630——卡片之上、悬浮球（3650）
        之下，球随时可以点。其余 token 全部继承全局主题。
      */}
      <ConfigProvider theme={{ token: { zIndexPopupBase: layer.cardPopup } }}>
        {children}
      </ConfigProvider>
    </section>
  );
}
