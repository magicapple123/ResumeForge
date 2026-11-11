// SPDX-License-Identifier: Apache-2.0
/**
 * 长回答折叠（#13B）：内容高度超过阈值时折到 480px，底部渐隐 +「展开全文（还有 N 行）」。
 *
 * 只包助手消息（用户消息不折）。展开状态不持久（刷新回到折叠）——刻意如此：
 * 否则一条长回答会把整个消息列表永久撑高。折叠只影响显示：复制走完整正文（见
 * AssistantMessageActions 的复制实现），不是可见部分。
 */
import { DownOutlined, UpOutlined } from "@ant-design/icons";
import { Button } from "antd";
import { useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";

/** 折叠高度阈值（px）。CSS 里 .assistant-message-collapse-fade 的渐隐高度与之一致。 */
export const MESSAGE_COLLAPSE_HEIGHT = 480;
/** 量不到真实行高时的兜底：16px 字号 × 1.5 行距。 */
const DEFAULT_LINE_HEIGHT = 24;

interface Props {
  /** 只有助手消息需要折叠；其他角色直接渲染 children（不测高、不包 DOM）。 */
  enabled: boolean;
  /** 内容变化（流式增量/切换消息）时重新测高。 */
  content: string;
  children: ReactNode;
}

export default function MessageCollapse({ enabled, content, children }: Props) {
  useLocale();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [remainingLines, setRemainingLines] = useState(1);

  useLayoutEffect(() => {
    if (!enabled) return;
    const element = bodyRef.current;
    if (!element) return;
    // scrollHeight 不受 max-height 影响：折叠态下量的仍是完整内容高度。
    const nextOverflowing = element.scrollHeight > MESSAGE_COLLAPSE_HEIGHT;
    setOverflowing(nextOverflowing);
    if (!nextOverflowing) {
      setExpanded(false);
      setRemainingLines(0);
      return;
    }
    const lineHeight = Number.parseFloat(window.getComputedStyle(element).lineHeight);
    const resolvedLineHeight =
      Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : DEFAULT_LINE_HEIGHT;
    setRemainingLines(
      Math.max(1, Math.ceil((element.scrollHeight - MESSAGE_COLLAPSE_HEIGHT) / resolvedLineHeight)),
    );
  }, [enabled, content]);

  // 不需要折叠（非助手消息 / 未超过阈值）：不额外包一层，保持原 DOM 结构。
  if (!enabled || !overflowing) {
    return <div ref={bodyRef}>{children}</div>;
  }

  return (
    <div className={`assistant-message-collapse${expanded ? " is-expanded" : " is-collapsed"}`}>
      <div
        ref={bodyRef}
        className="assistant-message-collapse-body"
        style={expanded ? undefined : { maxHeight: MESSAGE_COLLAPSE_HEIGHT }}
      >
        {children}
      </div>
      {!expanded && <div className="assistant-message-collapse-fade" aria-hidden="true" />}
      <Button
        type="text"
        size="small"
        className="assistant-message-collapse-toggle"
        icon={expanded ? <UpOutlined /> : <DownOutlined />}
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        {expanded
          ? t("assistantUi.collapse.collapse")
          : t("assistantUi.collapse.expand", { lines: remainingLines })}
      </Button>
    </div>
  );
}
