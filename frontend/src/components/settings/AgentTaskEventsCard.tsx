// SPDX-License-Identifier: Apache-2.0
/**
 * 「提醒到期 · 生成任务卡」卡（设置页 · 助手与 AI 行为）。
 *
 * 默认关：开启后后台扫描会为到期的提醒生成一张「准备：<提醒标题>」任务卡。
 * 这张卡把三条边界写在用户面前：只建卡、不自动执行任何写操作；不发消息、不弹窗；
 * 关闭后不再生成但已生成的卡保留（不追删）。
 */
import { App, Card, Space, Switch, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import ErrorState from "../common/ErrorState";
import LoadingBlock from "../common/LoadingBlock";
import { getAgentTaskEvents, setAgentTaskEvents } from "../../api/settings";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

export default function AgentTaskEventsCard() {
  useLocale();
  const { message } = App.useApp();
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const saved = await getAgentTaskEvents();
      setEnabled(saved.enabled);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // Compiler 规范：挂载加载用内联 async IIFE（setState 在自身回调里应用）。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const saved = await getAgentTaskEvents();
        if (!cancelled) setEnabled(saved.enabled);
      } catch {
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onChange = async (checked: boolean) => {
    if (saving) return;
    setSaving(true);
    setEnabled(checked);
    try {
      const saved = await setAgentTaskEvents({ enabled: checked });
      setEnabled(saved.enabled);
      message.success(
        checked
          ? t("settingsUi.agentTaskEvents.enableToast")
          : t("settingsUi.agentTaskEvents.disableToast"),
      );
    } catch (err) {
      setEnabled(!checked);
      message.error(
        err instanceof Error ? err.message : t("settingsUi.agentTaskEvents.saveFailed"),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title={t("settingsUi.agentTaskEvents.title")} className="settings-card">
      <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
        {t("settingsUi.agentTaskEvents.intro")}
      </Typography.Paragraph>
      <LoadingBlock spinning={loading}>
        {loadError ? (
          <ErrorState
            description={t("settingsUi.agentTaskEvents.loadFailed")}
            onRetry={() => void load()}
          />
        ) : (
          <Space orientation="vertical" size={4}>
            <Switch
              checked={enabled}
              loading={saving}
              checkedChildren={t("settingsUi.switch.on")}
              unCheckedChildren={t("settingsUi.switch.off")}
              aria-label={t("settingsUi.agentTaskEvents.toggleAria")}
              onChange={(checked) => void onChange(checked)}
            />
            <Typography.Text type={enabled ? "warning" : "secondary"}>
              {enabled
                ? t("settingsUi.agentTaskEvents.stateOn")
                : t("settingsUi.agentTaskEvents.stateOff")}
            </Typography.Text>
            <Typography.Text type="secondary">
              {t("settingsUi.agentTaskEvents.keepCards")}
            </Typography.Text>
          </Space>
        )}
      </LoadingBlock>
    </Card>
  );
}
