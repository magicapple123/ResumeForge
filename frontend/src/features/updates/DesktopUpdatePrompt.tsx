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

const errors: Record<Exclude<DesktopUpdateState["error"], "">, MessageKey> = {
  check: "update.error.check",
  download: "update.error.download",
  incomplete: "update.inApp.incomplete",
  stall: "update.inApp.stalled",
  interrupted: "update.inApp.interrupted",
};

export default function DesktopUpdatePrompt({ bridge }: { bridge: InAppUpdateBridge }) {
  const state = useDesktopUpdateState(bridge);
  const locale = useLocale();
  const [dismissed, setDismissed] = useState(-1);
  const [slot, setSlot] = useState(-1);
  const [actionError, setActionError] = useState<number | null>(null);
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
  const hide = () => setDismissed(request);
  const start = async () => {
    try {
      if (!(await bridge.startUpdate(latest))) setActionError(request);
    } catch {
      setActionError(request);
    }
  };
  const retry = async () => {
    try {
      if (!(await bridge.checkUpdate()).ok) setActionError(request);
    } catch {
      setActionError(request);
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
          <Alert type="error" showIcon title={t(errors[state.error || "check"])} />
        )}
        {actionError === request && (
          <Alert type="error" showIcon title={t("update.error.install")} />
        )}
      </Space>
    </Modal>
  );
}
