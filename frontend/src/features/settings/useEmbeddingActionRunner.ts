// SPDX-License-Identifier: Apache-2.0
/**
 * 「语义检索」卡的动作执行器：忙碌互斥 + 失败落「原因 + 怎么办」+ 成功后重读状态。
 *
 * 单拆出来是为了让状态编排（useEmbeddingSettings）与动作执行器保持在 300 行以内，
 * 两处都需要同一套语义：任何动作都「发请求 → 立刻重读 status → 由 status 决定界面」。
 */
import { App } from "antd";
import { useCallback, useState } from "react";
import { formatErrorGuidance } from "../../api/errorGuidance";
import type { EmbeddingStatus } from "../../api/settings";
import { t } from "../../i18n";

/** 同一时刻只允许一个动作在跑（按钮 loading / 防重复提交）。 */
export type EmbeddingActionId =
  | "download"
  | "cancel"
  | "remove"
  | "enableLocal"
  | "test"
  | "fetchModels"
  | "enable"
  | "disable"
  | "clear"
  | "revoke";

type AppMessage = ReturnType<typeof App.useApp>["message"];

export function useEmbeddingActionRunner(refresh: () => Promise<EmbeddingStatus | null>) {
  const { message } = App.useApp();
  const [busy, setBusy] = useState<EmbeddingActionId | null>(null);
  /** 最近一次动作的完整「原因 + 怎么办」（卡片内 Alert 展示，不只在 Toast 里）。 */
  const [actionError, setActionError] = useState("");

  const run = useCallback(
    async (
      id: EmbeddingActionId,
      action: () => Promise<unknown>,
      success?: string,
    ): Promise<boolean> => {
      if (busy !== null) return false;
      setBusy(id);
      setActionError("");
      try {
        await action();
        await refresh();
        if (success) message.success(success);
        return true;
      } catch (error) {
        setActionError(formatErrorGuidance(error, t("embeddingSearch.guidance.retry")));
        message.error(t("embeddingSearch.guidance.retry"));
        return false;
      } finally {
        setBusy(null);
      }
    },
    [busy, message, refresh],
  );

  return {
    busy,
    setBusy,
    actionError,
    setActionError,
    clearActionError: () => setActionError(""),
    run,
  };
}

export type { AppMessage };
