// SPDX-License-Identifier: Apache-2.0
/**
 * 「语义检索」命名配置列表的状态编排（清单第 1 条）：新建/编辑弹窗、保存、删除、
 * 复制、清除密钥、卡片级「测试连接」。
 *
 * 真相源仍是 GET /status（profiles 与 active_profile_id 都由它下发）；本 hook 只保存
 * 弹窗草稿与逐条测试结果，不维护第二份「哪条生效」。
 */
import { App } from "antd";
import { useState } from "react";
import {
  clearEmbeddingProfileKey,
  deleteEmbeddingProfile,
  saveEmbeddingProfile,
  testEmbeddingProfile,
  type EmbeddingProbeResult,
  type EmbeddingProfile,
  type EmbeddingRemoteConfig,
  type EmbeddingStatus,
} from "../../api/settings";
import { formatErrorGuidance } from "../../api/errorGuidance";
import { t } from "../../i18n";
import { emptyRemoteConfig, profileConfigFromProfile } from "./embeddingHelpers";
import type { EmbeddingActionId } from "./useEmbeddingActionRunner";
import {
  CUSTOM_PRESET_ID,
  EMBEDDING_REMOTE_PRESETS,
} from "../../components/settings/embeddingRemotePresets";

interface Params {
  status: EmbeddingStatus | null;
  run: (
    id: EmbeddingActionId,
    action: () => Promise<unknown>,
    success?: string,
  ) => Promise<boolean>;
  setBusy: (id: EmbeddingActionId | null) => void;
  refresh: () => Promise<EmbeddingStatus | null>;
}

const MAX_PROFILES = 20;

export function useEmbeddingProfiles({ status, run, setBusy, refresh }: Params) {
  const { modal } = App.useApp();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<EmbeddingProfile | null>(null);
  const [name, setName] = useState("");
  const [draft, setDraft] = useState<EmbeddingRemoteConfig>(emptyRemoteConfig());
  const [presetId, setPresetId] = useState(CUSTOM_PRESET_ID);
  const [modalError, setModalError] = useState("");
  const [saving, setSaving] = useState(false);
  /** 卡片级「测试连接」的逐条结果与正在测试的 id（错误逐条归属）。 */
  const [testResults, setTestResults] = useState<Record<string, EmbeddingProbeResult>>({});
  const [testingId, setTestingId] = useState<string | null>(null);

  const profiles = status?.profiles ?? [];

  const resetDraft = () => {
    setEditing(null);
    setName("");
    setDraft(emptyRemoteConfig());
    setPresetId(CUSTOM_PRESET_ID);
    setModalError("");
  };

  const openCreate = () => {
    resetDraft();
    setModalOpen(true);
  };

  const openEdit = (profile: EmbeddingProfile) => {
    setEditing(profile);
    setName(profile.name);
    setDraft(profileConfigFromProfile(profile));
    setPresetId(profile.preset_id || CUSTOM_PRESET_ID);
    setModalError("");
    setModalOpen(true);
  };

  /**
   * 「复制」：另存一条同地址/同模型的配置，**不带密钥**（前端读不到密钥，也不该读）。
   * 名称为「原名 副本」，用户可改；保存后仍需填 key 才能激活。
   */
  const duplicate = (profile: EmbeddingProfile) => {
    resetDraft();
    setName(`${profile.name} ${t("embeddingSearch.remote.profile.copySuffix")}`.slice(0, 64));
    setDraft(profileConfigFromProfile(profile));
    setPresetId(profile.preset_id || CUSTOM_PRESET_ID);
    setModalOpen(true);
  };

  const closeModal = () => setModalOpen(false);

  const patchDraft = (changes: Partial<EmbeddingRemoteConfig>) => {
    setDraft((previous) => ({ ...previous, ...changes }));
    setModalError("");
  };

  const selectPreset = (id: string) => {
    setPresetId(id);
    setModalError("");
    if (id === CUSTOM_PRESET_ID) return;
    const preset = EMBEDDING_REMOTE_PRESETS.find((item) => item.id === id);
    if (!preset) return;
    setDraft((previous) => ({
      ...previous,
      base_url: preset.baseUrl,
      model: preset.models[0] ?? previous.model,
      allow_private: preset.allowPrivate,
      endpoint_mode: "openai",
    }));
  };

  const validate = (): string => {
    const trimmed = name.trim();
    if (!trimmed) return t("embeddingSearch.remote.validation.nameRequired");
    if (trimmed.length > 64) return t("embeddingSearch.remote.validation.nameTooLong");
    if (!editing && profiles.length >= MAX_PROFILES) {
      return t("embeddingSearch.remote.validation.profileLimit");
    }
    const address = draft.endpoint_mode === "template" ? draft.request_url : draft.base_url;
    if (!address.trim()) return t("embeddingSearch.remote.validation.baseUrl");
    if (!draft.model.trim()) return t("embeddingSearch.remote.validation.model");
    return "";
  };

  const save = async () => {
    const problem = validate();
    if (problem) {
      setModalError(problem);
      return;
    }
    setSaving(true);
    setBusy("saveProfile");
    setModalError("");
    try {
      await saveEmbeddingProfile({
        ...(editing ? { id: editing.id } : {}),
        name: name.trim(),
        preset_id: presetId,
        config: { ...draft, provider: "openai-http" },
      });
      await refresh();
      setModalOpen(false);
    } catch (error) {
      setModalError(formatErrorGuidance(error, t("embeddingSearch.remote.profile.saveFailed")));
    } finally {
      setSaving(false);
      setBusy(null);
    }
  };

  const remove = (profile: EmbeddingProfile) => {
    modal.confirm({
      title: t("embeddingSearch.remote.profile.deleteTitle"),
      content: t("embeddingSearch.remote.profile.deleteBody"),
      okText: t("embeddingSearch.remote.profile.delete"),
      cancelText: t("common.action.cancel"),
      okButtonProps: { danger: true },
      onOk: () =>
        run(
          "deleteProfile",
          () => deleteEmbeddingProfile(profile.id),
          t("embeddingSearch.remote.profile.deleted"),
        ),
    });
  };

  const clearKey = (profile: EmbeddingProfile) => {
    modal.confirm({
      title: t("embeddingSearch.remote.clearTitle"),
      content: t("embeddingSearch.remote.clearConfirm"),
      okText: t("embeddingSearch.remote.clear"),
      cancelText: t("common.action.cancel"),
      okButtonProps: { danger: true },
      onOk: () =>
        run(
          "clearProfileKey",
          () => clearEmbeddingProfileKey(profile.id),
          t("embeddingSearch.remote.cleared"),
        ),
    });
  };

  /** 卡片「测试连接」：用这一条自己的 key 探测，结果留在该卡片内。 */
  const testProfile = async (profile: EmbeddingProfile) => {
    if (!profile.key_configured) {
      setTestResults((previous) => ({
        ...previous,
        [profile.id]: {
          ok: false,
          dim: 0,
          elapsed_ms: 0,
          model: profile.model,
          error: t("embeddingSearch.remote.validation.key"),
        },
      }));
      return;
    }
    setTestingId(profile.id);
    try {
      const result = await testEmbeddingProfile(profile.id);
      setTestResults((previous) => ({ ...previous, [profile.id]: result }));
    } catch (error) {
      setTestResults((previous) => ({
        ...previous,
        [profile.id]: {
          ok: false,
          dim: 0,
          elapsed_ms: 0,
          model: profile.model,
          error: error instanceof Error ? error.message : t("embeddingSearch.remote.testFailed"),
        },
      }));
    } finally {
      setTestingId(null);
    }
  };

  return {
    profiles,
    modalOpen,
    editing,
    name,
    draft,
    presetId,
    modalError,
    saving,
    testResults,
    testingId,
    setName,
    patchDraft,
    selectPreset,
    openCreate,
    openEdit,
    duplicate,
    closeModal,
    save,
    remove,
    clearKey,
    testProfile,
  };
}
