// SPDX-License-Identifier: Apache-2.0
/**
 * 「语义检索」的远程动作：草稿测试连接、拉模型列表、按 host 的隐私确认与激活。
 *
 * 与第 1 条之前相比的关键变化：激活不再是「拿一份整段配置去新建」，而是
 * `POST /profiles/{id}/activate`（切换 = 激活另一条）。草稿里的空 key 只借**该条**
 * 已存 key，绝不跨 profile 继承（安全红线）。
 */
import { App } from "antd";
import { useState } from "react";
import {
  activateEmbeddingProfile,
  confirmEmbeddingHost,
  fetchEmbeddingModels,
  testEmbeddingProfile,
  testEmbeddingRemote,
  type EmbeddingProbeResult,
  type EmbeddingProfile,
  type EmbeddingRemoteConfig,
  type EmbeddingStatus,
} from "../../api/settings";
import { t } from "../../i18n";
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
  /** 待隐私确认的配置；非 null 时弹 Modal。 */
  const [pendingProfile, setPendingProfile] = useState<EmbeddingProfile | null>(null);

  /**
   * 草稿「测试连接」：编辑态用该条已存 key（后端只借这一条）；新建态必须显式填 key。
   * 新建态不借当前生效配置的 key —— 那会把另一家的密钥发到草稿地址上。
   */
  const testDraft = async (draft: EmbeddingRemoteConfig, profileId?: string) => {
    if (!profileId && !draft.api_key.trim()) {
      setProbe({
        ok: false,
        dim: 0,
        elapsed_ms: 0,
        model: draft.model,
        error: t("embeddingSearch.remote.validation.key"),
      });
      return;
    }
    setBusy("test");
    setProbe(null);
    setActionError("");
    try {
      setProbe(
        profileId ? await testEmbeddingProfile(profileId, draft) : await testEmbeddingRemote(draft),
      );
    } catch (error) {
      setProbe({
        ok: false,
        dim: 0,
        elapsed_ms: 0,
        model: draft.model,
        error: error instanceof Error ? error.message : t("embeddingSearch.remote.testFailed"),
      });
    } finally {
      setBusy(null);
    }
  };

  const fetchModels = async (draft: EmbeddingRemoteConfig, profileId?: string) => {
    setBusy("fetchModels");
    setActionError("");
    try {
      // 编辑态带上 profile_id：只借这一条的已存 key。
      const result = await fetchEmbeddingModels({
        ...draft,
        profile_id: profileId ?? "",
      } as EmbeddingRemoteConfig & {
        profile_id: string;
      });
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

  const activate = async (profile: EmbeddingProfile) => {
    await run(
      "activate",
      () => activateEmbeddingProfile(profile.id),
      t("embeddingSearch.remote.profile.applied"),
    );
  };

  /** 点「使用」：host 已确认就直接激活，否则先弹一次隐私确认（按 host 记）。 */
  const requestActivate = async (profile: EmbeddingProfile) => {
    if (!profile.key_configured) {
      setActionError(t("embeddingSearch.remote.profile.noKey"));
      return;
    }
    setActionError("");
    const confirmed = status?.remote.confirmed_hosts ?? [];
    if (profile.host && confirmed.includes(profile.host)) {
      await activate(profile);
      return;
    }
    setPendingProfile(profile);
  };

  const cancelActivate = () => setPendingProfile(null);

  const confirmActivate = async () => {
    if (!pendingProfile) return;
    const profile = pendingProfile;
    setPendingProfile(null);
    await run(
      "activate",
      async () => {
        await confirmEmbeddingHost(profile.host);
        await activateEmbeddingProfile(profile.id);
      },
      t("embeddingSearch.remote.profile.applied"),
    );
  };

  return {
    probe,
    models,
    pendingProfile,
    testDraft,
    fetchModels,
    requestActivate,
    cancelActivate,
    confirmActivate,
    clearProbe: () => setProbe(null),
  };
}
