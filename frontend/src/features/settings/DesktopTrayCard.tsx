// SPDX-License-Identifier: Apache-2.0
/**
 * 桌面版托盘图标（WF-20 兜底开关）。
 *
 * 托盘默认跟随**应用内**主题；但「浅色任务栏 + 应用内暗色」时彩色图标会看不清，
 * 所以给一个「跟随系统主题」的兜底开关（默认关）。
 *
 * 三个约束：
 *  - **仅桌面版显示**：浏览器里没有托盘，旧壳（2.1 及更早）也没有这条通道——改了不会
 *    有任何效果，所以按能力探测隐藏，而不是显示一个假的开关。
 *  - 值存后端（`tray_icon_follow_system`，注册表出厂值 False），主进程不读数据库，
 *    所以每次挂载与切换都把结论推给壳（`desktopShell.setTrayIconFollowSystem`）。
 *  - 开关即改即存，没有保存按钮（与提醒弹窗卡同一范式）。
 */

import { App, Card, Flex, Space, Switch, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";

import { getTrayIconFollowSystem, saveTrayIconFollowSystem } from "../../api/settings";
import LoadingBlock from "../../components/common/LoadingBlock";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { getDesktopShellBridge, isDesktopShell } from "../desktop/desktopShellBridge";
import SettingsResetButton from "./SettingsResetButton";
import { useSettingsResetListener } from "./useSettingsResetListener";

/** I-10：这张卡能恢复默认的键（`ui` 作用域下本卡独占一个）。 */
const RESET_KEYS = ["tray_icon_follow_system"];

/**
 * 能真正生效的桌面壳才算"支持"：桥存在**且**有新通道。
 * 只判 `isDesktopShell()` 会让 2.1 旧壳显示一个改了没反应的开关。
 */
function activeBridge() {
  if (!isDesktopShell()) return null;
  const bridge = getDesktopShellBridge();
  return typeof bridge?.setTrayIconFollowSystem === "function" ? bridge : null;
}

export default function DesktopTrayCard() {
  useLocale();
  const { message } = App.useApp();
  const [enabled, setEnabled] = useState(false);
  const [supported] = useState(() => activeBridge() !== null);
  const [loading, setLoading] = useState(supported);
  const [saving, setSaving] = useState(false);

  const push = useCallback((value: boolean) => {
    try {
      activeBridge()?.setTrayIconFollowSystem?.(value);
    } catch {
      // 桥调用失败只是一次壳层同步没到：设置值已经落库，下次挂载会再推一次。
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const saved = await getTrayIconFollowSystem();
      setEnabled(saved.enabled);
      push(saved.enabled);
    } catch (err) {
      message.error(err instanceof Error ? err.message : t("settingsUi.desktopTray.loadFailed"));
    }
  }, [message, push]);

  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    void (async () => {
      await load();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [load, supported]);

  // 恢复默认后重取（默认关），并把新值推给壳。
  useSettingsResetListener(() => {
    if (supported) void load();
  });

  const toggle = async (checked: boolean) => {
    if (saving) return;
    setSaving(true);
    setEnabled(checked);
    try {
      const saved = await saveTrayIconFollowSystem(checked);
      setEnabled(saved.enabled);
      push(saved.enabled);
      message.success(
        saved.enabled
          ? t("settingsUi.desktopTray.enableToast")
          : t("settingsUi.desktopTray.disableToast"),
      );
    } catch (err) {
      setEnabled(!checked);
      message.error(err instanceof Error ? err.message : t("settingsUi.desktopTray.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  // 浏览器 / 旧壳：不渲染（不是禁用，而是这张卡在这里没有意义）。
  if (!supported) return null;

  return (
    <Card
      title={
        <Flex align="center" gap={8}>
          <span>{t("settingsUi.desktopTray.title")}</span>
          <SettingsResetButton keys={RESET_KEYS} />
        </Flex>
      }
      className="settings-card"
    >
      <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
        {t("settingsUi.desktopTray.intro")}
      </Typography.Paragraph>
      <LoadingBlock spinning={loading}>
        <Space orientation="vertical" size={4}>
          <Switch
            checked={enabled}
            loading={saving}
            checkedChildren={t("settingsUi.switch.on")}
            unCheckedChildren={t("settingsUi.switch.off")}
            aria-label={t("settingsUi.desktopTray.toggleAria")}
            onChange={(checked) => void toggle(checked)}
          />
          <Typography.Text type="secondary">
            {t("settingsUi.desktopTray.defaultHint")}
          </Typography.Text>
        </Space>
      </LoadingBlock>
    </Card>
  );
}
