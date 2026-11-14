// SPDX-License-Identifier: Apache-2.0
/**
 * 「提前压缩」阈值：给当前对话单独设一个 token 数，不设就跟随全局默认。
 *
 * 上限固定为窗口的 90%（与后端 `SAFE_WINDOW_RATIO` 同一口径）：再往上请求会被 provider
 * 直接 400。`thresholdTokens === null` 表示「跟随默认」，输入框显示为空——不要填一个
 * 看上去像用户设过的数字，否则用户会以为自己改过。
 */
import { InputNumber } from "antd";
import { t } from "../../../../i18n";
import { useLocale } from "../../../../i18n/i18nContext";
import {
  setConversationThreshold,
  useConversationContextState,
} from "../../conversationContextState";
import { formatTokenCount } from "../../contextUsageFormat";
import type { ContextUsage } from "../../../../types";

export default function CompactionThresholdControl({
  usage,
  conversationId,
}: {
  usage: ContextUsage | null;
  conversationId: number | null;
}) {
  useLocale();
  const { thresholdTokens } = useConversationContextState(conversationId);
  const windowTokens = usage?.window ?? 128_000;
  const maximum = Math.floor(windowTokens * 0.9);
  const trigger = Math.min(
    thresholdTokens ??
      usage?.default_trigger_tokens ??
      usage?.trigger_tokens ??
      windowTokens * 0.75,
    maximum,
  );
  return (
    <div className="assistant-context-window">
      <label className="assistant-context-window-row">
        <span>{t("contextUsage.early.label")}</span>
        <InputNumber
          size="small"
          aria-label={t("contextUsage.early.label")}
          placeholder={t("contextUsage.early.placeholder")}
          min={1}
          max={maximum}
          value={thresholdTokens === null ? null : Math.min(thresholdTokens, maximum)}
          disabled={conversationId === null || undefined}
          onChange={(value) => {
            if (conversationId !== null)
              setConversationThreshold(
                conversationId,
                typeof value === "number" ? Math.min(maximum, value) : null,
              );
          }}
        />
      </label>
      <p className="assistant-context-window-hint">
        {t("contextUsage.early.trigger", {
          trigger: formatTokenCount(trigger),
          // 不再重复窗口绝对值：大数字行已经写过「已使用 x / 1000.0K」，
          // 同一屏出现两次同一个数是重复信息。这里只给占比。
          percent: `${Math.round((trigger / Math.max(1, windowTokens)) * 100)}%`,
        })}
      </p>
      <p className="assistant-context-window-hint">{t("contextUsage.early.hint")}</p>
    </div>
  );
}
