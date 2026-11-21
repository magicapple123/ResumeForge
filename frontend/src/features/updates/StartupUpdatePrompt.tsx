// SPDX-License-Identifier: Apache-2.0
/**
 * 启动时的更新弹窗（UP-01，形态 C）。
 *
 * 设计目标：把「知道有新版本 → 看更新内容 → 下载 → 安装」收在同一个弹窗里，用户不用
 * 再跳设置页。启动逻辑与界面拆成两半：
 * - `useStartupUpdatePrompt`：只在挂载时查一次；延迟 1.5s；在启动弹窗队列里排最后
 *   （欢迎 → 提醒 → 更新，见 `utils/userGuide.ts`）；只有 `update_available && !skipped
 *   && !snoozed` 才弹。
 * - `StartupUpdateDialog`：只负责按 `UpdateStatus` 渲染四种形态（首屏 / 下载中 / 已下载 /
 *   已启动安装），以及三个出口（稍后 / 跳过此版本 / 隐藏）。
 *
 * 平台边界：`installable === false`（macOS、Linux、浏览器）时主按钮是「下载安装包」，
 * 打开 `download_url`（缺省回退发布页），任何地方都不出现「重启并安装」。
 * 校验由后端在下载完成时做（`update_download.py` 里对比 `.sha256`），所以 `ready`
 * 只代表"已下载且校验通过"，前端不再自己算摘要。
 *
 * Windows 安装版使用 DesktopUpdatePrompt 与壳层共享状态。旧壳继续使用原更新入口。
 */
import { Alert, Button, Modal, Progress, Space, Typography } from "antd";
import type { ComponentRef } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  checkForUpdate,
  getAppForm,
  installDownloadedUpdate,
  startUpdateDownload,
} from "../../api/settings";
import { useUpdateDownloadStatus } from "../../hooks/useUpdateDownloadStatus";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { UpdateCheckResult } from "../../types";
import {
  formatBytes,
  getDesktopUpdateBridge,
  releasePageUrl,
  selectReleaseNotes,
} from "../settings/updateCardHelpers";
import { getInAppUpdateBridge } from "./desktopUpdateBridge";
import DesktopUpdatePrompt from "./DesktopUpdatePrompt";
import { renderReleaseNotes } from "../settings/updateNotesRenderer";
import { acquireStartupSlot, releaseStartupSlot } from "../../utils/userGuide";
import { shouldPrompt, skipVersion, snoozeVersion } from "./updatePreferences";

/** 卡片要求的"启动后约 1.5s"：给首屏数据与布局让路，避免和骨架屏抢注意力。 */
export const PROMPT_DELAY_MS = 1500;

/**
 * 折叠态最多渲染的说明块数。此前用 `maxHeight: 72` + `overflow: hidden` 裁 CSS，块级
 * 元素自带外边距，首块是正文时第 3 行被切在半行；按块切片后切口永远落在块边界。
 */
const NOTES_COLLAPSED_BLOCKS = 3;

/** 展开态内容区的高度上限；超出时内部滚动，底部渐隐 + 提示（7.7）。 */
const NOTES_EXPANDED_MAX_HEIGHT = 360;

interface PromptState {
  result: UpdateCheckResult | null;
  open: boolean;
  snooze: () => void;
  skip: () => void;
  hide: () => void;
}

/** 启动判断。三个出口：`snooze` 写 24h、`skip` 永久跳过此版本、`hide` 只关窗不写偏好。 */
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
        // 三件启动弹窗共用一条队列：欢迎 → 提醒 → 更新。前面两件没关掉就等。
        await acquireStartupSlot("update");
        if (cancelled) {
          releaseStartupSlot("update");
          return;
        }
        setResult(next);
        setOpen(true);
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

  // 弹窗关掉 / 卸载都释放槽位，release 幂等（第二条同时撤销还在排队的申请）。
  useEffect(() => {
    if (!open) return undefined;
    return () => releaseStartupSlot("update");
  }, [open]);
  useEffect(() => () => releaseStartupSlot("update"), []);

  const closeWith = useCallback((write?: (version: string) => void) => {
    setOpen(false);
    setResult((current) => {
      if (current && write) write(current.latest_version);
      return current;
    });
  }, []);
  const snooze = useCallback(() => closeWith(snoozeVersion), [closeWith]);
  const skip = useCallback(() => closeWith(skipVersion), [closeWith]);
  const hide = useCallback(() => setOpen(false), []);

  return { result, open, snooze, skip, hide };
}

export default function StartupUpdatePrompt({ enabled = true }: { enabled?: boolean }) {
  const bridge = getInAppUpdateBridge();
  if (bridge) return enabled ? <DesktopUpdatePrompt bridge={bridge} /> : null;
  return <PortableUpdatePrompt enabled={enabled} />;
}

function PortableUpdatePrompt({ enabled }: { enabled: boolean }) {
  const prompt = useStartupUpdatePrompt(enabled);
  // 形态在弹窗之前问好（否则先画「立即更新」再跳「去更新」）；探测失败静默按非桌面处理。
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void getAppForm()
      .then((form) => {
        if (!cancelled) setDesktop(form.desktop);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  if (!prompt.result || !prompt.open) return null;
  return (
    <StartupUpdateDialog
      result={prompt.result}
      desktop={desktop}
      onSnooze={prompt.snooze}
      onSkip={prompt.skip}
      onHide={prompt.hide}
    />
  );
}

interface DialogProps {
  result: UpdateCheckResult;
  desktop: boolean;
  onSnooze: () => void;
  onSkip: () => void;
  onHide: () => void;
}

function StartupUpdateDialog({ result, desktop, onSnooze, onSkip, onHide }: DialogProps) {
  const locale = useLocale();
  const { status, setStatus } = useUpdateDownloadStatus();
  const [notesOpen, setNotesOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState("");
  const [notesOverflowing, setNotesOverflowing] = useState(false);
  const [notesAtBottom, setNotesAtBottom] = useState(false);
  const mounted = useRef(true);
  const primaryRef = useRef<ComponentRef<typeof Button>>(null);
  const notesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const state = status?.state ?? "idle";
  // 桌面形态的下载/安装由壳负责；后端状态可能是页面内下载留下的旧值，不能拿来渲染。
  const downloading = !desktop && (state === "downloading" || busy);
  const ready = !desktop && state === "ready";
  const installingNow = !desktop && (state === "installing" || installing);

  // 打开时焦点落在主按钮（不是右上角 ×），状态切换后重新聚焦——否则旧按钮卸载后焦点
  // 会掉回 ×，回车就等于「稍后 24 小时」。
  useEffect(() => {
    const timer = window.setTimeout(() => primaryRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [state, desktop, downloading, ready, installingNow]);

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

  const openDesktopUpdater = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const bridge = getDesktopUpdateBridge();
      if (bridge?.checkUpdate) {
        // 壳负责检查 → 确认框 → 下载 → 校验 → 静默安装 → 重启，页面只负责"按一下"。
        await bridge.checkUpdate();
        if (mounted.current) onHide();
        return;
      }
      // 2.1 及更早的壳没有这条通道：退回发布页手动装，至少不会走到 zip 覆盖那条路。
      window.open(result.download_url || releasePageUrl(result), "_blank", "noopener,noreferrer");
      if (mounted.current) onHide();
    } catch (err) {
      if (mounted.current) {
        setError(err instanceof Error ? err.message : t("update.error.check"));
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
        <Button key="installing" ref={primaryRef} type="primary" loading disabled>
          {t("update.installing.title")}
        </Button>,
      ];
    }
    if (downloading) {
      return [
        <Button key="hide" ref={primaryRef} onClick={onHide}>
          {t("update.startup.hide")}
        </Button>,
      ];
    }
    if (ready) {
      return result.installable
        ? [
            <Button
              key="install"
              ref={primaryRef}
              type="primary"
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
            <Button key="download" ref={primaryRef} type="primary" onClick={() => void download()}>
              {t("update.startup.downloadPackage")}
            </Button>,
          ];
    }
    const exits = [
      <Button key="skip" type="text" title={t("update.startup.skipHint")} onClick={onSkip}>
        {t("update.startup.skip")}
      </Button>,
      <Button key="later" title={t("update.startup.laterHint")} onClick={onSnooze}>
        {t("update.startup.later")}
      </Button>,
    ];
    if (desktop) {
      // 桌面形态：按钮接壳，主色实心；「跳过 / 稍后」仍只影响这个弹窗。
      return [
        ...exits,
        <Button
          key="updater"
          ref={primaryRef}
          type="primary"
          loading={busy}
          onClick={() => void openDesktopUpdater()}
        >
          {t("update.startup.openUpdater")}
        </Button>,
      ];
    }
    return [
      ...exits,
      <Button
        key="now"
        ref={primaryRef}
        type="primary"
        loading={busy}
        onClick={() => void download()}
      >
        {result.installable ? t("update.startup.updateNow") : t("update.startup.downloadPackage")}
      </Button>,
    ];
  })();

  // Esc / 点遮罩只关窗，不写偏好：把「稍后 24 小时」留给按钮，避免误触变成明天再说。
  const handleCancel = () => onHide();

  const noteBlocks = useMemo(
    () => renderReleaseNotes(selectReleaseNotes(result.release_body || result.notes, locale)),
    [result.release_body, result.notes, locale],
  );
  const canExpandNotes = noteBlocks.length > NOTES_COLLAPSED_BLOCKS;
  const visibleNotes =
    notesOpen || !canExpandNotes ? noteBlocks : noteBlocks.slice(0, NOTES_COLLAPSED_BLOCKS);

  // 展开态量一下是否真的还有内容在视口外：没有就不画渐隐，短说明不出现假提示。
  useEffect(() => {
    if (!notesOpen) {
      setNotesOverflowing(false);
      setNotesAtBottom(false);
      return undefined;
    }
    const node = notesRef.current;
    if (!node) return undefined;
    const measure = () => setNotesOverflowing(node.scrollHeight - node.clientHeight > 4);
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [notesOpen, noteBlocks]);

  return (
    <Modal
      open
      centered
      width={560}
      title={t("update.startup.title", { version: result.latest_version })}
      onCancel={handleCancel}
      footer={footer}
      destroyOnHidden
      afterOpenChange={(visible) => {
        if (visible) primaryRef.current?.focus();
      }}
    >
      <Space orientation="vertical" size={12} style={{ width: "100%" }}>
        {/* 单行版本对比：2.1.0 → 2.2.0；当前版本次要、最新版本加重。 */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Typography.Text type="secondary" title={t("update.startup.current")}>
            {result.current_version}
          </Typography.Text>
          <Typography.Text type="secondary" aria-hidden="true">
            →
          </Typography.Text>
          <Typography.Text strong title={t("update.startup.latest")}>
            {result.latest_version}
          </Typography.Text>
          {result.download_size !== null && (
            <div style={{ marginInlineStart: "auto", display: "flex", gap: 6 }}>
              <Typography.Text type="secondary">{t("update.startup.size")}</Typography.Text>
              <Typography.Text>{formatBytes(result.download_size)}</Typography.Text>
            </div>
          )}
        </div>

        {!desktop && !result.installable && (
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
            <Typography.Text strong>{t("update.startup.notes")}</Typography.Text>
            <div
              style={{
                marginTop: 8,
                background: "var(--rf-surface-alt)",
                borderRadius: 8,
                padding: 12,
              }}
            >
              <div style={{ position: "relative" }}>
                <div
                  ref={notesRef}
                  onScroll={(event) => {
                    const node = event.currentTarget;
                    setNotesAtBottom(node.scrollHeight - node.scrollTop - node.clientHeight < 8);
                  }}
                  style={{
                    lineHeight: "24px",
                    maxHeight: notesOpen ? NOTES_EXPANDED_MAX_HEIGHT : undefined,
                    overflowY: notesOpen ? "auto" : "visible",
                    overflowX: "hidden",
                  }}
                >
                  {visibleNotes.length > 0 ? (
                    visibleNotes
                  ) : (
                    <Typography.Text type="secondary">
                      {t("update.startup.noNotes")}
                    </Typography.Text>
                  )}
                </div>
                {notesOpen && notesOverflowing && !notesAtBottom && (
                  <div
                    aria-hidden="true"
                    style={{
                      position: "absolute",
                      insetInline: 0,
                      bottom: 0,
                      height: 28,
                      pointerEvents: "none",
                      background: "linear-gradient(to bottom, transparent, var(--rf-surface-alt))",
                    }}
                  />
                )}
              </div>
              {notesOpen && notesOverflowing && !notesAtBottom && (
                <Typography.Text
                  type="secondary"
                  aria-hidden="true"
                  style={{ display: "block", fontSize: 12, marginTop: 4 }}
                >
                  {t("update.startup.scrollHint")}
                </Typography.Text>
              )}
              {canExpandNotes && (
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
                  <Button
                    type="link"
                    size="small"
                    aria-expanded={notesOpen}
                    onClick={() => setNotesOpen((previous) => !previous)}
                  >
                    {notesOpen ? t("update.startup.collapse") : t("update.startup.expand")}
                  </Button>
                </div>
              )}
            </div>
          </section>
        )}
      </Space>
    </Modal>
  );
}
