// SPDX-License-Identifier: Apache-2.0
/**
 * AI 兜底行：规则能确定就不调用模型，只有认不出的框才问一次。
 *
 * 在 `FillModePanel` 里是**常驻的一行**（I-11）：没配模型时开关禁用，但这一行仍然在，
 * 并写明「尚未配置大模型」以及去哪儿配——开关能用却毫无效果是最糟的形态，隐藏它只是
 * 把"为什么没生效"变成用户永远查不到的问题。
 *
 * I-27：70 字的说明从常驻段落收进 `ⓘ`（`HintDetail`），这一行回到 40px 高。禁用原因
 * 例外——它必须留在行内，否则用户只看到一个灰开关。
 */
import { Switch, Typography } from "antd";
import { memo } from "react";
import HintDetail from "../../components/common/HintDetail";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

/** **memo**：props 在击键路径上稳定，打字时整块跳过重渲。 */
export const AiAssistCard = memo(function AiAssistCard({
  aiOn,
  aiAvailable,
  liveRunning,
  onAiEnabledChange,
}: {
  aiOn: boolean;
  aiAvailable: boolean | null;
  liveRunning: boolean | undefined;
  onAiEnabledChange: (enabled: boolean) => void;
}) {
  // 本组件用模块级 t()：订阅语言变化，否则切语言后这一行的文案不重渲染。
  useLocale();
  /** 三段拼成一整句：`ⓘ` 里不需要保留原来的加粗，`pre-line` 也照常换行。 */
  const detail =
    t("webFormPage.aiAssist.body.lead") +
    t("webFormPage.aiAssist.body.strong") +
    t("webFormPage.aiAssist.body.tail");
  return (
    <div className="webform-mode-row">
      <span className="webform-mode-label">{t("webFormPage.aiAssist.title")}</span>
      <div className="webform-mode-control">
        <Switch
          checked={aiOn}
          disabled={aiAvailable !== true}
          onChange={onAiEnabledChange}
          aria-label={t("webFormPage.aiAssist.toggleAria")}
        />
        {aiAvailable === true ? (
          <HintDetail
            className="webform-mode-info"
            detail={detail}
            label={t("webFormPage.aiAssist.hintAria")}
          />
        ) : null}
      </div>
      {aiAvailable === true ? (
        liveRunning ? (
          <div className="webform-mode-hint">
            <Typography.Text type="warning" style={{ fontSize: 12 }}>
              {t("webFormPage.aiAssist.pendingRestart")}
            </Typography.Text>
          </div>
        ) : null
      ) : (
        <div className="webform-mode-hint">
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t("webFormPage.aiAssist.unavailable")}
          </Typography.Text>
        </div>
      )}
    </div>
  );
});
