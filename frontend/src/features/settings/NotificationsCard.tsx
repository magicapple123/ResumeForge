// SPDX-License-Identifier: Apache-2.0
/**
 * 「通知」分组（CR-29）：六个开关决定什么该打断用户。
 *
 * 默认口径写在注册表（`settings_registry_data.py`），这里只负责读写，不复制一份默认值——
 * 前端写死"默认关"而库里是"开"时，用户会看到开关与行为不一致。
 *
 * 两个细节：
 * 1. 每次保存成功都把返回的快照写进 `notificationPreferences`，通道判定立即生效，
 *    不必等下一次启动；
 * 2. 静默时段只给开关不给时间选择器（22:00–08:00 是绝对多数场景），文案里把窗口
 *    写清楚，避免"打开了但不知道什么时候生效"。
 */
import { App, Card, Space, Switch, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";
import {
  getNotificationSettings,
  saveNotificationSettings,
  type NotificationSettings,
} from "../../api/notificationSettings";
import { applyNotificationSettings } from "../../utils/notificationPreferences";
import { t } from "../../i18n";
import type { MessageKey } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

type SwitchKey =
  | "notify_reminder_due"
  | "notify_task_waiting"
  | "notify_task_done"
  | "notify_batch_done"
  | "notify_sound"
  | "notify_quiet_hours";

interface Row {
  key: SwitchKey;
  labelKey: MessageKey;
  hintKey: MessageKey;
}

const ROWS: readonly Row[] = [
  {
    key: "notify_reminder_due",
    labelKey: "notificationsSettings.reminderDue.label",
    hintKey: "notificationsSettings.reminderDue.hint",
  },
  {
    key: "notify_task_waiting",
    labelKey: "notificationsSettings.taskWaiting.label",
    hintKey: "notificationsSettings.taskWaiting.hint",
  },
  {
    key: "notify_task_done",
    labelKey: "notificationsSettings.taskDone.label",
    hintKey: "notificationsSettings.taskDone.hint",
  },
  {
    key: "notify_batch_done",
    labelKey: "notificationsSettings.batchDone.label",
    hintKey: "notificationsSettings.batchDone.hint",
  },
  {
    key: "notify_sound",
    labelKey: "notificationsSettings.sound.label",
    hintKey: "notificationsSettings.sound.hint",
  },
  {
    key: "notify_quiet_hours",
    labelKey: "notificationsSettings.quietHours.label",
    hintKey: "notificationsSettings.quietHours.hint",
  },
];

export default function NotificationsCard() {
  useLocale();
  const { message } = App.useApp();
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [saving, setSaving] = useState<SwitchKey | null>(null);

  const load = useCallback(async () => {
    try {
      const value = await getNotificationSettings();
      setSettings(value);
      applyNotificationSettings(value);
    } catch {
      message.error(t("notificationsSettings.loadFailed"));
    }
  }, [message]);

  useEffect(() => {
    // 同步 setState 放进 effect 会触发级联渲染（eslint 直接警告），改成微任务。
    void Promise.resolve().then(load);
  }, [load]);

  const toggle = async (key: SwitchKey, checked: boolean) => {
    if (saving !== null) return;
    setSaving(key);
    try {
      const value = await saveNotificationSettings({ [key]: checked });
      setSettings(value);
      applyNotificationSettings(value);
    } catch {
      message.error(t("notificationsSettings.saveFailed"));
    } finally {
      setSaving(null);
    }
  };

  const hint = (row: Row): string => {
    if (row.key !== "notify_quiet_hours") return t(row.hintKey);
    return t(row.hintKey, {
      start: settings?.quiet_start ?? "22:00",
      end: settings?.quiet_end ?? "08:00",
    });
  };

  return (
    <Card
      title={t("notificationsSettings.nav")}
      className="settings-card"
      data-testid="notifications-card"
    >
      <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
        {t("notificationsSettings.summary")}
      </Typography.Paragraph>
      <Space orientation="vertical" size={16} style={{ display: "flex" }}>
        {ROWS.map((row) => (
          <div
            key={row.key}
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 16,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
              <Typography.Text strong>{t(row.labelKey)}</Typography.Text>
              <Typography.Text type="secondary">{hint(row)}</Typography.Text>
            </div>
            <Switch
              checked={settings ? settings[row.key] : false}
              loading={saving === row.key}
              disabled={settings === null || saving !== null}
              aria-label={t(row.labelKey)}
              data-testid={`switch-${row.key}`}
              onChange={(checked) => void toggle(row.key, checked)}
            />
          </div>
        ))}
      </Space>
    </Card>
  );
}
