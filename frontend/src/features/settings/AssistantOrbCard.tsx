// SPDX-License-Identifier: Apache-2.0
/** 设置页里的「投投」悬浮球卡片：入口、提示标语与划词浮条三个开关，即改即存。 */

import { App, Card, Divider, Flex, Space, Switch, Typography } from "antd";
import LoadingBlock from "../../components/common/LoadingBlock";
import { useCallback, useEffect, useState } from "react";
import { getAssistantOrbSetting, saveAssistantOrbSetting } from "../../api/settings";
import type { AssistantOrbSetting } from "../../types/settings";
import { TOU_TOU_SETTING_EVENT } from "../tou-tou/touTouTypes";
import SettingsResetButton from "./SettingsResetButton";
import { useSettingsResetListener } from "./useSettingsResetListener";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

/**
 * I-10：这张卡能恢复默认的键。
 *
 * `ui` 作用域还包含导航可见性与提醒弹窗（各自在别的卡上），按 keys 精确复位本卡这一个
 * 键（三个开关是同一份后端对象，`kind=value` 整体回默认）。
 */
const ORB_RESET_KEYS = ["assistant_orb_enabled"];

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

  /** 把后端值同步给悬浮球本体（它订阅这个事件，不跟着设置页重渲染）。 */
  const publishOrbSetting = useCallback((saved: AssistantOrbSetting) => {
    window.dispatchEvent(
      new CustomEvent(TOU_TOU_SETTING_EVENT, {
        detail: {
          enabled: saved.enabled,
          tips_enabled: saved.tips_enabled,
          selection_enabled: saved.selection_enabled,
        },
      }),
    );
  }, []);

  /**
   * 保存**全量**设置：三个开关共用一份后端对象，只带被改的那个会把其它两个打回默认。
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
      publishOrbSetting(saved);
      message.success(successText);
    } catch (err) {
      setSetting(previous);
      message.error(err instanceof Error ? err.message : t("settingsUi.orb.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  // I-10：恢复默认后重取三个开关；悬浮球本体也要跟着变（否则它要等下一次路由才更新）。
  useSettingsResetListener(() => {
    void (async () => {
      const saved = await fetchSetting();
      if (saved === null) return;
      setSetting(saved);
      publishOrbSetting(saved);
    })();
  });

  return (
    <Card
      title={
        <Flex align="center" gap={8}>
          <span>{t("settingsUi.orb.title")}</span>
          {/* I-10：卡片级恢复默认（三个开关回到「开」）。 */}
          <SettingsResetButton keys={ORB_RESET_KEYS} />
        </Flex>
      }
      className="settings-card"
    >
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
          <Divider style={{ margin: "12px 0 8px" }} />
          {/* Q9：划词浮条独立开关。checked 用 `!== false`：更早的后端响应没有这个字段时按开处理。 */}
          <Switch
            checked={setting.selection_enabled !== false}
            loading={saving}
            checkedChildren={t("settingsUi.switch.on")}
            unCheckedChildren={t("settingsUi.switch.off")}
            aria-label={t("settingsUi.orb.selectionAria")}
            onChange={(checked) =>
              void save(
                { ...setting, selection_enabled: checked },
                checked
                  ? t("settingsUi.orb.selectionOnToast")
                  : t("settingsUi.orb.selectionOffToast"),
              )
            }
          />
          <Typography.Text type="secondary">{t("settingsUi.orb.selectionHint")}</Typography.Text>
        </Space>
      </LoadingBlock>
    </Card>
  );
}
