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
  DownOutlined,
  LinkOutlined,
  MoreOutlined,
  PlayCircleOutlined,
  QuestionCircleOutlined,
  ReloadOutlined,
  StopOutlined,
  UpOutlined,
  WarningFilled,
} from "@ant-design/icons";
import { App, Badge, Button, Dropdown, Modal, Skeleton, Space, Tooltip, Typography } from "antd";
import { useState } from "react";
import { getBrowserStatus, openBrowserSite, startBrowser, stopBrowser } from "../../api/apply";
import { BROWSER_STATUS_POLL_INTERVAL_MS, useBrowserStatus } from "../../hooks/useBrowserStatus";
import { BROWSER_STATE_META } from "../../types";
import { t } from "../../i18n";
import { BROWSER_STATE_LABEL_KEYS } from "../../i18n/enum/apply";
import { useLocale } from "../../i18n/i18nContext";
import "../../styles/apply-browser-status.css";

export const BROWSER_HINT_SEEN_KEY = "resumeforge.apply.browser_hint_seen";
function hasSeenHint() {
  try {
    return localStorage.getItem(BROWSER_HINT_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

export default function BrowserStatusBar() {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后这一块不重渲染。
  useLocale();
  const { message } = App.useApp();
  const { data, loading, error, reload, setData } = useBrowserStatus(getBrowserStatus);
  const [busy, setBusy] = useState(false);
  /** 「使用说明」弹窗：说明不进流，首屏高度与它无关。 */
  const [helpOpen, setHelpOpen] = useState(false);
  const [hintSeen, setHintSeen] = useState(hasSeenHint);
  const [detailsOpen, setDetailsOpen] = useState(false);

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
  /**
   * 首屏「还没拿到状态」（I-16）。
   *
   * 此前这一帧被当成「状态未知」渲染：第二行整块不存在（卡片只有一行高），
   * 数据回来后再长出来，高度从 44 跳到 70（CLS），而且「启动浏览器」在没有
   * 任何状态数据时就是可点的——点下去等于在猜。
   *
   * 判据是 `loading && !data` 而不只是 `loading`：轮询期间 `loading` 会一直翻，
   * 那时已经有数据，不该闪骨架（`useBrowserStatus` 的 loading 语义即为此设计）。
   */
  const pending = loading && !data;
  const badgeStatus = pending ? "processing" : (meta.color as "default" | "success" | "warning");
  /** 没有数据就不要猜「浏览器没启动」：动作一律不可点，等读回来再说。 */
  const actionsLocked = !data;
  const running = state === "running";
  // 标签页被用户关掉或跳走时用它把招聘网站找回来，不必重启浏览器。
  const canOpenSite = running && Boolean(data?.entry_url);
  // 只有**本次运行**拉起的窗口才关得掉：后端重启会丢掉进程句柄，而应用只关自己拉起的
  // 进程，绝不按 PID 去猜（见 browser_manager.stop）。这种窗口照样能用，只是要用户自己关。
  const canStop = Boolean(data?.owned) && (running || state === "starting");
  // 关不掉时得把原因**写在页面上**，不能只挂在悬停提示里：antd 的 Tooltip 不会特殊处理
  // 禁用子元素，而浏览器不给 disabled 按钮派发鼠标事件——悬停上去什么都不会弹。
  const adopted = Boolean(data) && !data?.owned && (running || state === "starting");
  const compact = running && !error && hintSeen && !detailsOpen;
  const toggleDetails = () => {
    setDetailsOpen(compact);
    if (!hintSeen) {
      setHintSeen(true);
      try {
        localStorage.setItem(BROWSER_HINT_SEEN_KEY, "1");
      } catch {
        /* Optional preference. */
      }
    }
  };

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
    ...(compact
      ? [
          {
            key: "open-site",
            label: t("browserStatus.action.openSite"),
            icon: <LinkOutlined />,
            disabled: !canOpenSite || busy,
            onClick: () => void handleOpenSite(),
          },
        ]
      : []),
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
    <div
      className={`apply-browser-bar ${compact ? "apply-browser-compact" : "apply-browser-expanded"}`}
      // 首屏读取期间整条卡片是「忙碌」的：读屏会等它安静下来再播报，
      // 视觉上是骨架 + 转圈圆点，动作全部禁用（见下方的 actionsLocked）。
      aria-busy={pending || undefined}
    >
      {/* 两行结构（2026-11-13 用户反馈「单独一张窄卡片不好看」）：
          第一行是身份（图标 + 标题 + 状态），第二行是细节（端口 / 扫码提示 / 沿用说明），
          右侧按钮固定在右上角。此前所有东西平铺在一行里，琥珀色整句和主按钮抢视线，
          而且这一条被拉满页宽后没有任何边界感。 */}
      <div className="apply-browser-row">
        <span className="apply-browser-tile" aria-hidden>
          <ChromeOutlined />
        </span>
        <div className="apply-browser-main">
          <div className="apply-browser-title">
            <Typography.Text strong>{t("browserStatus.title")}</Typography.Text>
            {/* 状态用「圆点 + 文字」：色块标签在这一行里比主按钮还抢眼，
                而它只是"能不能点"的前提信息。 */}
            <Badge
              status={badgeStatus}
              text={
                <Typography.Text className="apply-browser-state">
                  {/* 「正在读取…」与「状态未知」是两件事：前者是等待，后者是读不到。
                      混成一句会让首屏看起来像出错了。 */}
                  {pending ? t("browserStatus.state.loading") : t(BROWSER_STATE_LABEL_KEYS[state])}
                </Typography.Text>
              }
            />
          </div>
          {/* 第二行两条互斥分支：还没读到状态时给**等高的骨架**，读到之后才换成真实内容。
              此前这一行只在 data 到位时渲染，于是首屏卡片只有一行高、数据回来时整条长高，
              正是那次布局跳动（CLS）的来源。骨架宽度按容器百分比走（见 apply.css 的
              `.apply-browser-skeleton`），不写死像素，窄屏不会撑出横向滚动。 */}
          {pending ? (
            <div className="apply-browser-meta" data-testid="browser-status-skeleton">
              <span className="apply-browser-skeleton">
                <Skeleton.Input active size="small" block />
              </span>
            </div>
          ) : data ? (
            <div className="apply-browser-meta">
              <Typography.Text type="secondary" className="apply-browser-port">
                {t("browserStatus.port", { port: data.port })}
              </Typography.Text>
              {!compact && data.logged_in_hint && (
                <Tooltip title={data.logged_in_hint}>
                  <span className="apply-browser-login-hint">
                    <WarningFilled />
                    <Typography.Text className="apply-browser-login-text" ellipsis>
                      {data.logged_in_hint}
                    </Typography.Text>
                  </span>
                </Tooltip>
              )}
            </div>
          ) : null}
        </div>
        <Space size={8} align="center" wrap={false} className="apply-browser-actions">
          {/* 主按钮只留一个，且随状态换语义：没启动时唯一该点的是「启动浏览器」，
              运行中唯一该点的是「打开招聘网站」——两个同时常驻等于让用户自己判断。 */}
          {!compact &&
            (running ? (
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
                  disabled={!canOpenSite || busy || undefined}
                  onClick={() => void handleOpenSite()}
                >
                  {/* 标签槽用「较长的那个标签」定宽（见 apply-browser-status.css 的
                      `.apply-browser-cta`）：两态文案差一个字（6 vs 5 个汉字 = 14px），
                      不这样两态动作簇就永远差 14px。占位标签 `visibility:hidden`，
                      不进无障碍树、也不写死像素——换语言自动跟着变。 */}
                  <span className="apply-browser-cta">
                    <span>{t("browserStatus.action.openSite")}</span>
                    <span className="apply-browser-cta-sizer" aria-hidden>
                      {t("browserStatus.action.start")}
                    </span>
                  </span>
                </Button>
              </Tooltip>
            ) : (
              <Button
                type="primary"
                icon={<PlayCircleOutlined />}
                loading={busy}
                disabled={actionsLocked || running || busy || undefined}
                onClick={() => void handleStart()}
              >
                <span className="apply-browser-cta">
                  <span>{t("browserStatus.action.start")}</span>
                  <span className="apply-browser-cta-sizer" aria-hidden>
                    {t("browserStatus.action.openSite")}
                  </span>
                </span>
              </Button>
            ))}
          {running && !error ? (
            <Tooltip
              title={t(compact ? "browserStatus.hint.expand" : "browserStatus.hint.collapse")}
            >
              <Button
                size="small"
                type="text"
                icon={compact ? <DownOutlined /> : <UpOutlined />}
                aria-label={t(
                  compact ? "browserStatus.hint.expand" : "browserStatus.hint.collapse",
                )}
                onClick={toggleDetails}
              />
            </Tooltip>
          ) : (
            /* 静止态用**同一个** antd 小按钮占住这个槽位（不是写死的 px，换主题/尺寸自动跟随），
               只是不可见、不可聚焦、不进无障碍树：两种形态的动作簇因此严格等宽，而「⋯」
               在启停前后也钉在原地。没有把它挪到左侧状态文案行，是因为实测那样会让
               `.apply-browser-main` 多出一行（标题 22.4 + 按钮 30），整条卡片在运行态
               长高 8px——那等于用横向跳动换成纵向跳动。 */
            <span className="apply-browser-toggle-slot" aria-hidden>
              <Button size="small" type="text" icon={<DownOutlined />} tabIndex={-1} />
            </span>
          )}
          {/* 「⋯」里的动作同样依赖状态：没读到状态时连菜单都不开，
              免得用户在「未知」上做选择（轮询会自动重试，恢复是自动的）。 */}
          <Dropdown
            menu={{ items: moreItems }}
            trigger={["click"]}
            placement="bottomRight"
            disabled={actionsLocked}
          >
            <Button
              icon={<MoreOutlined />}
              aria-label={t("browserStatus.more.aria")}
              disabled={actionsLocked || undefined}
            />
          </Dropdown>
        </Space>
      </div>

      {!compact && adopted && (
        <Typography.Text type="secondary" className="apply-browser-adopted">
          {t("browserStatus.adopted")}
        </Typography.Text>
      )}

      {/* 错误与加载互斥：还在读的时候不该同时喊"读失败"（首批响应还没回来）。 */}
      {error && !pending && (
        <Typography.Text type="danger" className="apply-browser-hint-line">
          {error}
        </Typography.Text>
      )}

      <Modal
        open={helpOpen}
        title={t("browserStatus.help.trigger")}
        onCancel={() => setHelpOpen(false)}
        footer={null}
        width={520}
      >
        {helpContent}
      </Modal>
    </div>
  );
}
