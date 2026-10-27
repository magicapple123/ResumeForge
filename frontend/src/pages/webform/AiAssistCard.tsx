// SPDX-License-Identifier: Apache-2.0
/**
 * AI 兜底卡：规则能确定就不调用模型，只有认不出的框才问一次。
 * （自 WebFormPage 拆出：:809-836 整块逐字随迁，纯 props。）
 */
import { Card, Space, Switch, Typography } from "antd";
import { memo } from "react";
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
  // 本组件用模块级 t()：订阅语言变化，否则切语言后这张卡的文案不重渲染。
  useLocale();
  return (
    <Card size="small" title={t("webFormPage.aiAssist.title")}>
      <Space size="middle" wrap>
        <Switch
          checked={aiOn}
          disabled={aiAvailable !== true}
          onChange={onAiEnabledChange}
          aria-label={t("webFormPage.aiAssist.toggleAria")}
        />
        {aiAvailable === true ? (
          <Typography.Text type="secondary">
            {t("webFormPage.aiAssist.body.lead")}
            <Typography.Text strong>{t("webFormPage.aiAssist.body.strong")}</Typography.Text>
            {t("webFormPage.aiAssist.body.tail")}
          </Typography.Text>
        ) : (
          <Typography.Text type="secondary">
            {t("webFormPage.aiAssist.unavailable")}
          </Typography.Text>
        )}
        {liveRunning ? (
          <Typography.Text type="warning">
            {t("webFormPage.aiAssist.pendingRestart")}
          </Typography.Text>
        ) : null}
      </Space>
    </Card>
  );
});
