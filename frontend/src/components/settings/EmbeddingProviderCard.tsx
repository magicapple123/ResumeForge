// SPDX-License-Identifier: Apache-2.0
/**
 * 设置页「语义检索」卡：本地模型 / 远程命名配置（清单第 1/16 条）。
 *
 * 状态机严格按 GET /api/settings/embedding/status（契约 §3）渲染：一切以 status 为准，
 * 失败态永远不会显示为已启用。本组件只做编排：
 *
 * - 卡头 extra：已就绪 →「关闭语义检索」；本地未就绪 →「启用本地模型」；
 *   远程未就绪不放进线按钮（主操作在列表的「新建配置」上，避免两个同义主动作）。
 * - 已就绪 → `EmbeddingReadyPanel` 显示当前 provider，并提供**一键切换**（第 16 条）；
 * - 未就绪 → 本地/远程二选一：本地是下载流程，远程是「新建配置 + 已保存列表」；
 * - 远程命名配置的增删改在弹窗里，测试结果逐条留在卡片内。
 *
 * 远程草稿不再常驻卡片这一层：草稿只属于「新建/编辑配置」弹窗，由 `useEmbeddingProfiles`
 * 持有；启用/切换走 `POST /profiles/{id}/activate`，不再"新建整段配置"。
 */
import { Alert, Button, Card, Divider, Flex, Segmented, Tooltip, Typography } from "antd";
import { useState } from "react";
import { activateEmbeddingProfile, type EmbeddingStatus } from "../../api/settings";
import { embeddingGuidanceKey } from "../../features/settings/embeddingHelpers";
import { useEmbeddingSettings } from "../../features/settings/useEmbeddingSettings";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import ErrorState from "../common/ErrorState";
import LoadingBlock from "../common/LoadingBlock";
import EmbeddingConfirmedHosts from "./EmbeddingConfirmedHosts";
import EmbeddingLocalBlock from "./EmbeddingLocalBlock";
import EmbeddingPrivacyModal from "./EmbeddingPrivacyModal";
import EmbeddingProfileList from "./EmbeddingProfileList";
import EmbeddingProfileModal from "./EmbeddingProfileModal";
import EmbeddingReadyPanel from "./EmbeddingReadyPanel";
import SettingsField from "./SettingsField";

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
  const { status, loading, loadError, busy, actionError } = settings;
  const [mode, setMode] = useState<Mode | null>(null);
  const effectiveMode = mode ?? defaultMode(status);

  const downloading =
    status !== null &&
    (status.state === "downloading" || LOCAL_BUSY_STATES.includes(status.local.state));
  const ready = status?.state === "ready";
  const failureReason = status
    ? status.last_error || status.local.error || status.remote.error
    : "";
  const localProvider = status?.provider !== "openai-http";
  const profiles = settings.profiles;
  const remoteReady = Boolean(ready && status?.provider === "openai-http");
  /** 可切换的远程配置：有密钥的（没 key 激活会被后端拒绝）。 */
  const remoteCandidates = profiles.filter((item) => item.key_configured);

  const runActivation = async (action: () => Promise<unknown>) => {
    await settings.run("activate", action, t("embeddingSearch.remote.profile.applied"));
  };

  /** 第 16 条：切到本地 = 激活本地 profile；本地还没下载则先下载（不自动切）。 */
  const switchToLocal = () => {
    if (!status) return;
    const localId = status.local_profile_id;
    if (status.local.state === "ready" && localId) {
      void runActivation(() => activateEmbeddingProfile(localId));
      return;
    }
    if (status.local.state === "ready") {
      // 兜底：资源就绪但还没生成本地 profile（旧数据/清单缺 dim）→ 走原有启用流程同步。
      void settings.enableLocal();
      return;
    }
    void settings.run("download", () => settings.startDownload({ autoEnable: false }));
  };

  const canEnableLocal = status?.local.state === "ready";
  const primaryAction = ready ? (
    <Button loading={busy === "disable"} onClick={() => void settings.disable()}>
      {t("embeddingSearch.remote.disable")}
    </Button>
  ) : !downloading && effectiveMode === "local" ? (
    <Tooltip title={canEnableLocal ? undefined : t("embeddingSearch.card.enableHint.local")}>
      {/* A disabled button emits no mouse events, so the Tooltip needs a hoverable wrapper. */}
      <span>
        <Button
          type="primary"
          loading={busy === "enableLocal"}
          disabled={!canEnableLocal || busy !== null || undefined}
          onClick={() => void settings.enableLocal()}
        >
          {t("embeddingSearch.local.enable")}
        </Button>
      </span>
    </Tooltip>
  ) : undefined;

  return (
    <Card
      title={t("embeddingSearch.title")}
      className="settings-card"
      extra={status ? primaryAction : undefined}
    >
      {/* 已启用态不再解释"语义检索是什么"——那是首次配置才需要的一句话，
          启用后重复出现只是把真正要看的状态挤下去（清单 §3.2 第 1 条）。 */}
      {ready ? null : (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          title={t("embeddingSearch.intro")}
        />
      )}

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
          <Flex vertical gap={8}>
            {ready ? (
              <>
                <EmbeddingReadyPanel
                  status={status}
                  busy={busy}
                  remoteCandidates={remoteCandidates}
                  onSwitchToLocal={switchToLocal}
                  onDownloadLocal={() =>
                    void settings.run("download", () =>
                      settings.startDownload({ autoEnable: false }),
                    )
                  }
                  onSwitchToRemote={(profile) => void settings.requestActivate(profile)}
                  onRemoveAssets={() => void settings.removeAssets()}
                />
                {/* 1px 分隔线：三块内容之间只有 12px 空白时读起来像一整段（清单 §3.2 第 7 条）。 */}
                <Divider style={{ margin: 0 }} />
              </>
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

            {!downloading ? (
              <EmbeddingProfileList
                profiles={profiles}
                activeProfileId={status.active_profile_id}
                activeProfileUpdatedAt={status.active_profile_updated_at}
                remoteReady={remoteReady}
                busy={busy}
                testingId={settings.testingId}
                testResults={settings.testResults}
                onCreate={settings.openCreate}
                onUse={(profile) => void settings.requestActivate(profile)}
                onTest={(profile) => void settings.testProfile(profile)}
                onEdit={settings.openEdit}
                onDuplicate={settings.duplicate}
                onClearKey={settings.clearKey}
                onDelete={settings.remove}
              />
            ) : null}

            {/* 地址白名单是安全设置，与配置列表分开读；没有已确认地址时整块不渲染，
                这里也就不要留一条悬空的分隔线。 */}
            {(status.remote.confirmed_hosts ?? []).length > 0 ? (
              <Divider style={{ margin: 0 }} />
            ) : null}
            <EmbeddingConfirmedHosts
              hosts={status.remote.confirmed_hosts ?? []}
              activeHost={remoteReady ? status.remote.host : ""}
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

      <EmbeddingProfileModal
        open={settings.modalOpen}
        editing={settings.editing}
        name={settings.name}
        draft={settings.draft}
        presetId={settings.presetId}
        busy={busy}
        saving={settings.saving}
        probe={settings.modalOpen ? settings.probe : null}
        models={settings.models}
        error={settings.modalError}
        onNameChange={settings.setName}
        onPatchDraft={settings.patchDraft}
        onSelectPreset={settings.selectPreset}
        onTest={() => void settings.testDraft(settings.draft, settings.editing?.id)}
        onFetchModels={() => void settings.fetchModels(settings.draft, settings.editing?.id)}
        onSave={() => void settings.save()}
        onClose={settings.closeModal}
      />

      <EmbeddingPrivacyModal
        open={settings.pendingProfile !== null}
        host={settings.pendingProfile?.host ?? ""}
        busy={busy === "activate"}
        onConfirm={() => void settings.confirmActivate()}
        onCancel={settings.cancelActivate}
      />
    </Card>
  );
}
