// SPDX-License-Identifier: Apache-2.0
/** 设置页里的「投投」悬浮球卡片：入口开关与提示标语开关，即改即存。 */

import { App, Card, Divider, Space, Switch, Typography } from "antd";
import LoadingBlock from "../common/LoadingBlock";
import { useCallback, useEffect, useState } from "react";
import { getAssistantOrbSetting, saveAssistantOrbSetting } from "../../api/settings";
import type { AssistantOrbSetting } from "../../types/settings";
import { TOU_TOU_SETTING_EVENT } from "../../features/tou-tou/touTouTypes";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

export default function AssistantOrbCard() {
  useLocale();
  const { message } = App.useApp();
  const [setting, setSetting] = useState<AssistantOrbSetting>({
    enabled: true,
    tips_enabled: true,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // 纯取数（不含 setState）：effect 内联调用时 Compiler 才能验证非同步更新。
  const fetchSetting = useCallback(async (): Promise<AssistantOrbSetting | null> => {
    try {
      return await getAssistantOrbSetting();
    } catch (err) {
      message.error(err instanceof Error ? err.message : t("settingsUi.orb.loadFailed"));
      return null;
    }
  }, [message]);

  // Compiler 规范：挂载加载用内联 async IIFE（setState 在自身回调里应用）。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const setting = await fetchSetting();
      if (!cancelled) {
        if (setting !== null) setSetting(setting);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchSetting]);

  /**
   * 保存**全量**设置：两个开关共用一份后端对象，只带被改的那个会把另一个打回默认。
   * 乐观更新 + 失败回滚，与页面上其它即改即存的开关保持同一手感。
   */
  const save = async (next: AssistantOrbSetting, successText: string) => {
    if (saving) return;
    setSaving(true);
    const previous = setting;
    setSetting(next);
    try {
      const saved = await saveAssistantOrbSetting(next);
      setSetting(saved);
      window.dispatchEvent(
        new CustomEvent(TOU_TOU_SETTING_EVENT, {
          detail: { enabled: saved.enabled, tips_enabled: saved.tips_enabled },
        }),
      );
      message.success(successText);
    } catch (err) {
      setSetting(previous);
      message.error(err instanceof Error ? err.message : t("settingsUi.orb.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title={t("settingsUi.orb.title")} className="settings-card">
      <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
        {t("settingsUi.orb.intro")}
      </Typography.Paragraph>
      <LoadingBlock spinning={loading}>
        <Space orientation="vertical" size={4}>
          <Switch
            checked={setting.enabled}
            loading={saving}
            checkedChildren={t("settingsUi.switch.on")}
            unCheckedChildren={t("settingsUi.switch.off")}
            aria-label={t("settingsUi.orb.enableAria")}
            onChange={(checked) =>
              void save(
                { ...setting, enabled: checked },
                checked ? t("settingsUi.orb.enableToast") : t("settingsUi.orb.disableToast"),
              )
            }
          />
          <Typography.Text type="secondary">{t("settingsUi.switch.defaultOnHint")}</Typography.Text>
          <Divider style={{ margin: "12px 0 8px" }} />
          <Switch
            checked={setting.tips_enabled}
            loading={saving}
            checkedChildren={t("settingsUi.switch.on")}
            unCheckedChildren={t("settingsUi.switch.off")}
            aria-label={t("settingsUi.orb.tipsAria")}
            onChange={(checked) =>
              void save(
                { ...setting, tips_enabled: checked },
                checked ? t("settingsUi.orb.tipsOnToast") : t("settingsUi.orb.tipsOffToast"),
              )
            }
          />
          <Typography.Text type="secondary">{t("settingsUi.orb.tipsHint")}</Typography.Text>
        </Space>
      </LoadingBlock>
    </Card>
  );
}
