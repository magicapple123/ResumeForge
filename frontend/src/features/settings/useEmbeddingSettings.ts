// SPDX-License-Identifier: Apache-2.0
/**
 * 设置页「语义检索」卡的状态编排（RAG v3）。
 *
 * 状态机唯一真相源是 GET /api/settings/embedding/status（契约 §3）：所有动作都遵循
 * 「发请求 → 立刻重读 status → 由 status 决定界面」，不在前端维护第二份生效状态，
 * 避免出现「界面已启用、后端其实没写」或反之。
 *
 * 三条容易踩的流程：
 * 1. 本地是两段式：POST /local/download 只下载+解包+校验，**不会**自动启用；轮询到
 *    local.state=ready 后必须再调一次 POST /local/enable 才写配置。下载按钮因此是
 *    「一个按钮串起来」的：下载成功后自动 enable（用户只看到 下载中 → 就绪）。
 * 2. 隐私确认按 host 记（见 useEmbeddingRemoteActions）：host 不在 confirmed_hosts
 *    里就弹一次 Modal，确认后先 /remote/confirm 再 /remote/enable。
 * 3. 撤销确认必须真的停：后端 revoke 端点会对当前生效 host 一并写 enabled=False
 *    （见 backend/app/api/settings_embedding.py），前端重读状态即可。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelEmbeddingLocalDownload,
  clearEmbedding,
  disableEmbedding,
  enableEmbeddingLocal,
  getEmbeddingStatus,
  removeEmbeddingLocalAssets,
  revokeEmbeddingHost,
  startEmbeddingLocalDownload,
  type EmbeddingStatus,
} from "../../api/settings";
import { t } from "../../i18n";
import { useEmbeddingActionRunner } from "./useEmbeddingActionRunner";
import { useEmbeddingRemoteActions } from "./useEmbeddingRemoteActions";

/** 后台还在下载/解包的三个状态：要轮询，界面显示进度。 */
const LOCAL_BUSY_STATES: readonly EmbeddingStatus["local"]["state"][] = [
  "downloading",
  "verifying",
  "extracting",
];

/** 轮询间隔：下载进度只需要秒级反馈，1s 足够且不刷爆后端。 */
const POLL_INTERVAL_MS = 1000;

export function useEmbeddingSettings() {
  const [status, setStatus] = useState<EmbeddingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  /** 下载成功后是否自动接一次 /local/enable（用户只点了一次下载按钮）。 */
  const autoEnableLocalRef = useRef(false);

  const refresh = useCallback(async (): Promise<EmbeddingStatus | null> => {
    try {
      const next = await getEmbeddingStatus();
      setStatus(next);
      setLoadError("");
      return next;
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : t("embeddingSearch.loadFailed"));
      return null;
    }
  }, []);

  // 挂载读一次状态。setState 都在 await 之后，避免 effect 体内同步 setState。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await getEmbeddingStatus();
        if (!cancelled) {
          setStatus(next);
          setLoadError("");
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : t("embeddingSearch.loadFailed"));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const { busy, setBusy, actionError, setActionError, clearActionError, run } =
    useEmbeddingActionRunner(refresh);
  const localBusy = status !== null && LOCAL_BUSY_STATES.includes(status.local.state);

  // 下载/解包期间轮询；到 ready 且用户是从「下载」按钮进来的，就自动接启用。
  useEffect(() => {
    if (!localBusy) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        const next = await refresh();
        if (cancelled || !next) return;
        if (!autoEnableLocalRef.current) return;
        if (next.local.state !== "ready" || next.state === "ready") return;
        autoEnableLocalRef.current = false;
        await run("enableLocal", enableEmbeddingLocal, t("embeddingSearch.local.enabled"));
      })();
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [localBusy, status, refresh, run]);

  const startDownload = async () => {
    autoEnableLocalRef.current = false;
    const started = await run(
      "download",
      startEmbeddingLocalDownload,
      t("embeddingSearch.local.started"),
    );
    // 只有请求真的成功才接管「下载完成后自动启用」；否则用户看到的是失败原因。
    if (started) autoEnableLocalRef.current = true;
  };

  const cancelDownload = async () => {
    autoEnableLocalRef.current = false;
    await run("cancel", cancelEmbeddingLocalDownload, t("embeddingSearch.local.cancelled"));
  };

  const enableLocal = async () => {
    await run("enableLocal", enableEmbeddingLocal, t("embeddingSearch.local.enabled"));
  };

  const removeAssets = async () => {
    await run("remove", removeEmbeddingLocalAssets, t("embeddingSearch.local.removed"));
  };

  const disable = async () => {
    await run("disable", disableEmbedding, t("embeddingSearch.remote.disabled"));
  };

  const clearKey = async () => {
    await run("clear", clearEmbedding, t("embeddingSearch.remote.cleared"));
  };

  const revokeHost = async (host: string) => {
    await run("revoke", () => revokeEmbeddingHost(host), t("embeddingSearch.hosts.revoked"));
  };

  const remote = useEmbeddingRemoteActions({ status, run, setBusy, setActionError });

  return {
    status,
    loading,
    loadError,
    busy,
    actionError,
    clearActionError,
    reload: refresh,
    startDownload,
    cancelDownload,
    retryDownload: startDownload,
    enableLocal,
    removeAssets,
    disable,
    clearKey,
    revokeHost,
    ...remote,
  };
}

export type { EmbeddingActionId } from "./useEmbeddingActionRunner";
