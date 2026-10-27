// SPDX-License-Identifier: Apache-2.0
/** 投投的低打扰提示气泡。 */

import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

interface TouTouTipProps {
  onClose: () => void;
  text: string;
}

export default function TouTouTip({ onClose, text }: TouTouTipProps) {
  useLocale();
  return (
    <div className="tt-tip" role="status" aria-live="polite">
      <span>{text}</span>
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
