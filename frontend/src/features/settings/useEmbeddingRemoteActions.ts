// SPDX-License-Identifier: Apache-2.0
/**
 * 「语义检索」卡的远程动作：测试连接、拉取模型列表、按 host 的隐私确认与启用。
 *
 * 从 useEmbeddingSettings 拆出来的原因只有一个：把状态编排与远程动作各控制在 300 行内。
 * 隐私确认按 host 记（换 host 重新确认）；确认的 host 口径必须与后端 host() 一致：
 * 模板模式取 request_url 的主机（见 embeddingEndpointAddress）。
 */
import { App } from "antd";
import { useState } from "react";
import {
  confirmEmbeddingHost,
  enableEmbeddingRemote,
  fetchEmbeddingModels,
  testEmbeddingRemote,
  type EmbeddingProbeResult,
  type EmbeddingRemoteConfig,
  type EmbeddingStatus,
} from "../../api/settings";
import { t } from "../../i18n";
import {
  embeddingEndpointAddress,
  embeddingEndpointHost,
  embeddingHostOf,
} from "./embeddingHelpers";
import type { EmbeddingActionId } from "./useEmbeddingActionRunner";

interface Params {
  status: EmbeddingStatus | null;
  run: (
    id: EmbeddingActionId,
    action: () => Promise<unknown>,
    success?: string,
  ) => Promise<boolean>;
  setBusy: (id: EmbeddingActionId | null) => void;
  setActionError: (message: string) => void;
}

export function useEmbeddingRemoteActions({ status, run, setBusy, setActionError }: Params) {
  const { message } = App.useApp();
  const [probe, setProbe] = useState<EmbeddingProbeResult | null>(null);
  const [models, setModels] = useState<string[]>([]);
  /** 待隐私确认的远端配置；非 null 时弹 Modal。 */
  const [pendingEnable, setPendingEnable] = useState<EmbeddingRemoteConfig | null>(null);

  const testRemote = async (config: EmbeddingRemoteConfig) => {
    setBusy("test");
    setProbe(null);
    setActionError("");
    try {
      setProbe(await testEmbeddingRemote(config));
    } catch (error) {
      // 传输层失败（断网/超时）与"探测结果为 ok:false"都归成同一份可读原因。
      setProbe({
        ok: false,
        dim: 0,
        elapsed_ms: 0,
        model: config.model,
        error: error instanceof Error ? error.message : t("embeddingSearch.remote.testFailed"),
      });
    } finally {
      setBusy(null);
    }
  };

  const fetchModels = async (config: EmbeddingRemoteConfig) => {
    setBusy("fetchModels");
    setActionError("");
    try {
      const result = await fetchEmbeddingModels(config);
      const next = result.models ?? [];
      setModels(next);
      if (next.length > 0) {
        message.success(t("embeddingSearch.remote.fetched", { count: next.length }));
      } else {
        message.warning(t("embeddingSearch.remote.fetchedEmpty"));
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t("embeddingSearch.guidance.retry"));
      message.error(t("embeddingSearch.remote.fetchFailed"));
    } finally {
      setBusy(null);
    }
  };

  /** 表单校验：失败时把原因放进卡片内 Alert（不用 Toast 一闪而过）。 */
  const validateRemote = (config: EmbeddingRemoteConfig): string => {
    if (!embeddingHostOf(embeddingEndpointAddress(config))) {
      return t("embeddingSearch.remote.validation.baseUrl");
    }
    if (!config.model.trim()) return t("embeddingSearch.remote.validation.model");
    if (!config.api_key.trim() && !status?.remote.configured) {
      return t("embeddingSearch.remote.validation.key");
    }
    return "";
  };

  const enableRemote = async (config: EmbeddingRemoteConfig) => {
    await run("enable", () => enableEmbeddingRemote(config), t("embeddingSearch.remote.enabled"));
  };

  /**
   * 「启用远程检索」：先校验，再按 host 决定直接启用还是弹一次隐私确认。
   * 确认状态按 host 记，换 host 会再弹一次（任务书 §4.5）。
   */
  const requestEnable = async (config: EmbeddingRemoteConfig) => {
    const problem = validateRemote(config);
    if (problem) {
      setActionError(problem);
      return;
    }
    const host = embeddingEndpointHost(config);
    const confirmed = status?.remote.confirmed_hosts ?? [];
    if (confirmed.includes(host)) {
      await enableRemote(config);
      return;
    }
    setActionError("");
    setPendingEnable(config);
  };

  const cancelEnable = () => {
    setPendingEnable(null);
  };

  const confirmEnable = async () => {
    if (!pendingEnable) return;
    const config = pendingEnable;
    setPendingEnable(null);
    await run(
      "enable",
      async () => {
        await confirmEmbeddingHost(embeddingEndpointAddress(config));
        await enableEmbeddingRemote(config);
      },
      t("embeddingSearch.remote.enabled"),
    );
  };

  return {
    probe,
    models,
    pendingEnable,
    testRemote,
    fetchModels,
    requestEnable,
    cancelEnable,
    confirmEnable,
    clearProbe: () => setProbe(null),
  };
}
