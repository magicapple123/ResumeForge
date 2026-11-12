// SPDX-License-Identifier: Apache-2.0
/**
 * 本地模型块（RAG v3）：未下载 / 下载中 / 校验 / 解包 / 失败 / 已下载未启用。
 *
 * Intel Mac（local.supported=false）**不渲染下载按钮**：1.24 之后没有任何 macOS x86_64
 * 的 onnxruntime wheel，点了只会拿到 404 或解包失败（任务书 §3.1），所以这里直接
 * 说明「该架构不支持本地模型，请使用远程」。
 *
 * ## 危险操作收进「···」（条目 08）
 *
 * 已下载未启用这个状态原先并排两颗按钮：「启用本地模型」（主操作）+「删除已下载文件」
 * （裸红按钮 + Popconfirm）。红色按钮紧贴主操作、误触成本高，改后：
 *
 * - 主操作只有卡头的「启用」（整张卡唯一主操作，见 `EmbeddingProviderCard`）；
 * - 「删除已下载文件」进「···」，二次确认复用 `useRowActionMenu`（与列表行同一套），
 *   不手写第三份 `modal.confirm`；
 * - `busy !== null` 时「···」禁用，与其它按钮的 disabled 口径一致。
 */
import { Alert, Button, Dropdown, Flex, Progress, Typography } from "antd";
import { MoreOutlined } from "@ant-design/icons";
import type { EmbeddingLocalStatus } from "../../api/settings";
import { embeddingProgressPercent } from "../../api/settings";
import { embeddingGuidanceKey } from "./embeddingHelpers";
import type { EmbeddingActionId } from "./useEmbeddingSettings";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import ErrorState from "../../components/common/ErrorState";
import { useRowActionMenu } from "../../components/common/rowActionMenu";

interface Props {
  local: EmbeddingLocalStatus;
  busy: EmbeddingActionId | null;
  /** 失败原因（后端 detail 原样透传）。 */
  reason: string;
  onDownload: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onRemove: () => void;
}

export default function EmbeddingLocalBlock({
  local,
  busy,
  reason,
  onDownload,
  onCancel,
  onRetry,
  onRemove,
}: Props) {
  useLocale();
  const buildMenu = useRowActionMenu();

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

  // 下载完成但配置还没启用：启用入口在卡头；这里只留提示与「···」里的清理。
  if (local.state === "ready") {
    return (
      <Flex vertical gap={12}>
        <Flex align="center" justify="space-between" gap={8} wrap>
          <Typography.Text strong>{t("embeddingSearch.local.readyHint")}</Typography.Text>
          <Dropdown
            trigger={["click"]}
            disabled={busy !== null}
            menu={{
              items: buildMenu([
                {
                  key: "remove-assets",
                  label: t("embeddingSearch.local.remove"),
                  danger: true,
                  confirm: t("embeddingSearch.local.removeTitle"),
                  confirmBody: t("embeddingSearch.local.removeConfirm"),
                  confirmOkText: t("embeddingSearch.local.remove"),
                  confirmCancelText: t("common.action.cancel"),
                  onClick: onRemove,
                },
              ]),
            }}
          >
            <Button
              icon={<MoreOutlined />}
              aria-label={t("common.rowActions.more")}
              disabled={busy !== null || undefined}
            />
          </Dropdown>
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
