// SPDX-License-Identifier: Apache-2.0
/**
 * 浏览器控制卡：URL 栏 + 状态行 + 启停/配置/刷新/诊断/结束五个按钮组。
 * （自 WebFormPage 拆出：:717-808 整块逐字随迁；纯 props——handler 定义留在页面。）
 */
import {
  ChromeOutlined,
  DownloadOutlined,
  ReloadOutlined,
  SettingOutlined,
  StopOutlined,
} from "@ant-design/icons";
import { Button, Card, Spin, Tag, Tooltip, Typography } from "antd";
import { memo } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import WebFormBrowserUrlBar from "../../components/webform/WebFormBrowserUrlBar";
import { BROWSER_STATE_META } from "../../types";
import type { BrowserState, WebFormUrlHistory } from "../../types";
import type { WebFormBusyState } from "./constants";

/**
 * **memo**：所有 handler 由页面侧 useCallback 稳定（含浏览器 reload/setData 经稳定引用下发），
 * 打字时整块跳过重渲。
 */
export const BrowserControlCard = memo(function BrowserControlCard({
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
    <Card size="small" className="webform-browser-card">
      <WebFormBrowserUrlBar
        value={targetUrl}
        history={urlHistory}
        busy={busy === "start"}
        onChange={onChangeTargetUrl}
        onOpen={() => void onOpenUrl()}
        onSelectHistory={(item) => onChangeTargetUrl(item.url)}
        onDeleteHistory={(item) => void onDeleteHistory(item)}
      />
      {/* 轮询状态行：对读屏器 polite 播报状态变化（Tag 文字变化时才触发，不会逐秒骚扰）。 */}
      <div className="webform-browser-status-row">
        <div className="webform-browser-status" aria-live="polite">
          <Tag color={stateMeta.color}>{stateMeta.label}</Tag>
          {browserLoading && !browserHasData ? <Spin size="small" /> : null}
          <Typography.Text type="secondary">
            {t("webFormPage.browserCard.isolatedHint")}
          </Typography.Text>
        </div>
        <div className="webform-browser-actions">
          {/* 三个按钮的职责**互不重合**，各管一件事：
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
            <Tooltip title={t("webFormPage.browserCard.startTooltip")}>
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
            </Tooltip>
          )}
          <Tooltip title={t("webFormPage.browserCard.settingsTooltip")}>
            <Button icon={<SettingOutlined />} disabled={anyBusy} onClick={onOpenBrowserSettings}>
              {t("webFormPage.browserCard.settings")}
            </Button>
          </Tooltip>
          <Tooltip title={t("webFormPage.browserCard.refreshTooltip")}>
            <Button
              icon={<ReloadOutlined />}
              loading={busy === "refresh"}
              disabled={anyBusy}
              onClick={() => void onRefreshStatus()}
              aria-label={t("webFormPage.browserCard.refreshAria")}
            >
              {t("webFormPage.browserCard.refresh")}
            </Button>
          </Tooltip>
          <Tooltip title={t("webFormPage.browserCard.diagnosticsTooltip")}>
            <Button
              icon={<DownloadOutlined />}
              loading={busy === "diagnostics"}
              disabled={anyBusy}
              onClick={() => void onExportDiagnostics()}
            >
              {t("webFormPage.browserCard.diagnostics")}
            </Button>
          </Tooltip>
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
    </Card>
  );
});
