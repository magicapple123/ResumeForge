// SPDX-License-Identifier: Apache-2.0
/**
 * 投投的低打扰提示气泡（#27B / #27D）。
 *
 * 从"8 条轮播标语"改成"页面信号驱动"：谁调它谁给 `text`（信号文案 key）与可选动作，
 * 组件本身不含定时器、不含文案表。两个动作按钮：
 * - 主行动（"处理一下"）：跳到该信号对应的动作；
 * - 「这类别再提示」：静音该信号类别（#27D 的每条建议都带这个出口）。
 */

import { useRef } from "react";
import { t, type MessageKey, type MessageParams } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { useTouTouAnchoredCard } from "./useTouTouAnchoredCard";

interface TouTouTipProps {
  onClose: () => void;
  /**
   * 文案 **key**，不是成品文案：翻译必须发生在渲染期——表里存成品字符串会把语言
   * 钉死在模块求值那一刻。这里漏掉 `t()` 时，气泡会把 key 原样显示给用户。
   */
  text: MessageKey;
  params?: MessageParams;
  /** 主行动文案；不给则只显示说明 + 关闭。 */
  actionLabel?: MessageKey;
  onAction?: () => void;
  /** 「这类别再提示」；不给则没有静音出口（例如系统级提示）。 */
  muteLabel?: MessageKey;
  onMute?: () => void;
}

export default function TouTouTip({
  onClose,
  text,
  params,
  actionLabel,
  onAction,
  muteLabel,
  onMute,
}: TouTouTipProps) {
  useLocale();
  // 贴上下边时气泡靠 `left: 50%` 居中，球被拖到左右两侧后又挂在球旁边——两种摆法都
  // 可能撞出视口。这里只算水平位置（withTail=false）：垫高/居中的纵向规则仍归 CSS。
  const tipRef = useRef<HTMLDivElement>(null);
  const anchoredStyle = useTouTouAnchoredCard(tipRef, { withTail: false });

  return (
    <div className="tt-tip" style={anchoredStyle} ref={tipRef} role="status" aria-live="polite">
      <div className="tt-tip-body">
        <span className="tt-tip-text">{t(text, params)}</span>
        {actionLabel || muteLabel ? (
          <span className="tt-tip-actions">
            {actionLabel ? (
              <button type="button" className="tt-tip-action" onClick={onAction}>
                {t(actionLabel)}
              </button>
            ) : null}
            {muteLabel ? (
              <button type="button" className="tt-tip-mute" onClick={onMute}>
                {t(muteLabel)}
              </button>
            ) : null}
          </span>
        ) : null}
      </div>
      <button
        type="button"
        className="tt-tip-close"
        aria-label={t("touTou.tip.close")}
        onClick={onClose}
      >
        ×
      </button>
    </div>
  );
}
