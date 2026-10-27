// SPDX-License-Identifier: Apache-2.0
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
  getAppForm,
  getUpdateInstallResult,
  installDownloadedUpdate,
  startUpdateDownload,
} from "../../api/settings";
import type { UpdateCheckResult } from "../../types";
import { useUpdateDownloadStatus } from "../../hooks/useUpdateDownloadStatus";
import { t, type MessageKey } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { renderReleaseNotes } from "./updateNotesRenderer";

const UPDATE_COMPLETED_KEY = "resumeforge.update.completed";

/**
 * 卡片内的错误提示：后端原文原样透传，没有原文时回退到语言包 key。
 * key 在渲染期才 `t()`——事件期求值会把当时的语言冻进 state，切语言后不会重译。
 */
type CardError = { backendMessage: string } | { fallbackKey: MessageKey };

function formatBytes(value: number | null): string {
  if (value === null || value < 0) return t("update.size.unknown");
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export default function UpdateCard() {
  useLocale();
  const { modal, message } = App.useApp();
  const [result, setResult] = useState<UpdateCheckResult | null>(null);
  const { status, statusError, setStatus, refreshStatus } = useUpdateDownloadStatus();
  const [checking, setChecking] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [background, setBackground] = useState(false);
  const [error, setError] = useState<CardError | null>(null);
  // 桌面安装壳：页面内的"下载 zip 并覆盖"对它无效（桌面 payload 是源码形态整包，
  // 更新包里没有 python-runtime.zip / desktop/，装上去只会半新半旧），所以要先问形态。
  const [desktop, setDesktop] = useState(false);

  useEffect(() => {
    // 旧版本会在**点击安装时**先写一个"已完成"的标记，于是安装崩了下次打开照样显示
    // "已更新"。这里只把它清掉，改成向后端要真实结果。
    window.localStorage.removeItem(UPDATE_COMPLETED_KEY);
  }, []);

  useEffect(() => {
    let cancelled = false;
    // 形态探测失败**静默按非桌面处理**：老后端没有这个接口，浏览器/控制台形态才是
    // 默认路径。绝不能因为多问一句就让设置页报错——检查更新本身仍要能用。
    void getAppForm()
      .then((form) => {
        if (!cancelled) setDesktop(form.desktop);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
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
            title: t("update.toast.doneTitle"),
            content: t("update.toast.doneBody", { version: outcome.target_version }),
          });
          return;
        }
        if (outcome.state === "installing") return; // 更新器还在跑，等它写完再说
        modal.error({
          title:
            outcome.state === "interrupted"
              ? t("update.toast.interruptedTitle")
              : t("update.toast.failedTitle"),
          content: (
            <div>
              <p>{outcome.message || t("update.installResult.noReason")}</p>
              <p style={{ marginBottom: 0 }}>
                {t("update.installResult.lead")} <code>{outcome.log}</code>
                {t("update.installResult.middle")} <code>update.cmd</code>{" "}
                {t("update.installResult.tail")}
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
    setError(null);
    try {
      const next = await checkForUpdate(refresh);
      setResult(next);
      // 结果 Alert 在卡片底部，用户点完按钮时看不到（QA ST.04：8 秒内"无任何反馈"）。
      // 检查完成必须**立刻**给出结论：有新版 / 已是最新；失败沿用上面的 error Alert。
      const version = next.latest_version || next.current_version;
      if (next.update_available) {
        message.success(t("update.check.available", { version }));
      } else {
        message.info(t("update.check.latest", { version }));
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? { backendMessage: err.message }
          : { fallbackKey: "update.error.check" },
      );
    } finally {
      setChecking(false);
    }
  };

  const download = async () => {
    if (downloading || installing) return;
    setDownloading(true);
    setError(null);
    try {
      const next = await startUpdateDownload(background);
      setStatus(next);
    } catch (err) {
      setError(
        err instanceof Error
          ? { backendMessage: err.message }
          : { fallbackKey: "update.error.download" },
      );
      // 失败后状态多半已经变了（例如包其实已在磁盘上、后端恢复成了 ready）。
      await refreshStatus();
    } finally {
      setDownloading(false);
    }
  };

  const install = () => {
    if (!status || status.state !== "ready" || installing) return;
    modal.confirm({
      title: t("update.confirm.title"),
      content: t("update.confirm.body"),
      okText: t("update.confirm.ok"),
      cancelText: t("update.confirm.cancel"),
      onOk: async () => {
        setInstalling(true);
        setError(null);
        try {
          // 这里**不写任何"已完成"的标记**：装没装成由更新器写状态、后端读出来告诉界面，
          // 前端自己记一笔就等于在替结果打包票（旧版本正是这么做的，安装失败也会显示"已更新"）。
          const next = await installDownloadedUpdate(true);
          setStatus(next);
        } catch (err) {
          setInstalling(false);
          setError(
            err instanceof Error
              ? { backendMessage: err.message }
              : { fallbackKey: "update.error.install" },
          );
          // 安装被拒多半是后端状态已经变了（例如后端刚重启、内存里的"已下载"丢了）。
          // 重新拉一次真实状态：陈旧的绿色成功框会随之消失，不再与错误同屏。
          await refreshStatus();
        }
      },
    });
  };

  // 错误文案按当前语言在这里取（state 里只有后端原文或 key）。
  const errorText = !error
    ? ""
    : "backendMessage" in error
      ? error.backendMessage
      : t(error.fallbackKey);

  const activeStatus = status?.state === "downloading" || status?.state === "installing";
  // 桌面形态一律不给页面内下载：那条路装不上依赖（见 getAppForm 的说明）。
  const canDownload = Boolean(result?.update_available && result.installable) && !desktop;

  return (
    <Card title={t("update.card.title")} className="settings-card">
      <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
        {t("update.intro.filesOnly")} <code>data/</code> {t("update.intro.dataSuffix")}{" "}
        {t("update.intro.backupHint")}
      </Typography.Paragraph>
      <Descriptions size="small" column={1} style={{ marginBottom: 12 }}>
        <Descriptions.Item label={t("update.field.channel")}>
          {desktop ? t("update.method.desktop") : t("update.method.in-app")}
        </Descriptions.Item>
        <Descriptions.Item label={t("update.field.current")}>
          {result?.current_version || status?.current_version || t("update.value.checkFirst")}
        </Descriptions.Item>
        {status?.target_version && (
          <Descriptions.Item label={t("update.field.target")}>
            {status.target_version}
          </Descriptions.Item>
        )}
      </Descriptions>

      <Space wrap>
        <Button
          type="primary"
          icon={<CloudDownloadOutlined />}
          aria-label={t("update.action.check")}
          loading={checking}
          onClick={() => void check(true)}
        >
          {t("update.action.check")}
        </Button>
        {canDownload && (
          <Button
            type="primary"
            icon={<DownloadOutlined />}
            aria-label={t("update.action.download")}
            loading={downloading}
            disabled={activeStatus || installing || Boolean(statusError)}
            onClick={() => void download()}
          >
            {t("update.action.download")}
          </Button>
        )}
        {result && (
          <Button
            icon={<ReloadOutlined />}
            aria-label={t("update.action.recheck")}
            disabled={checking || activeStatus}
            onClick={() => void check(true)}
          >
            {t("update.action.recheck")}
          </Button>
        )}
        {status?.state === "ready" && !statusError && !desktop && (
          <Button
            type="primary"
            danger
            icon={<SyncOutlined />}
            aria-label={t("update.action.install")}
            onClick={install}
            loading={installing}
          >
            {t("update.action.install")}
          </Button>
        )}
      </Space>

      {canDownload && status?.state !== "ready" && (
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16 }}>
          <Switch
            size="small"
            checked={background}
            disabled={activeStatus || installing || Boolean(statusError)}
            onChange={setBackground}
          />
          <span>{t("update.bgDownload")}</span>
        </label>
      )}

      {checking && !result && <Spin style={{ marginTop: 16 }} />}
      {error && <Alert style={{ marginTop: 16 }} type="error" showIcon title={errorText} />}
      {/* hook 只存提示 key：文案按当前语言在这里取，切语言后会跟着重译。 */}
      {statusError ? (
        <Alert
          style={{ marginTop: 16 }}
          type="warning"
          showIcon
          title={t(statusError)}
          action={
            <Button onClick={() => void refreshStatus()}>{t("update.action.retryStatus")}</Button>
          }
        />
      ) : null}
      {status?.state === "downloading" && !statusError && (
        <div style={{ marginTop: 16 }}>
          <Typography.Text>
            {t("update.downloading", {
              downloaded: formatBytes(status.downloaded_bytes),
              total: formatBytes(status.total_bytes),
            })}
          </Typography.Text>
          <Progress percent={Math.round(status.progress)} status="active" />
        </div>
      )}
      {status?.state === "installing" && !statusError && (
        <Alert
          style={{ marginTop: 16 }}
          type="info"
          showIcon
          title={t("update.installing.title")}
        />
      )}
      {status?.state === "failed" && status.message && !statusError && (
        <Alert style={{ marginTop: 16 }} type="error" showIcon title={status.message} />
      )}
      {status?.state === "ready" && !statusError && !desktop && (
        <Alert
          style={{ marginTop: 16 }}
          type="success"
          showIcon
          title={t("update.downloaded.title")}
          description={t("update.hint.restart")}
        />
      )}
      {desktop && (
        <Alert
          style={{ marginTop: 16 }}
          type="info"
          showIcon
          title={t("update.desktop.title")}
          description={
            <Space orientation="vertical" size={4} style={{ width: "100%" }}>
              <span>{t("update.desktop.description")}</span>
              {result?.release_url && (
                <Typography.Link
                  href={result.release_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t("update.action.release")}
                </Typography.Link>
              )}
            </Space>
          }
        />
      )}
      {result && (
        <Alert
          style={{ marginTop: 16 }}
          type={result.update_available ? "success" : "info"}
          showIcon
          title={result.message || t("update.result.title")}
          description={
            <Space orientation="vertical" size={4} style={{ width: "100%" }}>
              {result.latest_version && (
                <span>{t("update.result.latest", { version: result.latest_version })}</span>
              )}
              {result.published_at && (
                <span>
                  {t("update.result.published", { date: result.published_at.slice(0, 10) })}
                </span>
              )}
              {result.notes && (
                /* 版本说明是 markdown（## 标题 / - 列表 / **粗体**），不能当纯文本直出；
                   容器保留滚动（说明长时不把弹窗撑爆）。 */
                <div
                  style={{
                    maxHeight: 200,
                    overflowY: "auto",
                    overflowX: "hidden",
                    width: "100%",
                  }}
                >
                  {renderReleaseNotes(result.notes)}
                </div>
              )}
              {/* 桌面形态下"打开发布页面"已经在上面的指引框里出现，这里不再重复。 */}
              {result.release_url && !desktop && (
                <Typography.Link
                  href={result.release_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t("update.action.release")}
                </Typography.Link>
              )}
            </Space>
          }
        />
      )}
    </Card>
  );
}
