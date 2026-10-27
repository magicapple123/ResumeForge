// SPDX-License-Identifier: Apache-2.0
/**
 * 求职助手「放宽模式」卡（设置页 · AI 模型）。
 *
 * 默认关。开启后助手可读取**完整资料**——姓名、电话、邮箱等身份字段，网申填表的
 * 真实填写值，以及历史对话。开启前把解锁范围与始终不解锁的边界说清楚（提前告知
 * 是这个功能成立的前提）：API 密钥等凭据任何模式都不发给模型，简历照片二进制不发送，
 * 也没有删除类工具。
 */
import { App, Card, Space, Switch, Typography } from "antd";
import LoadingBlock from "../common/LoadingBlock";
import { useEffect, useState } from "react";
import { getAssistantRelaxedMode, saveAssistantRelaxedMode } from "../../api/settings";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

export default function AssistantRelaxedModeCard() {
  useLocale();
  const { message } = App.useApp();
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Compiler 规范：挂载加载用内联 async IIFE（setState 在自身回调里应用）。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const saved = await getAssistantRelaxedMode();
        if (!cancelled) setEnabled(saved.enabled);
      } catch {
        // 读不到按默认关处理：这是扩权开关，保守显示比假装开着安全。
        if (!cancelled) setEnabled(false);
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
      const saved = await saveAssistantRelaxedMode({ enabled: checked });
      setEnabled(saved.enabled);
      message.success(
        checked
          ? t("settingsUi.assistantRelaxed.enableToast")
          : t("settingsUi.assistantRelaxed.disableToast"),
      );
    } catch (err) {
      setEnabled(!checked);
      message.error(
        err instanceof Error ? err.message : t("settingsUi.assistantRelaxed.saveFailed"),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title={t("settingsUi.assistantRelaxed.title")} className="settings-card">
      <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
        {t("settingsUi.assistantRelaxed.intro")}
      </Typography.Paragraph>
      <LoadingBlock spinning={loading}>
        <Space orientation="vertical" size={4}>
          <Switch
            checked={enabled}
            loading={saving}
            checkedChildren={t("settingsUi.switch.on")}
            unCheckedChildren={t("settingsUi.switch.off")}
            aria-label={t("settingsUi.assistantRelaxed.toggleAria")}
            onChange={(checked) => void onChange(checked)}
          />
          <Typography.Text type={enabled ? "warning" : "secondary"}>
            {enabled
              ? t("settingsUi.assistantRelaxed.stateOn")
              : t("settingsUi.assistantRelaxed.stateOff")}
          </Typography.Text>
          <Typography.Text type="secondary">
            {t("settingsUi.assistantRelaxed.neverSent")}
          </Typography.Text>
        </Space>
      </LoadingBlock>
    </Card>
  );
}
