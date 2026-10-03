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
import WebFormBrowserUrlBar from "../../components/webform/WebFormBrowserUrlBar";
import { BROWSER_STATE_META } from "../../types";
import type { BrowserState, WebFormUrlHistory } from "../../types";
import type { WebFormBusyState } from "./constants";

export function BrowserControlCard({
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
      <div className="webform-browser-status-row">
        <div className="webform-browser-status">
          <Tag color={stateMeta.color}>{stateMeta.label}</Tag>
          {browserLoading && !browserHasData ? <Spin size="small" /> : null}
          <Typography.Text type="secondary">
            使用独立的网申专用浏览器（不会覆盖投递台或已有网申页面）
          </Typography.Text>
        </div>
        <div className="webform-browser-actions">
          {/* 三个按钮的职责**互不重合**，各管一件事：
                起停（启动/关闭浏览器）· 配置（浏览器设置）· 重查（刷新状态）。
              设置不回显状态、刷新不改配置、起停只碰进程——所以这里也不该让它们并行。 */}
          {running ? (
            <Tooltip title="停掉这个受控浏览器窗口。里面的登录态会保留，下次启动不用重新登录">
              <Button
                icon={<StopOutlined />}
                loading={busy === "stop"}
                disabled={anyBusy}
                onClick={onStop}
              >
                关闭浏览器
              </Button>
            </Tooltip>
          ) : (
            <Tooltip title="拉起这个受控浏览器窗口（独立于你日常用的浏览器）">
              <Button
                type="primary"
                icon={<ChromeOutlined />}
                aria-label="开启专用浏览器"
                loading={busy === "start"}
                disabled={anyBusy}
                onClick={onStart}
              >
                开启专用浏览器
              </Button>
            </Tooltip>
          )}
          <Tooltip title="只改「用哪个浏览器」这类配置，不会启动或关闭它——改完要关掉再启动一次才生效">
            <Button icon={<SettingOutlined />} disabled={anyBusy} onClick={onOpenBrowserSettings}>
              浏览器设置
            </Button>
          </Tooltip>
          <Tooltip title="重新读一次运行状态。平时它每 0.6 秒自己会刷；你刚关掉窗口或刚启动时可以用它立刻确认">
            <Button
              icon={<ReloadOutlined />}
              loading={busy === "refresh"}
              disabled={anyBusy}
              onClick={() => void onRefreshStatus()}
              aria-label="刷新浏览器状态"
            >
              刷新状态
            </Button>
          </Tooltip>
          <Tooltip title="导出不含简历内容、表单值和密钥的诊断信息，适合连同截图提交排查">
            <Button
              icon={<DownloadOutlined />}
              loading={busy === "diagnostics"}
              disabled={anyBusy}
              onClick={() => void onExportDiagnostics()}
            >
              导出诊断
            </Button>
          </Tooltip>
          {running && (sessionActive || liveRunning) ? (
            <Tooltip title="结束这一次网申填写：收起面板、不清理资料，下次点「读取当前表单」重来">
              <Button
                danger
                loading={busy === "end"}
                disabled={anyBusy}
                onClick={() => void onEndSession()}
              >
                结束本次填写
              </Button>
            </Tooltip>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
