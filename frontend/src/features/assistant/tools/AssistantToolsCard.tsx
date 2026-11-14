// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import { Button, Card, Typography } from "antd";
import { formatErrorGuidance } from "../../../api/errorGuidance";
import ErrorState from "../../../components/common/ErrorState";
import LoadingBlock from "../../../components/common/LoadingBlock";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import AssistantToolsDrawer from "./AssistantToolsDrawer";
import { useAssistantTools } from "./useAssistantTools";

export default function AssistantToolsCard() {
  useLocale();
  const [open, setOpen] = useState(false);
  const inventory = useAssistantTools();
  return (
    <>
      <Card
        className="settings-card assistant-tools-card"
        title={t("assistantTools.title")}
        size="small"
        extra={<Button onClick={() => setOpen(true)}>{t("assistantTools.viewAll")}</Button>}
      >
        {inventory.status === "ready" ? (
          <Typography.Text data-testid="assistant-tools-summary">
            {t("assistantTools.summary", { count: inventory.data.count })}
          </Typography.Text>
        ) : null}
        {inventory.status === "loading" || inventory.status === "idle" ? (
          <LoadingBlock minHeight={48} />
        ) : null}
        {inventory.status === "error" ? (
          <ErrorState
            description={formatErrorGuidance(inventory.error, t("assistantTools.retry"))}
            onRetry={inventory.reload}
          />
        ) : null}
      </Card>
      <AssistantToolsDrawer open={open} onClose={() => setOpen(false)} />
    </>
  );
}
