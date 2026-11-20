// SPDX-License-Identifier: Apache-2.0
/**
 * 启动时的更新弹窗（UP-01，形态 C）。
 *
 * 设计目标：把「知道有新版本 → 看更新内容 → 下载 → 安装」收在同一个弹窗里，用户不用
 * 再跳设置页。启动逻辑与界面拆成两半：
 * - `useStartupUpdatePrompt`：只在挂载时查一次；延迟 1.5s；与首访指南冲突时等它关掉；
 *   只有 `update_available && !skipped && !snoozed` 才弹。
 * - `StartupUpdateDialog`：只负责按 `UpdateStatus` 渲染四种形态（首屏 / 下载中 / 已下载 /
 *   已启动安装），以及三个出口（稍后 / 跳过此版本 / 隐藏）。
 *
 * 平台边界：`installable === false`（macOS、Linux、浏览器）时主按钮是「下载安装包」，
 * 打开 `download_url`（缺省回退发布页），任何地方都不出现「重启并安装」。
 * 校验由后端在下载完成时做（`update_download.py` 里对比 `.sha256`），所以 `ready`
 * 只代表"已下载且校验通过"，前端不再自己算摘要。
 */
import { Alert, Button, Modal, Progress, Space, Typography } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { checkForUpdate, installDownloadedUpdate, startUpdateDownload } from "../../api/settings";
import { useUpdateDownloadStatus } from "../../hooks/useUpdateDownloadStatus";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { UpdateCheckResult } from "../../types";
import { formatBytes, releasePageUrl } from "../settings/updateCardHelpers";
import { renderReleaseNotes } from "../settings/updateNotesRenderer";
import { onceUserGuideClosed } from "../../utils/userGuide";
import { shouldPrompt, skipVersion, snoozeVersion } from "./updatePreferences";

/** 卡片要求的"启动后约 1.5s"：给首屏数据与布局让路，避免和骨架屏抢注意力。 */
export const PROMPT_DELAY_MS = 1500;

/** 说明块收起时的高度：3 行 × 24px 行高。 */
const NOTES_COLLAPSED_HEIGHT = 72;

interface PromptState {
  result: UpdateCheckResult | null;
  open: boolean;
  snooze: () => void;
  skip: () => void;
  hide: () => void;
}

/**
 * 启动判断。返回的 `snooze/skip/hide` 是三个出口：
 * - `snooze`：「稍后」与右上角 ×，写 24h；
 * - `skip`：「跳过此版本」，永久跳过这个版本；
 * - `hide`：下载中的「隐藏」，只关窗，不写任何偏好（下载在后台继续）。
 */
export function useStartupUpdatePrompt(enabled = true): PromptState {
  const [result, setResult] = useState<UpdateCheckResult | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;

    const decide = async () => {
      try {
        const next = await checkForUpdate(false);
        if (cancelled || !next.update_available) return;
        if (!shouldPrompt(next.latest_version)) return;
        // 首访指南/迁移对话框在前：等它关掉再弹，避免两个启动弹窗叠在一起。
        onceUserGuideClosed(() => {
          if (cancelled) return;
          setResult(next);
          setOpen(true);
        });
      } catch {
        // 启动检查失败不打扰用户：设置页的「软件更新」仍可手动检查。
      }
    };

    // StrictMode 会跑两遍 effect：第一遍的计时器在 cleanup 里被清掉，第二遍只留一个。
    const timer = window.setTimeout(() => void decide(), PROMPT_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [enabled]);

  const snooze = useCallback(() => {
    setOpen(false);
    setResult((current) => {
      if (current) snoozeVersion(current.latest_version);
      return current;
    });
  }, []);

  const skip = useCallback(() => {
    setOpen(false);
    setResult((current) => {
      if (current) skipVersion(current.latest_version);
      return current;
    });
  }, []);

  const hide = useCallback(() => setOpen(false), []);

  return { result, open, snooze, skip, hide };
}

export default function StartupUpdatePrompt({ enabled = true }: { enabled?: boolean }) {
  const prompt = useStartupUpdatePrompt(enabled);
  if (!prompt.result || !prompt.open) return null;
  return (
    <StartupUpdateDialog
      result={prompt.result}
      onSnooze={prompt.snooze}
      onSkip={prompt.skip}
      onHide={prompt.hide}
    />
  );
}

interface DialogProps {
  result: UpdateCheckResult;
  onSnooze: () => void;
  onSkip: () => void;
  onHide: () => void;
}

function StartupUpdateDialog({ result, onSnooze, onSkip, onHide }: DialogProps) {
  useLocale();
  const { status, setStatus } = useUpdateDownloadStatus();
  const [notesOpen, setNotesOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const state = status?.state ?? "idle";
  const downloading = state === "downloading" || busy;
  const ready = state === "ready";
  const installingNow = state === "installing" || installing;

  const download = async () => {
    if (busy) return;
    if (!result.installable) {
      // 浏览器 / macOS / Linux：没有应用内安装通道，直接给安装包或发布页。
      const url = result.download_url || releasePageUrl(result);
      window.open(url, "_blank", "noopener,noreferrer");
      if (mounted.current) onHide();
      return;
    }
    setBusy(true);
    setError("");
    try {
      // `background=true`：用户点「隐藏」关掉弹窗后下载仍在后端继续，完成状态由
      // useUpdateDownloadStatus 在下次打开时读出来。
      const next = await startUpdateDownload(true);
      if (mounted.current) setStatus(next);
    } catch (err) {
      if (mounted.current) {
        setError(err instanceof Error ? err.message : t("update.error.download"));
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const install = async () => {
    if (installing) return;
    setInstalling(true);
    setError("");
    try {
      const next = await installDownloadedUpdate(true);
      if (mounted.current) setStatus(next);
    } catch (err) {
      if (mounted.current) {
        setInstalling(false);
        setError(err instanceof Error ? err.message : t("update.error.install"));
      }
    }
  };

  const footer = (() => {
    if (installingNow) {
      return [
        <Button key="installing" type="primary" loading disabled>
          {t("update.installing.title")}
        </Button>,
      ];
    }
    if (downloading) {
      return [
        <Button key="hide" onClick={onHide}>
          {t("update.startup.hide")}
        </Button>,
      ];
    }
    if (ready) {
      return result.installable
        ? [
            <Button
              key="install"
              type="primary"
              danger
              loading={installing}
              onClick={() => void install()}
            >
              {t("update.startup.install")}
            </Button>,
          ]
        : [
            <Button
              key="release"
              onClick={() => window.open(releasePageUrl(result), "_blank", "noopener,noreferrer")}
            >
              {t("update.startup.release")}
            </Button>,
            <Button key="download" type="primary" onClick={() => void download()}>
              {t("update.startup.downloadPackage")}
            </Button>,
          ];
    }
    return [
      <Button key="skip" type="text" title={t("update.startup.skipHint")} onClick={onSkip}>
        {t("update.startup.skip")}
      </Button>,
      <Button key="later" title={t("update.startup.laterHint")} onClick={onSnooze}>
        {t("update.startup.later")}
      </Button>,
      <Button key="now" type="primary" loading={busy} onClick={() => void download()}>
        {result.installable ? t("update.startup.updateNow") : t("update.startup.downloadPackage")}
      </Button>,
    ];
  })();

  // 下载中按 × 视同「隐藏」：用户此刻要的是"别挡着我"，不是"明天再说"。
  const handleCancel = () => {
    if (downloading || installingNow) {
      onHide();
      return;
    }
    onSnooze();
  };

  return (
    <Modal
      open
      centered
      width={560}
      title={t("update.startup.title", { version: result.latest_version })}
      onCancel={handleCancel}
      footer={footer}
      destroyOnHidden
    >
      <Space orientation="vertical" size={12} style={{ width: "100%" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 20 }}>
          <div>
            <Typography.Text type="secondary">{t("update.startup.current")}</Typography.Text>
            <div>
              <Typography.Text strong>{result.current_version}</Typography.Text>
            </div>
          </div>
          <Typography.Text type="secondary" aria-hidden="true">
            →
          </Typography.Text>
          <div>
            <Typography.Text type="secondary">{t("update.startup.latest")}</Typography.Text>
            <div>
              <Typography.Text strong>{result.latest_version}</Typography.Text>
            </div>
          </div>
          {result.download_size !== null && (
            <div style={{ marginInlineStart: "auto" }}>
              <Typography.Text type="secondary">{t("update.startup.size")}</Typography.Text>
              <div>
                <Typography.Text>{formatBytes(result.download_size)}</Typography.Text>
              </div>
            </div>
          )}
        </div>

        {!result.installable && (
          <Alert type="info" showIcon title={t("update.startup.unsupported")} />
        )}

        {error && <Alert type="error" showIcon title={error} />}

        {downloading && (
          <div>
            <Typography.Text>
              {t("update.downloading", {
                downloaded: formatBytes(status?.downloaded_bytes ?? null),
                total: formatBytes(status?.total_bytes ?? null),
              })}
            </Typography.Text>
            <Progress percent={Math.round(status?.progress ?? 0)} status="active" />
          </div>
        )}

        {ready && (
          <Alert
            type="success"
            showIcon
            title={t("update.startup.ready")}
            description={t("update.startup.readyHint")}
          />
        )}

        {!downloading && !ready && (
          <section>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <Typography.Text strong>{t("update.startup.notes")}</Typography.Text>
              <Button
                type="link"
                size="small"
                aria-expanded={notesOpen}
                onClick={() => setNotesOpen((previous) => !previous)}
              >
                {notesOpen ? t("update.startup.collapse") : t("update.startup.expand")}
              </Button>
            </div>
            <div
              style={{
                maxHeight: notesOpen ? undefined : NOTES_COLLAPSED_HEIGHT,
                overflow: "hidden",
                lineHeight: "24px",
              }}
            >
              {result.notes ? (
                renderReleaseNotes(result.notes)
              ) : (
                <Typography.Text type="secondary">{t("update.startup.noNotes")}</Typography.Text>
              )}
            </div>
          </section>
        )}
      </Space>
    </Modal>
  );
}
