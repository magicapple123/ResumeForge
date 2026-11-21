// SPDX-License-Identifier: Apache-2.0
import { CloudDownloadOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Space, Typography } from "antd";
import { useState } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { APP_VERSION } from "../../config";
import { type InAppUpdateBridge, useDesktopUpdateState } from "./desktopUpdateBridge";

export default function DesktopUpdateCard({ bridge }: { bridge: InAppUpdateBridge }) {
  useLocale();
  const state = useDesktopUpdateState(bridge);
  const [error, setError] = useState(false);
  const active = state && ["downloading", "verifying", "installing"].includes(state.phase);
  const open = async () => {
    setError(false);
    try {
      if (!(await bridge.checkUpdate()).ok) setError(true);
    } catch {
      setError(true);
    }
  };
  return (
    <Card title={t("update.card.title")}>
      <Space orientation="vertical" size={12}>
        <Typography.Text>{t("update.inApp.restartHint")}</Typography.Text>
        <Button
          icon={<CloudDownloadOutlined />}
          aria-label={t(active ? "update.inApp.viewProgress" : "update.action.check")}
          onClick={() => void open()}
        >
          {t(active ? "update.inApp.viewProgress" : "update.action.check")}
        </Button>
        {error && <Alert type="error" showIcon title={t("update.error.check")} />}
      </Space>
      <div className="update-meta">
        <div className="update-meta-item">
          <span className="update-meta-label">{t("update.field.current")}</span>
          <strong>{state?.current || APP_VERSION}</strong>
        </div>
        <div className="update-meta-item">
          <span className="update-meta-label">{t("update.field.latest")}</span>
          <strong>{state?.latest || t("update.value.checkFirst")}</strong>
        </div>
        <div className="update-meta-item">
          <span className="update-meta-label">{t("update.field.published")}</span>
          <strong>{state?.published?.slice(0, 10) || t("update.value.noDate")}</strong>
        </div>
      </div>
    </Card>
  );
}
