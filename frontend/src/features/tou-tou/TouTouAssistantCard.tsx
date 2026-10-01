/** 投投浮窗助手：只负责卡片外壳，内部直接复用侧栏助手页面能力。 */

import type { ReactNode } from "react";
import { useTouTou } from "./touTouContext";
import "./tou-tou-assistant.css";

interface Props {
  children: ReactNode;
  onClose: () => void;
  open: boolean;
}

export default function TouTouAssistantCard({ children, onClose, open }: Props) {
  const { edge } = useTouTou();
  if (!open) return null;

  return (
    <section
      className={`tt-assistant-card is-edge-${edge}`}
      role="dialog"
      aria-label="投投求职助手"
      aria-describedby="tt-assistant-card-description"
    >
      <p id="tt-assistant-card-description" className="tt-assistant-card-sr-only">
        投投可以帮助你解决简历通使用问题、分析简历和岗位，并在明确要求时操作允许的数据。
      </p>
      <button
        type="button"
        className="tt-assistant-card-close"
        aria-label="关闭投投助手"
        onClick={onClose}
      >
        ×
      </button>
      {children}
    </section>
  );
}
