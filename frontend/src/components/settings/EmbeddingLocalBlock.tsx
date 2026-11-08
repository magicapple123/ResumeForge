// SPDX-License-Identifier: Apache-2.0
/**
 * 本地模型块（RAG v3）：未下载 / 下载中 / 校验 / 解包 / 失败 / 已下载未启用。
 *
 * Intel Mac（local.supported=false）**不渲染下载按钮**：1.24 之后没有任何 macOS x86_64
 * 的 onnxruntime wheel，点了只会拿到 404 或解包失败（任务书 §3.1），所以这里直接
 * 说明「该架构不支持本地模型，请使用远程」。
 */
import { Alert, Button, Flex, Popconfirm, Progress, Typography } from "antd";
import type { EmbeddingLocalStatus } from "../../api/settings";
import { embeddingProgressPercent } from "../../api/settings";
import { embeddingGuidanceKey } from "../../features/settings/embeddingHelpers";
import type { EmbeddingActionId } from "../../features/settings/useEmbeddingSettings";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import ErrorState from "../common/ErrorState";

interface Props {
  local: EmbeddingLocalStatus;
  busy: EmbeddingActionId | null;
  /** 失败原因（后端 detail 原样透传）。 */
  reason: string;
  onDownload: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onEnable: () => void;
  onRemove: () => void;
}

export default function EmbeddingLocalBlock({
  local,
  busy,
  reason,
  onDownload,
  onCancel,
  onRetry,
  onEnable,
  onRemove,
}: Props) {
  useLocale();

  if (!local.supported) {
    return (
      <Alert
        type="warning"
        showIcon
        title={t("embeddingSearch.state.unsupported")}
        description={t("embeddingSearch.local.unsupportedHint")}
      />
    );
  }

  if (
    local.state === "downloading" ||
    local.state === "verifying" ||
    local.state === "extracting"
  ) {
    const percent = embeddingProgressPercent(local.progress);
    const stateLabel =
      local.state === "verifying"
        ? t("embeddingSearch.local.verifying")
        : local.state === "extracting"
          ? t("embeddingSearch.local.extracting")
          : t("embeddingSearch.state.downloading");
    return (
      <Flex vertical gap={12}>
        <Typography.Text strong>{stateLabel}</Typography.Text>
        <Progress
          percent={percent}
          format={(value) => t("embeddingSearch.local.progress", { percent: value ?? percent })}
        />
        <Flex gap={8} wrap>
          <Button loading={busy === "cancel"} onClick={onCancel}>
            {t("embeddingSearch.local.cancel")}
          </Button>
        </Flex>
      </Flex>
    );
  }

  if (local.state === "failed") {
    return (
      <ErrorState
        description={
          <>
            {reason ? <div>{reason}</div> : null}
            <Typography.Text type="secondary">{t(embeddingGuidanceKey(reason))}</Typography.Text>
            <div>
              <Typography.Text type="secondary">
                {t("embeddingSearch.local.failedFallback")}
              </Typography.Text>
            </div>
          </>
        }
        onRetry={onRetry}
        retrying={busy === "download"}
        retryLabel={t("embeddingSearch.local.retry")}
      />
    );
  }

  // 下载完成但配置还没启用：单独给一次「启用本地模型」（下载与启用是两段式）。
  if (local.state === "ready") {
    return (
      <Flex vertical gap={12}>
        <Typography.Text strong>{t("embeddingSearch.local.readyHint")}</Typography.Text>
        <Flex gap={8} wrap>
          <Button type="primary" loading={busy === "enableLocal"} onClick={onEnable}>
            {t("embeddingSearch.local.enable")}
          </Button>
          <Popconfirm
            title={t("embeddingSearch.local.removeTitle")}
            description={t("embeddingSearch.local.removeConfirm")}
            okText={t("embeddingSearch.local.remove")}
            cancelText={t("common.action.cancel")}
            okButtonProps={{ danger: true }}
            onConfirm={onRemove}
          >
            <Button danger>{t("embeddingSearch.local.remove")}</Button>
          </Popconfirm>
        </Flex>
      </Flex>
    );
  }

  // 未下载：体积以 GET /status 的 download_bytes 为准（A 的 Windows 实测约 111 MB）。
  // 用十进制 MB 与任务书/文档口径一致；formatBytes 走二进制口径会显示成约 106 MB。
  const megabytes = Math.max(1, Math.round((local.download_bytes || 0) / 1_000_000));
  return (
    <Flex vertical gap={12}>
      <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
        {t("embeddingSearch.local.sizeHint", { megabytes })}
      </Typography.Paragraph>
      <Flex gap={8} wrap align="center">
        <Button type="primary" loading={busy === "download"} onClick={onDownload}>
          {t("embeddingSearch.local.download")}
        </Button>
        {local.platform ? (
          <Typography.Text type="secondary">
            {t("embeddingSearch.local.platform", { platform: local.platform })}
          </Typography.Text>
        ) : null}
      </Flex>
    </Flex>
  );
}
