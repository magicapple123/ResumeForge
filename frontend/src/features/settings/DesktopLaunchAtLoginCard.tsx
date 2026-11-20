// SPDX-License-Identifier: Apache-2.0
/**
 * 开机自启（WF-08 三处联动的第三处：安装器写 `HKCU\…\Run` / 卸载器删同一条 / 应用内能关）。
 *
 * 与「桌面托盘图标」卡的本质差别：**这张卡不存数据库**。值只有一份——Windows 注册表里
 * 安装器写的那条。应用内再存一个布尔，就会出现"装机时勾了自启、进应用看到的是关"的
 * 两个事实源（详见 desktop/lib/launch-at-login.js 顶部）。
 *
 * 三条约束：
 *  - 仅桌面版显示，且**桥里要有这两个入口**：旧壳没有，显示出来也切不动。
 *  - 读不到（旧壳 / 非 Windows / 注册表异常）时，开关渲染成 disabled + 一句"当前安装包
 *    不支持"，不假装能切。
 *  - 没有「恢复默认」：没有可恢复的库值，默认态就是 Windows 自己的状态。
 */

import { App, Card, Space, Switch, Typography } from "antd";
import { useCallback, useEffect, useState } from "react";

import LoadingBlock from "../../components/common/LoadingBlock";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { getDesktopShellBridge, isDesktopShell } from "../desktop/desktopShellBridge";

interface LaunchState {
  supported: boolean;
  enabled: boolean;
}

/** 能真正读写的桌面壳才算"支持"：桥在 + 两个方法都在（旧壳只有 setLocale 之类）。 */
function activeBridge() {
  if (!isDesktopShell()) return null;
  const bridge = getDesktopShellBridge();
  const ok =
    typeof bridge?.getLaunchAtLogin === "function" &&
    typeof bridge?.setLaunchAtLogin === "function";
  return ok ? bridge : null;
}

export default function DesktopLaunchAtLoginCard() {
  useLocale();
  const { message } = App.useApp();
  const [state, setState] = useState<LaunchState>({ supported: true, enabled: false });
  const [supported] = useState(() => activeBridge() !== null);
  const [loading, setLoading] = useState(supported);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const bridge = activeBridge();
    if (!bridge?.getLaunchAtLogin) return;
    try {
      const next = await bridge.getLaunchAtLogin();
      if (next) setState({ supported: Boolean(next.supported), enabled: Boolean(next.enabled) });
    } catch (err) {
      message.error(err instanceof Error ? err.message : t("settingsUi.launchAtLogin.loadFailed"));
      setState({ supported: false, enabled: false });
    }
  }, [message]);

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

  const toggle = async (checked: boolean) => {
    const bridge = activeBridge();
    if (saving || !bridge?.setLaunchAtLogin) return;
    setSaving(true);
    const previous = state;
    setState({ supported: previous.supported, enabled: checked });
    try {
      const next = await bridge.setLaunchAtLogin(checked);
      if (next) setState({ supported: Boolean(next.supported), enabled: Boolean(next.enabled) });
      message.success(
        checked
          ? t("settingsUi.launchAtLogin.enableToast")
          : t("settingsUi.launchAtLogin.disableToast"),
      );
    } catch (err) {
      setState(previous);
      message.error(err instanceof Error ? err.message : t("settingsUi.launchAtLogin.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  // 浏览器 / 旧壳：这张卡在这里没有意义，不渲染（不是渲染成禁用）。
  if (!supported) return null;

  return (
    <Card title={t("settingsUi.launchAtLogin.title")} className="settings-card">
      <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
        {t("settingsUi.launchAtLogin.intro")}
      </Typography.Paragraph>
      <LoadingBlock spinning={loading}>
        <Space orientation="vertical" size={4}>
          <Switch
            checked={state.enabled}
            disabled={!state.supported}
            loading={saving}
            checkedChildren={t("settingsUi.switch.on")}
            unCheckedChildren={t("settingsUi.switch.off")}
            aria-label={t("settingsUi.launchAtLogin.toggleAria")}
            onChange={(checked) => void toggle(checked)}
          />
          <Typography.Text type="secondary">
            {state.supported
              ? t("settingsUi.launchAtLogin.hint")
              : t("settingsUi.launchAtLogin.unsupported")}
          </Typography.Text>
        </Space>
      </LoadingBlock>
    </Card>
  );
}
