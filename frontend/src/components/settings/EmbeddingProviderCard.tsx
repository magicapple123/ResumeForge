// SPDX-License-Identifier: Apache-2.0
/**
 * 设置页「语义检索」卡（RAG v3）：本地模型 / 远程服务二选一。
 *
 * 状态机严格按 GET /api/settings/embedding/status（契约 §3）渲染，本组件不保存
 * "是否已启用"这类状态——一切以 status 为准，失败态永远不会显示为已启用。
 *
 * ## 统一口径（条目 02，基准是「大模型 API 配置」卡）
 *
 * - 卡头：`title` + `extra` 放**唯一主操作**（未就绪 = 启用，已就绪 = 关闭）；
 * - 说明：`Alert type="info"` 一句话，替换原来的灰色 `Paragraph`；
 * - 字段：统一走 `SettingsField`（标签 + 控件 + 一行提示）；
 * - 状态：`Tag`（`blue` = 生效中、`green` = 已配置、默认 = 未配置），见厂商卡片；
 * - 加载/错误：`LoadingBlock` + `ErrorState`（不套 LLM 的 `EmptyState`，那是列表空态）。
 *
 * ## 三块内容
 *
 * - 未就绪：先二选一，再渲染对应配置块（本地下载 / 远程厂商卡片 + 字段）；
 * - 下载中：只显示进度与取消（不允许此时切模式，避免两个下载状态打架）；
 * - 已就绪：只显示生效信息与「···」里的清理入口。
 * 已确认 host 清单常驻（与是否就绪无关），可在未就绪时撤销历史确认。
 *
 * ## 远程草稿为什么在卡片这一层
 *
 * 卡头的「启用」要用当前草稿（地址/模型/密钥）发起启用；草稿若留在远程块里，卡头就得
 * 再复制一份状态。所以 `draft` / `presetId` 提升到这里，远程块只做受控渲染。
 */
import { Alert, Button, Card, Flex, Segmented, Tooltip, Typography } from "antd";
import { useState } from "react";
import type { EmbeddingRemoteConfig, EmbeddingStatus } from "../../api/settings";
import {
  embeddingEndpointHost,
  embeddingGuidanceKey,
  emptyRemoteConfig,
  remoteConfigFromStatus,
} from "../../features/settings/embeddingHelpers";
import { useEmbeddingSettings } from "../../features/settings/useEmbeddingSettings";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import ErrorState from "../common/ErrorState";
import LoadingBlock from "../common/LoadingBlock";
import EmbeddingConfirmedHosts from "./EmbeddingConfirmedHosts";
import EmbeddingLocalBlock from "./EmbeddingLocalBlock";
import EmbeddingPrivacyModal from "./EmbeddingPrivacyModal";
import EmbeddingReadyPanel from "./EmbeddingReadyPanel";
import EmbeddingRemoteBlock from "./EmbeddingRemoteBlock";
import SettingsField from "./SettingsField";
import { CUSTOM_PRESET_ID, EMBEDDING_REMOTE_PRESETS, presetOf } from "./embeddingRemotePresets";

type Mode = "local" | "remote";

const LOCAL_BUSY_STATES: readonly EmbeddingStatus["local"]["state"][] = [
  "downloading",
  "verifying",
  "extracting",
];

/** 没选过模式时的默认：已配置的 provider 优先；否则本地可用就本地（数据不出本机）。 */
function defaultMode(status: EmbeddingStatus | null): Mode {
  if (!status) return "local";
  if (status.provider === "openai-http") return "remote";
  if (status.provider === "local-onnx") return "local";
  return status.local.supported ? "local" : "remote";
}

export default function EmbeddingProviderCard() {
  useLocale();
  const settings = useEmbeddingSettings();
  const { status, loading, loadError, busy, actionError, probe, models } = settings;
  const [mode, setMode] = useState<Mode | null>(null);
  const [draft, setDraft] = useState<EmbeddingRemoteConfig | null>(null);
  const [presetId, setPresetId] = useState<string | null>(null);
  const effectiveMode = mode ?? defaultMode(status);

  // 草稿的初值来自 /status（含掩码配置）：status 未到时为 null，此时不渲染字段区。
  const effectiveDraft =
    draft ?? (status ? remoteConfigFromStatus(status.remote, status.config ?? null) : null);
  const effectivePresetId =
    presetId ??
    (effectiveDraft
      ? (presetOf(effectiveDraft.base_url)?.id ?? CUSTOM_PRESET_ID)
      : CUSTOM_PRESET_ID);

  const downloading =
    status !== null &&
    (status.state === "downloading" || LOCAL_BUSY_STATES.includes(status.local.state));
  const ready = status?.state === "ready";
  const failureReason = status
    ? status.last_error || status.local.error || status.remote.error
    : "";
  const localProvider = status?.provider !== "openai-http";

  const patchDraft = (changes: Partial<EmbeddingRemoteConfig>) => {
    setDraft({ ...(effectiveDraft ?? emptyRemoteConfig()), ...changes });
    // 改了字段之后旧的连接测试结论就不作数了，别让"连接成功"停在错的地址旁边。
    settings.clearProbe();
  };

  const selectPreset = (id: string) => {
    setPresetId(id);
    settings.clearProbe();
    if (id === CUSTOM_PRESET_ID) return;
    const preset = EMBEDDING_REMOTE_PRESETS.find((item) => item.id === id);
    if (!preset) return;
    setDraft({
      ...(effectiveDraft ?? emptyRemoteConfig()),
      base_url: preset.baseUrl,
      model: preset.models[0] ?? effectiveDraft?.model ?? "",
      allow_private: preset.allowPrivate,
      endpoint_mode: "openai",
    });
  };

  /** 卡头「启用」是否可点：远程要有地址+模型（密钥可沿用已存的那份），本地要已下载。 */
  const canEnable =
    effectiveMode === "remote"
      ? Boolean(effectiveDraft?.base_url.trim()) &&
        Boolean(effectiveDraft?.model.trim()) &&
        (Boolean(effectiveDraft?.api_key.trim()) || Boolean(status?.remote.configured))
      : status?.local.state === "ready";

  const enableHint = downloading
    ? t("embeddingSearch.state.downloading")
    : effectiveMode === "remote"
      ? t("embeddingSearch.card.enableHint.remote")
      : t("embeddingSearch.card.enableHint.local");

  const enable = () => {
    if (effectiveMode === "remote") {
      if (effectiveDraft) void settings.requestEnable(effectiveDraft);
      return;
    }
    void settings.enableLocal();
  };

  const primaryAction = ready ? (
    <Button loading={busy === "disable"} onClick={() => void settings.disable()}>
      {t("embeddingSearch.remote.disable")}
    </Button>
  ) : (
    <Tooltip title={canEnable ? undefined : enableHint}>
      {/* A disabled button emits no mouse events, so the Tooltip needs a hoverable wrapper. */}
      <span>
        <Button
          type="primary"
          loading={busy === "enable" || busy === "enableLocal"}
          disabled={!canEnable || busy !== null || undefined}
          onClick={enable}
        >
          {effectiveMode === "remote"
            ? t("embeddingSearch.remote.enable")
            : t("embeddingSearch.local.enable")}
        </Button>
      </span>
    </Tooltip>
  );

  return (
    <Card
      title={t("embeddingSearch.title")}
      className="settings-card"
      extra={status ? primaryAction : undefined}
    >
      <Alert type="info" showIcon style={{ marginBottom: 16 }} title={t("embeddingSearch.intro")} />

      <LoadingBlock spinning={loading}>
        {status === null ? (
          loadError ? (
            <ErrorState
              description={loadError}
              onRetry={() => void settings.reload()}
              retryLabel={t("embeddingSearch.retry")}
            />
          ) : (
            <div />
          )
        ) : (
          <Flex vertical gap={16}>
            {ready ? (
              <EmbeddingReadyPanel
                status={status}
                busy={busy}
                onClearKey={() => void settings.clearKey()}
                onRemoveAssets={() => void settings.removeAssets()}
              />
            ) : null}

            {!ready && !downloading ? (
              <>
                {status.state === "failed" &&
                failureReason &&
                effectiveMode === "remote" &&
                !actionError ? (
                  <Alert
                    type="error"
                    showIcon
                    title={
                      localProvider
                        ? t("embeddingSearch.local.failedTitle")
                        : t("embeddingSearch.remote.testFailed")
                    }
                    description={
                      <>
                        <div>{failureReason}</div>
                        <div>
                          <Typography.Text type="secondary">
                            {t(embeddingGuidanceKey(failureReason))}
                          </Typography.Text>
                        </div>
                        <div>
                          <Typography.Text type="secondary">
                            {t("embeddingSearch.local.failedFallback")}
                          </Typography.Text>
                        </div>
                      </>
                    }
                  />
                ) : null}

                <SettingsField
                  label={t("embeddingSearch.mode.label")}
                  hint={t("embeddingSearch.mode.hint")}
                >
                  <Segmented
                    value={effectiveMode}
                    onChange={(value) => {
                      setMode(value as Mode);
                      settings.clearProbe();
                      settings.clearActionError();
                    }}
                    options={[
                      { value: "local", label: t("embeddingSearch.mode.local") },
                      { value: "remote", label: t("embeddingSearch.mode.remote") },
                    ]}
                  />
                </SettingsField>

                {effectiveMode === "local" ? (
                  <EmbeddingLocalBlock
                    local={status.local}
                    busy={busy}
                    reason={failureReason}
                    onDownload={() => void settings.startDownload()}
                    onCancel={() => void settings.cancelDownload()}
                    onRetry={() => void settings.retryDownload()}
                    onRemove={() => void settings.removeAssets()}
                  />
                ) : effectiveDraft ? (
                  <EmbeddingRemoteBlock
                    remote={status.remote}
                    savedConfig={status.config ?? null}
                    busy={busy}
                    probe={probe}
                    models={models}
                    draft={effectiveDraft}
                    presetId={effectivePresetId}
                    onPatch={patchDraft}
                    onSelectPreset={selectPreset}
                    onTest={(config) => void settings.testRemote(config)}
                    onFetchModels={(config) => void settings.fetchModels(config)}
                  />
                ) : null}
              </>
            ) : null}

            {!ready && downloading ? (
              <EmbeddingLocalBlock
                local={status.local}
                busy={busy}
                reason={failureReason}
                onDownload={() => void settings.startDownload()}
                onCancel={() => void settings.cancelDownload()}
                onRetry={() => void settings.retryDownload()}
                onRemove={() => void settings.removeAssets()}
              />
            ) : null}

            <EmbeddingConfirmedHosts
              hosts={status.remote.confirmed_hosts ?? []}
              activeHost={
                status.state === "ready" && status.remote.enabled ? status.remote.host : ""
              }
              busy={busy}
              onRevoke={(host) => void settings.revokeHost(host)}
            />

            {actionError ? (
              <Alert
                type="error"
                showIcon
                title={t("embeddingSearch.state.off")}
                description={actionError}
              />
            ) : null}
          </Flex>
        )}
      </LoadingBlock>

      <EmbeddingPrivacyModal
        open={settings.pendingEnable !== null}
        host={settings.pendingEnable ? embeddingEndpointHost(settings.pendingEnable) : ""}
        busy={busy === "enable"}
        onConfirm={() => void settings.confirmEnable()}
        onCancel={settings.cancelEnable}
      />
    </Card>
  );
}
