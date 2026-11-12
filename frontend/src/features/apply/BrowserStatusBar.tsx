// SPDX-License-Identifier: Apache-2.0
/**
 * 投递专用浏览器：启动 / 停止 / 状态检查。
 *
 * 这是本应用**唯一**会访问招聘网站的窗口，因此界面上必须把两件事说清楚：
 * 1. 它是**投递专用的独立窗口**（独立 user-data-dir），不是你日常那个浏览器；
 * 2. 首次使用要在弹出的窗口里**自己扫码登录一次**——应用不存密码、不读 Cookie，
 *    登录态由 Chromium 自己持久化。
 *
 * #14G 第一版把三段说明收进 Popover，**实测仍不够**（1366×768 首屏只剩 2 行表格）：
 * 状态行 + 四个按钮 + 一行扫码提示仍占 114px。第二版按实测压成**一行**：
 * 状态 / 端口 / 一个主按钮（未启动=启动浏览器，运行中=打开招聘网站）/
 * 「⋯」（关闭浏览器、刷新状态、使用说明，说明开弹窗而不是 Popover——弹层不进流，
 * 不会把首屏顶下去）。扫码提示（`logged_in_hint`）保留但压成一行：
 * 它只在未登录时出现，是"需要你做一个动作"的提醒，藏起来等于让首次使用的人迷路。
 * 「关不掉这个窗口」的原因同理留在页面上——禁用按钮不派发鼠标事件，Tooltip 弹不出来。
 */
import {
  ChromeOutlined,
  LinkOutlined,
  MoreOutlined,
  PlayCircleOutlined,
  QuestionCircleOutlined,
  ReloadOutlined,
  StopOutlined,
  WarningFilled,
} from "@ant-design/icons";
import { App, Button, Dropdown, Modal, Space, Tag, Tooltip, Typography } from "antd";
import { useState } from "react";
import { getBrowserStatus, openBrowserSite, startBrowser, stopBrowser } from "../../api/apply";
import { BROWSER_STATUS_POLL_INTERVAL_MS, useBrowserStatus } from "../../hooks/useBrowserStatus";
import { BROWSER_STATE_META } from "../../types";
import { t } from "../../i18n";
import { BROWSER_STATE_LABEL_KEYS } from "../../i18n/enum/apply";
import { useLocale } from "../../i18n/i18nContext";

export default function BrowserStatusBar() {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后这一块不重渲染。
  useLocale();
  const { message } = App.useApp();
  const { data, loading, error, reload, setData } = useBrowserStatus(getBrowserStatus);
  const [busy, setBusy] = useState(false);
  /** 「使用说明」弹窗：说明不进流，首屏高度与它无关。 */
  const [helpOpen, setHelpOpen] = useState(false);

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

  /** 「使用说明」的内容：三段说明整段搬进来（弹窗里可以放开写，不再抢首屏高度）。 */
  const helpContent = (
    <div className="apply-browser-help">
      <Typography.Text strong>{t("browserStatus.help.sectionIntro")}</Typography.Text>
      <Typography.Paragraph type="secondary" className="apply-browser-hint">
        {t("browserStatus.intro")}
      </Typography.Paragraph>
      {data?.entry_url && (
        <>
          <Typography.Text strong>{t("browserStatus.help.sectionEntry")}</Typography.Text>
          <Typography.Paragraph type="secondary" className="apply-browser-path">
            {t("browserStatus.entry", { url: data.entry_url })}
          </Typography.Paragraph>
        </>
      )}
      {data?.browser_path && (
        <>
          <Typography.Text strong>{t("browserStatus.help.sectionBrowser")}</Typography.Text>
          <Typography.Paragraph type="secondary" className="apply-browser-path">
            {t("browserStatus.browser")}
            {data.browser_name
              ? t("browserStatus.browserWithName", {
                  name: data.browser_name,
                  path: data.browser_path,
                })
              : data.browser_path}
          </Typography.Paragraph>
        </>
      )}
    </div>
  );

  /**
   * 「⋯」里的三件事：关窗口 / 刷新状态 / 使用说明。
   *
   * 为什么把「关闭」也收进来：它是低频且有破坏性的动作，常驻会和主按钮抢注意力；
   * 但**不能藏进悬停**——禁用原因（上一次运行留下的窗口关不掉）写在页面上，不靠提示。
   */
  const moreItems = [
    {
      key: "stop",
      label: t("browserStatus.action.stop"),
      icon: <StopOutlined />,
      disabled: !canStop || busy,
      onClick: () => void handleStop(),
    },
    {
      key: "reload",
      // 轮询间隔与"是否正在刷新"这类条件信息仍挂在悬停里：菜单项本身只写动作名。
      label: (
        <Tooltip
          placement="left"
          title={t(loading ? "browserStatus.tooltip.reload" : "browserStatus.tooltip.reloadIdle", {
            seconds: (BROWSER_STATUS_POLL_INTERVAL_MS / 1000).toFixed(1),
          })}
        >
          {t("browserStatus.aria.reload")}
        </Tooltip>
      ),
      icon: <ReloadOutlined />,
      disabled: busy,
      onClick: () => void reload(),
    },
    { type: "divider" as const },
    {
      key: "help",
      label: t("browserStatus.help.trigger"),
      icon: <QuestionCircleOutlined />,
      onClick: () => setHelpOpen(true),
    },
  ];

  return (
    <div className="apply-browser-bar">
      <div className="apply-browser-row">
        <Space size={8} align="center" wrap={false}>
          <ChromeOutlined />
          <Typography.Text strong>{t("browserStatus.title")}</Typography.Text>
          <Tag color={meta.color} style={{ marginInlineEnd: 0 }}>
            {t(BROWSER_STATE_LABEL_KEYS[state])}
          </Tag>
          {data && (
            <Typography.Text type="secondary" className="apply-browser-port">
              {t("browserStatus.port", { port: data.port })}
            </Typography.Text>
          )}
          {data?.logged_in_hint && (
            // 首次使用的扫码提示：琥珀色 + 图标，和旁边纯说明性的灰字区分开。
            // 与状态同一行、超出省略（全文在悬停里）——它常驻但绝不换行，
            // 因为"多一行"就等于首屏少一行表格。
            <Tooltip title={data.logged_in_hint}>
              <span className="apply-browser-login-hint">
                <WarningFilled />
                <Typography.Text type="warning" ellipsis>
                  {data.logged_in_hint}
                </Typography.Text>
              </span>
            </Tooltip>
          )}
        </Space>
        <Space size={8} align="center" wrap={false}>
          {/* 主按钮只留一个，且随状态换语义：没启动时唯一该点的是「启动浏览器」，
              运行中唯一该点的是「打开招聘网站」——两个同时常驻等于让用户自己判断。 */}
          {running ? (
            <Tooltip
              title={
                canOpenSite
                  ? t("browserStatus.tooltip.openSite")
                  : t("browserStatus.tooltip.openSiteDisabled")
              }
            >
              <Button
                type="primary"
                icon={<LinkOutlined />}
                loading={busy}
                disabled={!canOpenSite || busy}
                onClick={() => void handleOpenSite()}
              >
                {t("browserStatus.action.openSite")}
              </Button>
            </Tooltip>
          ) : (
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              loading={busy}
              disabled={running || busy}
              onClick={() => void handleStart()}
            >
              {t("browserStatus.action.start")}
            </Button>
          )}
          <Dropdown menu={{ items: moreItems }} trigger={["click"]} placement="bottomRight">
            <Button icon={<MoreOutlined />} aria-label={t("browserStatus.more.aria")} />
          </Dropdown>
        </Space>
      </div>

      {adopted && (
        <Typography.Text type="secondary" className="apply-browser-adopted">
          {t("browserStatus.adopted")}
        </Typography.Text>
      )}

      {error && (
        <Typography.Text type="danger" className="apply-browser-hint-line">
          {error}
        </Typography.Text>
      )}

      <Modal
        open={helpOpen}
        title={t("browserStatus.help.trigger")}
        onCancel={() => setHelpOpen(false)}
        footer={null}
        width={620}
      >
        {helpContent}
      </Modal>
    </div>
  );
}
