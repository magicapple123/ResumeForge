// SPDX-License-Identifier: Apache-2.0
/**
 * 提醒弹窗开关：打开应用时若有未完成提醒，是否弹窗列出。
 *
 * 卡片自带取数与保存（与 SearchCard / UpdateCard 一致）：它是一套独立设置，不走「编辑设置」
 * 那个全局编辑态。开关即改即存，不设单独的保存按钮。
 */

import { App, Card, Space, Switch, Typography } from "antd";
import LoadingBlock from "../common/LoadingBlock";
import { useEffect, useState } from "react";
import { getReminderPopupSetting, saveReminderPopupSetting } from "../../api/settings";
import { isSoundEnabled, playDoneSound, setSoundEnabled } from "../../utils/notifySound";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

export default function ReminderPopupCard() {
  useLocale();
  const { message } = App.useApp();
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // 完成提示音：存在浏览器本地（它是一个"这台机器上要不要响"的偏好，不占用户的数据表）。
  // Compiler 规范：本地偏好的初始读取用 useState 惰性初始化，替代挂载 effect。
  const [sound, setSound] = useState(() => isSoundEnabled());

  // Compiler 规范：挂载加载用内联 async IIFE（setState 在自身回调里应用）。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const saved = await getReminderPopupSetting();
        if (!cancelled) setEnabled(saved.enabled);
      } catch (err) {
        if (!cancelled) {
          message.error(
            err instanceof Error ? err.message : t("settingsUi.reminderPopup.loadFailed"),
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [message]);

  const toggle = async (checked: boolean) => {
    if (saving) return;
    setSaving(true);
    setEnabled(checked);
    try {
      const saved = await saveReminderPopupSetting(checked);
      setEnabled(saved.enabled);
      message.success(
        saved.enabled
          ? t("settingsUi.reminderPopup.enableToast")
          : t("settingsUi.reminderPopup.disableToast"),
      );
    } catch (err) {
      // 保存失败回滚到切换前的状态。
      setEnabled(!checked);
      message.error(err instanceof Error ? err.message : t("settingsUi.reminderPopup.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const toggleSound = (checked: boolean) => {
    setSound(checked);
    setSoundEnabled(checked);
    // 打开时立刻响一声，用户能当场确认声音是什么样（也顺便解锁浏览器的音频权限）。
    if (checked) playDoneSound();
  };

  return (
    <Card title={t("settingsUi.reminderPopup.title")} className="settings-card">
      <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
        {t("settingsUi.reminderPopup.intro")}
      </Typography.Paragraph>
      <LoadingBlock spinning={loading}>
        <Space orientation="vertical" size={4}>
          <Switch
            checked={enabled}
            loading={saving}
            checkedChildren={t("settingsUi.switch.on")}
            unCheckedChildren={t("settingsUi.switch.off")}
            aria-label={t("settingsUi.reminderPopup.toggleAria")}
            onChange={(checked) => void toggle(checked)}
          />
          <Typography.Text type="secondary">{t("settingsUi.switch.defaultOnHint")}</Typography.Text>
        </Space>
      </LoadingBlock>

      <Typography.Paragraph type="secondary" style={{ margin: "20px 0 12px" }}>
        {t("settingsUi.reminderPopup.soundIntro")}
      </Typography.Paragraph>
      <Space orientation="vertical" size={4}>
        <Switch
          checked={sound}
          checkedChildren={t("settingsUi.switch.on")}
          unCheckedChildren={t("settingsUi.switch.off")}
          aria-label={t("settingsUi.reminderPopup.soundAria")}
          onChange={toggleSound}
        />
        <Typography.Text type="secondary">
          {t("settingsUi.reminderPopup.soundHint")}
        </Typography.Text>
      </Space>
    </Card>
  );
}
