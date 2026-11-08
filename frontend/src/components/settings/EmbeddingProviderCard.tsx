// SPDX-License-Identifier: Apache-2.0
/**
 * 设置页「语义检索」卡（RAG v3）：本地模型 / 远程服务二选一。
 *
 * 状态机严格按 GET /api/settings/embedding/status（契约 §3）渲染，本组件不保存
 * "是否已启用"这类状态——一切以 status 为准，失败态永远不会显示为已启用。
 *
 * 三块内容：
 * - 未就绪：先二选一，再渲染对应配置块（本地下载 / 远程表单）；
 * - 下载中：只显示进度与取消（不允许此时切模式，避免两个下载状态打架）；
 * - 已就绪：只显示生效信息与关闭/清理出口。
 * 已确认 host 清单常驻（与是否就绪无关），可在未就绪时撤销历史确认。
 */
import { Alert, Card, Flex, Segmented, Typography } from "antd";
import { useState } from "react";
import type { EmbeddingStatus } from "../../api/settings";
import {
  embeddingEndpointHost,
  embeddingGuidanceKey,
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
  const effectiveMode = mode ?? defaultMode(status);

  const downloading =
    status !== null &&
    (status.state === "downloading" || LOCAL_BUSY_STATES.includes(status.local.state));
  const ready = status?.state === "ready";
  const failureReason = status
    ? status.last_error || status.local.error || status.remote.error
    : "";
  const localProvider = status?.provider !== "openai-http";

  return (
    <Card title={t("embeddingSearch.title")} className="settings-card">
      <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
        {t("embeddingSearch.intro")}
      </Typography.Paragraph>

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
                onDisable={() => void settings.disable()}
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
                        <Typography.Text type="secondary">
                          {t(embeddingGuidanceKey(failureReason))}
                        </Typography.Text>
                        <div>
                          <Typography.Text type="secondary">
                            {t("embeddingSearch.local.failedFallback")}
                          </Typography.Text>
                        </div>
                      </>
                    }
                  />
                ) : null}
                <div>
                  <Typography.Text strong>{t("embeddingSearch.mode.label")}</Typography.Text>
                  <Segmented
                    style={{ marginTop: 4 }}
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
                  <Typography.Paragraph type="secondary" style={{ margin: "4px 0 0" }}>
                    {t("embeddingSearch.mode.hint")}
                  </Typography.Paragraph>
                </div>

                {effectiveMode === "local" ? (
                  <EmbeddingLocalBlock
                    local={status.local}
                    busy={busy}
                    reason={failureReason}
                    onDownload={() => void settings.startDownload()}
                    onCancel={() => void settings.cancelDownload()}
                    onRetry={() => void settings.retryDownload()}
                    onEnable={() => void settings.enableLocal()}
                    onRemove={() => void settings.removeAssets()}
                  />
                ) : (
                  <EmbeddingRemoteBlock
                    remote={status.remote}
                    savedConfig={status.config ?? null}
                    busy={busy}
                    probe={probe}
                    models={models}
                    onTest={(config) => void settings.testRemote(config)}
                    onFetchModels={(config) => void settings.fetchModels(config)}
                    onEnable={(config) => void settings.requestEnable(config)}
                    onClearProbe={settings.clearProbe}
                  />
                )}
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
                onEnable={() => void settings.enableLocal()}
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
