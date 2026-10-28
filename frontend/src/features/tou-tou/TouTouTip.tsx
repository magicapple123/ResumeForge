// SPDX-License-Identifier: Apache-2.0
/** 投投的低打扰提示气泡。 */

import { t, type MessageKey } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

interface TouTouTipProps {
  onClose: () => void;
  /**
   * 文案 **key**，不是成品文案：标语表（`touTouTips.ts`）只存 key，翻译必须发生在
   * 渲染期——表里存成品字符串会把语言钉死在模块求值那一刻。这里漏掉 `t()` 时，气泡
   * 会把 `touTou.tips.results` 这样的 key 原样显示给用户（中英文都一样）。
   */
  text: MessageKey;
}

export default function TouTouTip({ onClose, text }: TouTouTipProps) {
  useLocale();
  return (
    <div className="tt-tip" role="status" aria-live="polite">
      <span>{t(text)}</span>
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
