// SPDX-License-Identifier: Apache-2.0
import { Alert, Button, Spin } from "antd";
import { useEffect, useState, type ReactNode } from "react";
import { initializeDatasetScope } from "../api/datasetScope";
import { t } from "../i18n";
import { useLocale } from "../i18n/i18nContext";

/** Mount editable pages only after their initial dataset identity has been frozen. */
export default function DatasetScopeBoundary({ children }: { children: ReactNode }) {
  useLocale();
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    const controller = new AbortController();
    void initializeDatasetScope(controller.signal)
      .then(() => {
        if (!controller.signal.aborted) setState("ready");
      })
      .catch(() => {
        if (!controller.signal.aborted) setState("error");
      });
    return () => controller.abort();
  }, []);
  if (state === "loading")
    return <Spin fullscreen description={t("componentsMisc.datasetScope.loading")} />;
  if (state === "error")
    return (
      <Alert
        type="error"
        showIcon
        title={t("componentsMisc.datasetScope.errorTitle")}
        description={t("componentsMisc.datasetScope.errorBody")}
        action={
          <Button onClick={() => window.location.reload()}>
            {t("componentsMisc.datasetScope.refresh")}
          </Button>
        }
      />
    );
  return children;
}
