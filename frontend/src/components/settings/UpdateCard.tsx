/** 软件更新：检查、下载并安排安全覆盖安装。 */

import {
  CloudDownloadOutlined,
  DownloadOutlined,
  ReloadOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Progress,
  Space,
  Spin,
  Switch,
  Typography,
} from "antd";
import { useEffect, useState } from "react";
import {
  acknowledgeUpdateInstallResult,
  checkForUpdate,
  getUpdateDownloadStatus,
  getUpdateInstallResult,
  installDownloadedUpdate,
  startUpdateDownload,
} from "../../api/settings";
import type { UpdateCheckResult, UpdateStatus } from "../../types";

const UPDATE_COMPLETED_KEY = "resumeforge.update.completed";

function formatBytes(value: number | null): string {
  if (value === null || value < 0) return "未知大小";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export default function UpdateCard() {
  const { modal } = App.useApp();
  const [result, setResult] = useState<UpdateCheckResult | null>(null);
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [background, setBackground] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void getUpdateDownloadStatus()
      .then((current) => {
        if (!cancelled) setStatus(current);
      })
      .catch(() => {
        // 状态接口失败不应让整个设置页报错；用户仍可手动检查更新。
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const statusState = status?.state;

  useEffect(() => {
    if (!statusState || !["downloading", "installing"].includes(statusState)) return;
    const timer = window.setInterval(() => {
      void getUpdateDownloadStatus()
        .then((current) => setStatus(current))
        .catch(() => undefined);
    }, 800);
    return () => window.clearInterval(timer);
  }, [statusState]);

  useEffect(() => {
    // 旧版本会在**点击安装时**先写一个"已完成"的标记，于是安装崩了下次打开照样显示
    // "已更新"。这里只把它清掉，改成向后端要真实结果。
    window.localStorage.removeItem(UPDATE_COMPLETED_KEY);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getUpdateInstallResult()
      .then(async (outcome) => {
        if (cancelled || !outcome) return;
        // 看过了就销掉，别每次打开设置都弹一遍。
        await acknowledgeUpdateInstallResult().catch(() => undefined);
        if (cancelled) return;

        if (outcome.state === "success") {
          modal.success({
            title: "ResumeForge 已更新",
            content: `已更新到 ${outcome.target_version}。你的岗位、简历和设置仍保留在原数据目录中。`,
          });
          return;
        }
        if (outcome.state === "installing") return; // 更新器还在跑，等它写完再说
        modal.error({
          title: outcome.state === "interrupted" ? "上次更新没有完成" : "上次更新失败",
          content: (
            <div>
              <p>{outcome.message || "更新器没有给出原因。"}</p>
              <p style={{ marginBottom: 0 }}>
                应用本身还能正常使用，数据没有被改动。日志在 <code>{outcome.log}</code>，
                也可以双击 <code>update.cmd</code> 重新更新一次。
              </p>
            </div>
          ),
        });
      })
      .catch(() => {
        // 结果接口失败不该让设置页报错：用户仍可以手动检查更新。
      });
    return () => {
      cancelled = true;
    };
  }, [modal]);

  const check = async (refresh: boolean) => {
    if (checking) return;
    setChecking(true);
    setError("");
    try {
      setResult(await checkForUpdate(refresh));
    } catch (err) {
      setError(err instanceof Error ? err.message : "检查更新失败");
    } finally {
      setChecking(false);
    }
  };

  const download = async () => {
    if (downloading || installing) return;
    setDownloading(true);
    setError("");
    try {
      const next = await startUpdateDownload(background);
      setStatus(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "下载更新失败");
    } finally {
      setDownloading(false);
    }
  };

  const install = () => {
    if (!status || status.state !== "ready" || installing) return;
    modal.confirm({
      title: "重启并安装更新？",
      content:
        "应用会先退出，覆盖程序文件后自动重启。岗位、简历、对话和设置保存在 data/ 中，不会被更新包覆盖。",
      okText: "重启并安装",
      cancelText: "稍后安装",
      onOk: async () => {
        setInstalling(true);
        setError("");
        try {
          // 这里**不写任何"已完成"的标记**：装没装成由更新器写状态、后端读出来告诉界面，
          // 前端自己记一笔就等于在替结果打包票（旧版本正是这么做的，安装失败也会显示"已更新"）。
          const next = await installDownloadedUpdate(true);
          setStatus(next);
        } catch (err) {
          setInstalling(false);
          setError(err instanceof Error ? err.message : "启动安装失败");
        }
      },
    });
  };

  const activeStatus = status?.state === "downloading" || status?.state === "installing";
  const canDownload = Boolean(result?.update_available && result.installable);

  return (
    <Card title="软件更新" className="settings-card">
      <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
        更新只替换程序文件，不会覆盖 <code>data/</code> 里的岗位、简历、助手对话和设置。
        更新前仍建议先在「数据集与备份」里导出一份备份。
      </Typography.Paragraph>
      <Descriptions size="small" column={1} style={{ marginBottom: 12 }}>
        <Descriptions.Item label="更新方式">
          应用内下载，确认后自动覆盖并重启（Windows）。
        </Descriptions.Item>
        <Descriptions.Item label="当前版本">
          {result?.current_version || status?.current_version || "点击下方按钮获取"}
        </Descriptions.Item>
        {status?.target_version && (
          <Descriptions.Item label="目标版本">{status.target_version}</Descriptions.Item>
        )}
      </Descriptions>

      <Space wrap>
        <Button
          type="primary"
          icon={<CloudDownloadOutlined />}
          aria-label="检查更新"
          loading={checking}
          onClick={() => void check(true)}
        >
          检查更新
        </Button>
        {canDownload && (
          <Button
            type="primary"
            icon={<DownloadOutlined />}
            aria-label="下载更新"
            loading={downloading}
            disabled={activeStatus || installing}
            onClick={() => void download()}
          >
            下载更新
          </Button>
        )}
        {result && (
          <Button
            icon={<ReloadOutlined />}
            aria-label="重新检查"
            disabled={checking || activeStatus}
            onClick={() => void check(true)}
          >
            重新检查
          </Button>
        )}
        {status?.state === "ready" && (
          <Button
            type="primary"
            danger
            icon={<SyncOutlined />}
            aria-label="重启并安装"
            onClick={install}
            loading={installing}
          >
            重启并安装
          </Button>
        )}
      </Space>

      {canDownload && status?.state !== "ready" && (
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16 }}>
          <Switch
            size="small"
            checked={background}
            disabled={activeStatus || installing}
            onChange={setBackground}
          />
          <span>后台下载（下载完成后提醒我安装）</span>
        </label>
      )}

      {checking && !result && <Spin style={{ marginTop: 16 }} />}
      {error && <Alert style={{ marginTop: 16 }} type="error" showIcon message={error} />}
      {status?.state === "downloading" && (
        <div style={{ marginTop: 16 }}>
          <Typography.Text>
            正在下载更新包：{formatBytes(status.downloaded_bytes)} /{" "}
            {formatBytes(status.total_bytes)}
          </Typography.Text>
          <Progress percent={Math.round(status.progress)} status="active" />
        </div>
      )}
      {status?.state === "installing" && (
        <Alert
          style={{ marginTop: 16 }}
          type="info"
          showIcon
          message="更新器已启动，应用即将退出并自动重启。"
        />
      )}
      {status?.state === "failed" && status.message && (
        <Alert style={{ marginTop: 16 }} type="error" showIcon message={status.message} />
      )}
      {status?.state === "ready" && (
        <Alert
          style={{ marginTop: 16 }}
          type="success"
          showIcon
          message="更新包已下载完成"
          description="点击「重启并安装」后，应用会在原路径覆盖旧版本并自动重启。"
        />
      )}
      {result && (
        <Alert
          style={{ marginTop: 16 }}
          type={result.update_available ? "success" : "info"}
          showIcon
          message={result.message || "检查完成"}
          description={
            <Space direction="vertical" size={4} style={{ width: "100%" }}>
              {result.latest_version && <span>最新版本：{result.latest_version}</span>}
              {result.published_at && <span>发布时间：{result.published_at.slice(0, 10)}</span>}
              {result.notes && (
                <Typography.Paragraph
                  style={{
                    margin: 0,
                    whiteSpace: "pre-wrap",
                    maxHeight: 200,
                    overflowY: "auto",
                    overflowX: "hidden",
                  }}
                >
                  {result.notes}
                </Typography.Paragraph>
              )}
              {result.release_url && (
                <Typography.Link
                  href={result.release_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  打开发布页面
                </Typography.Link>
              )}
            </Space>
          }
        />
      )}
    </Card>
  );
}
