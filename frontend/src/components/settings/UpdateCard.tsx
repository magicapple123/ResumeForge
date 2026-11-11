// SPDX-License-Identifier: Apache-2.0
/** 软件更新：检查、下载并安排安全覆盖安装。 */

import {
  CloudDownloadOutlined,
  DownloadOutlined,
  ReloadOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import { Alert, App, Button, Card, Progress, Space, Spin, Switch, Typography } from "antd";
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
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import UpdateReleaseNotes from "./UpdateReleaseNotes";
import {
  formatBytes,
  getDesktopUpdateBridge,
  releasePageUrl,
  resultConclusion,
  type CardError,
} from "./updateCardHelpers";

const UPDATE_COMPLETED_KEY = "resumeforge.update.completed";

/**
 * 「重新检查」的最小点击间隔（秒），与后端 `update_check._MIN_REFRESH_INTERVAL_SECONDS`
 * 同值。
 *
 * 两处都要有，因为它们防的不是同一件事：后端那道闸挡住"绕过界面直接打接口"，以及
 * 多标签页同时点；这里这道闸让按钮**自己**说出"还要等 N 秒"，用户不用去猜为什么点不动。
 * 连点 5 次只产生 1 次上游请求的实证在后端用例里（`test_five_rechecks_in_a_row_hit_the_upstream_once`）。
 */
const RECHECK_COOLDOWN_SECONDS = 60;

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
  // 「重新检查」的冷却剩余秒数：>0 时按钮禁用并显示倒计时（见 RECHECK_COOLDOWN_SECONDS）。
  const [cooldown, setCooldown] = useState(0);

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

  // 冷却倒计时：每秒减一，归零后按钮恢复。用 setTimeout 递归（每次依赖变化重建）
  // 而不是 setInterval，卸载或重新点击时不会留下一个还在跑的定时器。
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  const check = async (refresh: boolean) => {
    if (checking || cooldown > 0) return;
    setChecking(true);
    setError(null);
    try {
      // 桌面壳里更新由主进程负责（它才知道安装包路径、静默安装和重启的先后顺序），
      // 页面这层只负责"按一下"。桥不存在（2.1 及更早的壳）就往下走普通检查——
      // 那条路会直接连后端，结果照常渲染，同时 A 方案的三段式说明仍在卡片上方，
      // 用户至少知道手动入口在哪。
      const bridge = desktop ? getDesktopUpdateBridge() : null;
      if (bridge?.checkUpdate) {
        await bridge.checkUpdate();
        // 结论由主进程用系统弹窗给出（页面里没有进度可看），这里只说明"去哪儿看"。
        message.info(t("update.toast.desktopStarted"));
        return;
      }
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
      // 冷却起点放在 finally：无论成功、失败还是走了桌面桥，下一次点击都要等 60 秒。
      setCooldown(RECHECK_COOLDOWN_SECONDS);
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
      <Space wrap>
        <Button
          type="primary"
          icon={<CloudDownloadOutlined />}
          aria-label={t("update.action.check")}
          loading={checking}
          // 「检查更新」首次传 refresh=false：后端 15 分钟缓存命中就不打上游。
          // refresh=true 只留给「重新检查」（用户明确要一次新的结果）。
          disabled={cooldown > 0}
          onClick={() => void check(false)}
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
            disabled={checking || activeStatus || cooldown > 0}
            onClick={() => void check(true)}
          >
            {/* 冷却期间把剩余秒数写在按钮上：点不动的时候，用户需要知道还要等多久。 */}
            {cooldown > 0
              ? t("update.action.recheckIn", { seconds: cooldown })
              : t("update.action.recheck")}
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
      <div className="update-meta">
        <div className="update-meta-item">
          <span className="update-meta-label">{t("update.field.channel")}</span>
          <Typography.Text strong>
            {desktop ? t("update.method.desktop") : t("update.method.in-app")}
          </Typography.Text>
        </div>
        <div className="update-meta-item">
          <span className="update-meta-label">{t("update.field.current")}</span>
          <Typography.Text strong>
            {result?.current_version || status?.current_version || t("update.value.checkFirst")}
          </Typography.Text>
        </div>
        <div className="update-meta-item">
          <span className="update-meta-label">{t("update.field.latest")}</span>
          <Typography.Text strong>
            {result?.latest_version || status?.target_version || t("update.value.checkFirst")}
          </Typography.Text>
        </div>
        <div className="update-meta-item">
          {/* 发布时间从结果 Alert 里搬到这里：它是「这条结论有多新」的属性，
              与通道/当前/最新并列才读得通（#11 第 2 条，四列等宽）。 */}
          <span className="update-meta-label">{t("update.field.published")}</span>
          <Typography.Text strong>
            {result?.published_at ? result.published_at.slice(0, 10) : t("update.value.noDate")}
          </Typography.Text>
        </div>
      </div>
      <Typography.Text type="secondary" className="update-meta-note">
        {t("update.side.note")}
      </Typography.Text>
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
        /* A 方案（02-1）：三段式说清"谁在检查 → 手动入口在哪 → 保底出口"。
           桌面版的升级通道在壳里（desktop/updater.js：启动 30s + 每 6 小时），不在这张卡片，
           所以这里既不能放"下载"按钮，也不能只说一句"由应用自己检查"——用户会以为没救。 */
        <Alert
          style={{ marginTop: 16 }}
          type="info"
          showIcon
          title={t("update.desktop.title")}
          description={
            <Space orientation="vertical" size={4} style={{ width: "100%" }}>
              {/* ① 谁在检查、什么时候检查 */}
              <span>{t("update.desktop.description")}</span>
              {/* ② 手动入口固定两个：菜单项与安装目录里的 update.cmd */}
              <span>{t("update.desktop.manual")}</span>
              {/* ③ 保底出口：发布页下载 Setup.exe，链接始终可见（走桌面桥时页面里没有 result） */}
              <span>
                {t("update.desktop.releaseHint")}{" "}
                <Typography.Link
                  href={releasePageUrl(result)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t("update.action.release")}
                </Typography.Link>
              </span>
            </Space>
          }
        />
      )}
      {result && (
        /* 结果只做一件事：给出结论 + 主操作。版本号在 .update-meta 里已有专列，
           发布说明在下面的独立块里——Alert 不再承载正文（原来它一个就占了卡片六成高）。 */
        <Alert
          className="update-status-bar"
          style={{ marginTop: 16 }}
          type={result.update_available ? "success" : "info"}
          showIcon
          title={resultConclusion(result)}
          action={
            /* 桌面形态下「打开发布页面」已经在上面的指引框里出现，这里不再重复。 */
            !desktop && result.release_url ? (
              <Typography.Link href={result.release_url} target="_blank" rel="noopener noreferrer">
                {t("update.action.release")}
              </Typography.Link>
            ) : undefined
          }
        />
      )}
      {result?.notes ? <UpdateReleaseNotes notes={result.notes} /> : null}
    </Card>
  );
}
