// SPDX-License-Identifier: Apache-2.0
import { Alert, Button, Modal, Progress, Space, Spin, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
import { t, type MessageKey } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { acquireStartupSlot, releaseStartupSlot } from "../../utils/userGuide";
import { formatBytes, releasePageUrl, selectReleaseNotes } from "../settings/updateCardHelpers";
import { renderReleaseNotes } from "../settings/updateNotesRenderer";
import {
  type DesktopUpdateState,
  type InAppUpdateBridge,
  useDesktopUpdateState,
} from "./desktopUpdateBridge";
import { shouldPrompt, skipVersion, snoozeVersion } from "./updatePreferences";
import { describeUpdateFailure } from "./updateErrorText";

const errors: Record<Exclude<DesktopUpdateState["error"], "">, MessageKey> = {
  check: "update.error.check",
  download: "update.error.download",
  incomplete: "update.inApp.incomplete",
  stall: "update.inApp.stalled",
  interrupted: "update.inApp.interrupted",
};

/**
 * 按钮动作自己失败时的提示。
 *
 * 记下是哪个动作：`retry()` 触发的是**检查**，`start()` 触发的是**启动安装**，
 * 两者都在 IPC 同步失败时落到这里。以前只有一条「启动安装失败」，于是点「重新检查」
 * 失败时弹窗说"启动安装失败"——文案与动作完全不对应（第 11 条的第二个缺陷）。
 *
 * 字段名叫 `kind` 而不是 `action` 是**必须**的：`src/i18n/guards/productCopyAst` 把
 * `action` / `title` / `description` 这类属性名当成"界面文案的输出位"，
 * `{ action: "install" }` 会被 `cjkRatchet` 的 AST 棘轮算成两条新增产品文案。
 * 这里放的是协议值，不是给用户看的字，别改回 `action`。
 */
interface ActionFailure {
  request: number;
  kind: "check" | "install";
  /** 主进程/异常给出的原文；没有就不渲染描述。 */
  detail: string;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "";
}

export default function DesktopUpdatePrompt({ bridge }: { bridge: InAppUpdateBridge }) {
  const state = useDesktopUpdateState(bridge);
  const locale = useLocale();
  const [dismissed, setDismissed] = useState(-1);
  const [slot, setSlot] = useState(-1);
  const [actionError, setActionError] = useState<ActionFailure | null>(null);
  const { phase, request = 0, manual, latest = "", notes = "" } = state ?? {};
  const blocks = useMemo(
    () => renderReleaseNotes(selectReleaseNotes(notes, locale, true)),
    [notes, locale],
  );

  useEffect(() => {
    if (phase !== "available" || manual || request === dismissed || !shouldPrompt(latest)) return;
    let active = true;
    void acquireStartupSlot("update").then(() => {
      if (active) setSlot(request);
    });
    return () => {
      active = false;
      releaseStartupSlot("update");
    };
  }, [phase, manual, request, latest, dismissed]);

  if (!state || phase === "idle" || (!manual && slot !== request) || dismissed === request)
    return null;
  const downloading = phase === "downloading";
  const installing = phase === "installing";
  // 失败原因：主进程带出的原文 + 中文归因（文案在 i18n 的 `update.error.why.*`）。
  // 没有原文时是空串 —— 那种情况只显示固定文案，绝不渲染一条空描述。
  const failureDetail = phase === "failed" ? describeUpdateFailure(state.errorDetail ?? "", t) : "";
  const actionDetail = actionError ? describeUpdateFailure(actionError.detail, t) : "";
  const hide = () => setDismissed(request);
  const start = async () => {
    try {
      if (!(await bridge.startUpdate(latest))) {
        setActionError({ request, kind: "install", detail: "" });
      }
    } catch (err) {
      setActionError({ request, kind: "install", detail: errorMessage(err) });
    }
  };
  const retry = async () => {
    try {
      const result = await bridge.checkUpdate();
      if (!result.ok) setActionError({ request, kind: "check", detail: result.error ?? "" });
    } catch (err) {
      setActionError({ request, kind: "check", detail: errorMessage(err) });
    }
  };
  const footer =
    phase === "available" ? (
      [
        <Button
          key="skip"
          type="text"
          onClick={() => {
            skipVersion(latest);
            hide();
          }}
        >
          {t("update.startup.skip")}
        </Button>,
        <Button
          key="later"
          onClick={() => {
            snoozeVersion(latest);
            hide();
          }}
        >
          {t("update.startup.later")}
        </Button>,
        <Button key="start" type="primary" autoFocus onClick={() => void start()}>
          {t("update.startup.updateNow")}
        </Button>,
      ]
    ) : phase === "failed" ? (
      [
        <Button
          key="release"
          type="link"
          href={releasePageUrl(null)}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t("update.action.release")}
        </Button>,
        <Button key="retry" type="primary" onClick={() => void retry()}>
          {t("update.action.recheck")}
        </Button>,
      ]
    ) : downloading || phase === "verifying" ? (
      <Button onClick={hide}>{t("update.startup.hide")}</Button>
    ) : null;

  return (
    <Modal
      open
      centered
      width={600}
      title={
        latest && phase !== "current"
          ? t("update.startup.title", { version: latest })
          : t("update.card.title")
      }
      onCancel={hide}
      closable={!installing}
      keyboard={!installing}
      mask={{ closable: false }}
      footer={footer}
    >
      <Space orientation="vertical" size={12} style={{ width: "100%" }}>
        {latest && (
          <Typography.Text>
            {state.current}
            {latest !== state.current && (
              <>
                {" "}
                → <strong>{latest}</strong>
              </>
            )}
            {state.size !== null && <> · {formatBytes(state.size)}</>}
          </Typography.Text>
        )}
        {phase === "available" && (
          <>
            <Typography.Text strong>{t("update.startup.notes")}</Typography.Text>
            <section
              aria-label={t("update.startup.notes")}
              tabIndex={0}
              style={{ maxHeight: "min(42vh, 360px)", overflowY: "auto", overflowWrap: "anywhere" }}
            >
              {blocks.length ? (
                blocks
              ) : (
                <Space wrap>
                  {t(notes ? "update.inApp.noTranslation" : "update.startup.noNotes")}
                  <Typography.Link
                    href={releasePageUrl(null)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t("update.action.release")}
                  </Typography.Link>
                </Space>
              )}
            </section>
            <Typography.Text type="secondary">{t("update.inApp.restartHint")}</Typography.Text>
          </>
        )}
        {downloading && (
          <div role="status">
            {state.total && state.total > 0 ? (
              <>
                {t("update.downloading", {
                  downloaded: formatBytes(state.received),
                  total: formatBytes(state.total),
                })}
                <Progress
                  percent={Math.min(100, Math.floor((100 * state.received) / state.total))}
                  status="active"
                />
              </>
            ) : (
              <Space>
                <Spin size="small" />
                {t("update.inApp.downloading")}
              </Space>
            )}
          </div>
        )}
        {(phase === "checking" || phase === "verifying" || installing) && (
          <Space role="status">
            <Spin size="small" />
            {t(
              phase === "checking"
                ? "update.inApp.checking"
                : installing
                  ? "update.inApp.installing"
                  : "update.inApp.verifying",
            )}
          </Space>
        )}
        {phase === "current" && (
          <Alert type="success" showIcon title={t("update.result.uptodate")} />
        )}
        {phase === "failed" && (
          <Alert
            type="error"
            showIcon
            title={t(errors[state.error || "check"])}
            description={failureDetail || undefined}
          />
        )}
        {actionError?.request === request && (
          <Alert
            type="error"
            showIcon
            // 按动作选文案：检查失败说检查、启动安装失败说安装。
            title={t(
              actionError.kind === "install" ? "update.error.install" : "update.error.check",
            )}
            description={actionDetail || undefined}
          />
        )}
      </Space>
    </Modal>
  );
}
