// SPDX-License-Identifier: Apache-2.0
/**
 * 网申工具条（吸顶）：目标网址 + 浏览器状态点 + 启停/配置/刷新/诊断/结束。
 *
 * 取代原先包在 `Card` 里的浏览器控制块：那版与页面其它八张卡平级，用户得先数一遍卡片
 * 才知道"现在能不能开始填"。这里只留一条工具条并**吸顶**（只用 `position: sticky`；
 * 用 `fixed` 会脱离文档流盖住结果区，在本页容器查询的包含块语义下还会相对内容区定位），
 * 于是往下翻预览表时启停入口仍然够得着。
 *
 * 纯 props 组件：所有 handler 由页面侧 useCallback 稳定，`memo` 才能在打字时真正生效。
 */
import {
  ChromeOutlined,
  DownloadOutlined,
  MoreOutlined,
  ReloadOutlined,
  SettingOutlined,
  StopOutlined,
} from "@ant-design/icons";
import { Button, Dropdown, Spin, Tag, Tooltip, Typography } from "antd";
import { memo } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { BROWSER_STATE_LABEL_KEYS } from "../../i18n/enum/apply";
import WebFormBrowserUrlBar from "../../features/webform/WebFormBrowserUrlBar";
import { BROWSER_STATE_META } from "../../types";
import type { BrowserState, WebFormUrlHistory } from "../../types";
import type { WebFormBusyState } from "./constants";

/**
 * **memo**：所有 handler 由页面侧 useCallback 稳定（含浏览器 reload/setData 经稳定引用下发），
 * 打字时整块跳过重渲。
 */
export const Workbar = memo(function Workbar({
  targetUrl,
  onChangeTargetUrl,
  urlHistory,
  onDeleteHistory,
  busy,
  running,
  sessionActive,
  liveRunning,
  browserLoading,
  browserHasData,
  browserState,
  onStart,
  onStop,
  onOpenUrl,
  onOpenBrowserSettings,
  onRefreshStatus,
  onExportDiagnostics,
  onEndSession,
}: {
  targetUrl: string;
  onChangeTargetUrl: (url: string) => void;
  urlHistory: WebFormUrlHistory[];
  onDeleteHistory: (item: WebFormUrlHistory) => void;
  busy: WebFormBusyState;
  running: boolean;
  sessionActive: boolean;
  liveRunning: boolean | undefined;
  browserLoading: boolean;
  browserHasData: boolean;
  browserState: BrowserState | undefined;
  onStart: () => void;
  onStop: () => void;
  onOpenUrl: () => void;
  onOpenBrowserSettings: () => void;
  onRefreshStatus: () => void;
  onExportDiagnostics: () => void;
  onEndSession: () => void;
}) {
  // 本组件用模块级 t()：订阅语言变化，否则切语言后这些按钮与提示不重渲染。
  useLocale();
  // 浏览器那几个按钮共用这一个 busy：**任何一个在跑，其余的都禁用**。
  // 它们职责分得开（起停 / 配置 / 重查），但都围绕同一个浏览器进程——并行点开只会让
  // "关闭还没回来就点了启动"这类交错更难对上账。
  const anyBusy = busy !== null;
  const stateMeta = BROWSER_STATE_META[browserState ?? "stopped"];
  return (
    <div className="webform-workbar">
      <WebFormBrowserUrlBar
        value={targetUrl}
        history={urlHistory}
        busy={busy === "start"}
        primary={running}
        onChange={onChangeTargetUrl}
        onOpen={() => void onOpenUrl()}
        onSelectHistory={(item) => onChangeTargetUrl(item.url)}
        onDeleteHistory={(item) => void onDeleteHistory(item)}
      />
      {/* 状态行：对读屏器 polite 播报状态变化（Tag 文字变化时才触发，不会逐秒骚扰）。 */}
      <div className="webform-workbar-row">
        <div className="webform-workbar-status" aria-live="polite">
          {/* 状态点只是视觉冗余：颜色来自 `BROWSER_STATE_META`（唯一来源），文字才是语义。 */}
          <span
            className={`webform-workbar-dot${running ? " is-running" : ""}`}
            aria-hidden="true"
          />
          {/* 状态名走语言包，颜色仍来自 `BROWSER_STATE_META`。 */}
          <Tag color={stateMeta.color}>
            {t(BROWSER_STATE_LABEL_KEYS[browserState ?? "stopped"])}
          </Tag>
          {browserLoading && !browserHasData ? <Spin size="small" /> : null}
          <Typography.Text type="secondary" className="webform-workbar-hint">
            {t("webFormPage.browserCard.isolatedHint")}
          </Typography.Text>
        </div>
        <div className="webform-workbar-actions">
          {/* 按钮职责**互不重合**，各管一件事：
                起停（启动/关闭浏览器）· 配置（浏览器设置）· 重查（刷新状态）。
              设置不回显状态、刷新不改配置、起停只碰进程——所以这里也不该让它们并行。 */}
          {running ? (
            <Tooltip title={t("webFormPage.browserCard.stopTooltip")}>
              <Button
                icon={<StopOutlined />}
                loading={busy === "stop"}
                disabled={anyBusy}
                onClick={onStop}
              >
                {t("webFormPage.browserCard.stop")}
              </Button>
            </Tooltip>
          ) : (
            <Button
              type="primary"
              icon={<ChromeOutlined />}
              aria-label={t("webFormPage.browserCard.startAria")}
              loading={busy === "start"}
              disabled={anyBusy}
              onClick={onStart}
            >
              {t("webFormPage.browserCard.start")}
            </Button>
          )}
          <Tooltip title={t("webFormPage.browserCard.refreshTooltip")}>
            <Button
              icon={<ReloadOutlined />}
              loading={busy === "refresh"}
              disabled={anyBusy}
              onClick={() => void onRefreshStatus()}
              aria-label={t("webFormPage.browserCard.refreshAria")}
            />
          </Tooltip>
          {/* 配置与诊断是"配一次就忘"的动作，常驻两颗按钮会把状态行挤到换行。
              收进「更多」以后这一行只剩：状态 / 刷新 / 更多 / 一个主按钮。 */}
          <Dropdown
            trigger={["click"]}
            menu={{
              items: [
                {
                  key: "settings",
                  icon: <SettingOutlined />,
                  label: t("webFormPage.browserCard.settings"),
                  disabled: anyBusy,
                  onClick: onOpenBrowserSettings,
                },
                {
                  key: "diagnostics",
                  icon: <DownloadOutlined />,
                  label: t("webFormPage.browserCard.diagnostics"),
                  disabled: anyBusy,
                  onClick: () => void onExportDiagnostics(),
                },
              ],
            }}
          >
            <Button
              icon={<MoreOutlined />}
              disabled={anyBusy}
              aria-label={t("webFormPage.browserCard.moreAria")}
            />
          </Dropdown>
          {running && (sessionActive || liveRunning) ? (
            <Tooltip title={t("webFormPage.browserCard.endTooltip")}>
              <Button
                danger
                loading={busy === "end"}
                disabled={anyBusy}
                onClick={() => void onEndSession()}
              >
                {t("webFormPage.browserCard.end")}
              </Button>
            </Tooltip>
          ) : null}
        </div>
      </div>
    </div>
  );
});
