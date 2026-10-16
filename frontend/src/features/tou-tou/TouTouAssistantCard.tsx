/** 投投浮窗助手：只负责卡片外壳（含可拖动把手），内部直接复用侧栏助手页面能力。 */

import type { ReactNode } from "react";
import { useEffect } from "react";
import { ConfigProvider } from "antd";
import { layer } from "../../theme/tokens";
import { useTouTou } from "./touTouContext";
import { useTouTouCardDrag } from "./useTouTouCardDrag";
import "./tou-tou-assistant.css";

interface Props {
  children: ReactNode;
  onClose: () => void;
  open: boolean;
}

export default function TouTouAssistantCard({ children, onClose, open }: Props) {
  const { edge } = useTouTou();
  // 拖拽 hook 必须在 `open` 早退之前调用：条件调用会打乱 React hooks 的调用序约束。
  const { cardStyle, dragging, gripRef, handleKeyDown, handlePointerDown, placeNextToOrb } =
    useTouTouCardDrag();
  // 每次从悬浮球打开都重新摆到球旁边：上一次拖动的位置不跨开关保留。
  useEffect(() => {
    if (open) placeNextToOrb();
  }, [open, placeNextToOrb]);
  if (!open) return null;

  return (
    <section
      className={`tt-assistant-card is-edge-${edge}${dragging ? " is-dragging" : ""}`}
      role="dialog"
      aria-label="投投求职助手"
      aria-describedby="tt-assistant-card-description"
      style={cardStyle}
    >
      <p id="tt-assistant-card-description" className="tt-assistant-card-sr-only">
        投投可以帮助你解决简历通使用问题、分析简历和岗位，并在明确要求时操作允许的数据。
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
        aria-label="拖动投投助手卡片"
        title="按住拖动卡片"
        onPointerDown={handlePointerDown}
        onKeyDown={handleKeyDown}
      />
      <button
        type="button"
        className="tt-assistant-card-close"
        aria-label="关闭投投助手"
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
