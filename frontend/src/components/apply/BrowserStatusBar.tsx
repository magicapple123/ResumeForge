// SPDX-License-Identifier: Apache-2.0
/**
 * 投递专用浏览器：启动 / 停止 / 状态检查。
 *
 * 这是本应用**唯一**会访问招聘网站的窗口，因此界面上必须把两件事说清楚：
 * 1. 它是**投递专用的独立窗口**（独立 user-data-dir），不是你日常那个浏览器；
 * 2. 首次使用要在弹出的窗口里**自己扫码登录一次**——应用不存密码、不读 Cookie，
 *    登录态由 Chromium 自己持久化。
 */
import {
  ChromeOutlined,
  LinkOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  StopOutlined,
} from "@ant-design/icons";
import { Alert, App, Button, Space, Tag, Tooltip, Typography } from "antd";
import { useState } from "react";
import { getBrowserStatus, openBrowserSite, startBrowser, stopBrowser } from "../../api/apply";
import { BROWSER_STATUS_POLL_INTERVAL_MS, useBrowserStatus } from "../../hooks/useBrowserStatus";
import { BROWSER_STATE_META } from "../../types";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

export default function BrowserStatusBar() {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后这一块不重渲染。
  useLocale();
  const { message } = App.useApp();
  const { data, loading, error, reload, setData } = useBrowserStatus(getBrowserStatus);
  const [busy, setBusy] = useState(false);

  const handleStart = async () => {
    setBusy(true);
    try {
      const status = await startBrowser();
      setData(status);
      message.success(t("browserStatus.toast.started"));
    } catch (err) {
      message.error(err instanceof Error ? err.message : t("browserStatus.error.startFailed"));
    } finally {
      setBusy(false);
    }
  };

  const handleOpenSite = async () => {
    setBusy(true);
    try {
      const status = await openBrowserSite();
      setData(status);
      message.success(t("browserStatus.toast.siteOpened"));
    } catch (err) {
      message.error(err instanceof Error ? err.message : t("browserStatus.error.openSiteFailed"));
    } finally {
      setBusy(false);
    }
  };

  const handleStop = async () => {
    setBusy(true);
    try {
      await stopBrowser();
      message.success(t("browserStatus.toast.stopped"));
      await reload();
    } catch (err) {
      message.error(err instanceof Error ? err.message : t("browserStatus.error.stopFailed"));
    } finally {
      setBusy(false);
    }
  };

  const state = data?.state ?? "unknown";
  const meta = BROWSER_STATE_META[state];
  const running = state === "running";
  // 标签页被用户关掉或跳走时用它把招聘网站找回来，不必重启浏览器。
  const canOpenSite = running && Boolean(data?.entry_url);
  // 只有**本次运行**拉起的窗口才关得掉：后端重启会丢掉进程句柄，而应用只关自己拉起的
  // 进程，绝不按 PID 去猜（见 browser_manager.stop）。这种窗口照样能用，只是要用户自己关。
  const canStop = Boolean(data?.owned) && (running || state === "starting");
  // 关不掉时得把原因**写在页面上**，不能只挂在悬停提示里：antd 的 Tooltip 不会特殊处理
  // 禁用子元素，而浏览器不给 disabled 按钮派发鼠标事件——悬停上去什么都不会弹。
  const adopted = Boolean(data) && !data?.owned && (running || state === "starting");

  return (
    <div className="apply-browser-bar">
      <Space wrap align="center" size={12}>
        <Space size={8} align="center">
          <ChromeOutlined />
          <Typography.Text strong>{t("browserStatus.title")}</Typography.Text>
          <Tag color={meta.color}>{meta.label}</Tag>
          {data && (
            <Typography.Text type="secondary">
              {t("browserStatus.port", { port: data.port })}
            </Typography.Text>
          )}
        </Space>
        <Space wrap>
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            loading={busy}
            disabled={running || busy}
            onClick={() => void handleStart()}
          >
            {t("browserStatus.action.start")}
          </Button>
          <Tooltip
            title={
              canOpenSite
                ? t("browserStatus.tooltip.openSite")
                : t("browserStatus.tooltip.openSiteDisabled")
            }
          >
            <Button
              icon={<LinkOutlined />}
              loading={busy}
              disabled={!canOpenSite || busy}
              onClick={() => void handleOpenSite()}
            >
              {t("browserStatus.action.openSite")}
            </Button>
          </Tooltip>
          <Button
            icon={<StopOutlined />}
            loading={busy}
            disabled={!canStop || busy}
            onClick={() => void handleStop()}
          >
            {t("browserStatus.action.stop")}
          </Button>
          <Tooltip
            title={t(
              loading ? "browserStatus.tooltip.reload" : "browserStatus.tooltip.reloadIdle",
              { seconds: (BROWSER_STATUS_POLL_INTERVAL_MS / 1000).toFixed(1) },
            )}
          >
            <Button
              icon={<ReloadOutlined />}
              disabled={busy}
              onClick={() => void reload()}
              aria-label={t("browserStatus.aria.reload")}
            >
              {t("browserStatus.action.reload")}
            </Button>
          </Tooltip>
        </Space>
      </Space>

      <Typography.Paragraph type="secondary" className="apply-browser-hint">
        {t("browserStatus.intro")}
      </Typography.Paragraph>

      {adopted && (
        <Typography.Paragraph type="secondary" className="apply-browser-hint">
          {t("browserStatus.adopted")}
        </Typography.Paragraph>
      )}

      {data?.logged_in_hint && (
        // 首次使用的扫码提示用琥珀色：它是"需要你做一个动作"的提醒，和旁边
        // 纯说明性的蓝色提示区分开（整页提示框全是蓝的会没有视觉层次）。
        <Alert type="warning" showIcon title={data.logged_in_hint} style={{ marginTop: 8 }} />
      )}
      {data?.entry_url && (
        <Typography.Paragraph type="secondary" className="apply-browser-path">
          {t("browserStatus.entry", { url: data.entry_url })}
        </Typography.Paragraph>
      )}
      {data?.browser_path && (
        <Typography.Paragraph type="secondary" className="apply-browser-path">
          {t("browserStatus.browser")}
          {data.browser_name
            ? t("browserStatus.browserWithName", {
                name: data.browser_name,
                path: data.browser_path,
              })
            : data.browser_path}
        </Typography.Paragraph>
      )}
      {error && <Alert type="error" showIcon title={error} style={{ marginTop: 8 }} />}
    </div>
  );
}
