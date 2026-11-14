// SPDX-License-Identifier: Apache-2.0
/**
 * 输入区工具栏的「上下文用量」chip（需求 #6）。
 *
 * 一枚只读 chip + 一个点击弹层：chip 本身只回答"占了多少"，点开才是五段构成与窗口设置。
 * 三条硬约束：
 *
 * 1. **不猜数字**：窗口未设置或还没拿到用量时显示 `上下文 —`，不显示 0%（那会被读成
 *    "一点都没用"，而事实是没有分母）。
 * 2. **窄栏只留细环 + 百分比**：容器是输入区自己（`.assistant-composer` 已有
 *    `container-type: inline-size`），所以用 `@container` 判窄、不用视口断点——左栏
 *    可以被拖到 380px，视口看不出来。
 * 3. **弹层是 Popover 不是 Modal**：它是只读信息面板 + 一个下拉，开着也不挡对话。
 */

import { Button, Popover } from "antd";
import { useState } from "react";
import { t } from "../../../../i18n";
import { useLocale } from "../../../../i18n/i18nContext";
import { contextArcPercent, contextUsageLevel, formatPercentShort } from "../../contextUsageFormat";
import type { ContextUsage } from "../../../../types";
import ContextUsagePopover from "./ContextUsagePopover";

export interface ContextUsageChipProps {
  usage: ContextUsage | null;
  /** 窗口写回成功后由上层重算本地用量（不必重新请求一次）。 */
  onWindowSaved?: (windowTokens: number) => void;
  /** 压缩 / 还原要按会话调用（#10）；不传时弹层里的压缩动作禁用。 */
  conversationId?: number | null;
  /** 压缩或还原成功后让上层重取用量。 */
  onContextChanged?: () => void;
}

export default function ContextUsageChip({
  usage,
  onWindowSaved,
  conversationId = null,
  onContextChanged,
}: ContextUsageChipProps) {
  useLocale();
  const [open, setOpen] = useState(false);
  // 窗口 0 = 没有分母：chip 上显示「—」，弹层里给「未设置上下文窗口」+ 去设置。
  const percent = usage && usage.window > 0 ? usage.percent : null;
  const percentText = formatPercentShort(percent);
  const level = contextUsageLevel(percent);
  const aria = t("contextUsage.aria.chip");

  return (
    <Popover
      open={open}
      trigger="click"
      placement="topRight"
      onOpenChange={setOpen}
      content={
        <ContextUsagePopover
          usage={usage}
          onClose={() => setOpen(false)}
          onWindowSaved={onWindowSaved}
          conversationId={conversationId}
          onContextChanged={onContextChanged}
        />
      }
    >
      <Button
        type="text"
        size="small"
        className="assistant-context-usage-chip"
        aria-label={aria}
        title={aria}
        aria-expanded={open}
      >
        <span className={`assistant-context-usage-chip-inner is-${level}`}>
          {/* 环形进度是纯装饰：语义由 aria-label 提供，读屏不多念一个空图形。
              弧长走 pathLength=100，这样 dasharray 直接写百分比，不用算周长。 */}
          <svg
            className="assistant-context-usage-ring"
            viewBox="0 0 16 16"
            width="16"
            height="16"
            aria-hidden="true"
            focusable="false"
          >
            <circle
              className="assistant-context-usage-ring-track"
              cx="8"
              cy="8"
              r="7"
              fill="none"
              strokeWidth="2"
            />
            {percent === null ? null : (
              <circle
                className="assistant-context-usage-ring-arc"
                cx="8"
                cy="8"
                r="7"
                fill="none"
                strokeWidth="2"
                strokeLinecap="round"
                pathLength={100}
                strokeDasharray={`${contextArcPercent(percent)} 100`}
                transform="rotate(-90 8 8)"
              />
            )}
          </svg>
          <span className="assistant-context-usage-chip-value">{percentText}</span>
        </span>
      </Button>
    </Popover>
  );
}
