// SPDX-License-Identifier: Apache-2.0
/** 「已就绪」态：显示当前生效的服务与关闭/清理出口；失败态不会走到这里。 */
import { Button, Flex, Popconfirm, Tag, Typography } from "antd";
import type { EmbeddingStatus } from "../../api/settings";
import type { EmbeddingActionId } from "../../features/settings/useEmbeddingSettings";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

interface Props {
  status: EmbeddingStatus;
  busy: EmbeddingActionId | null;
  onDisable: () => void;
  onClearKey: () => void;
  onRemoveAssets: () => void;
}

export default function EmbeddingReadyPanel({
  status,
  busy,
  onDisable,
  onClearKey,
  onRemoveAssets,
}: Props) {
  useLocale();
  const local = status.provider !== "openai-http";

  return (
    <Flex vertical gap={12}>
      <Flex gap={8} align="center" wrap>
        <Tag color="green">
          {local ? t("embeddingSearch.state.readyLocal") : t("embeddingSearch.state.readyRemote")}
        </Tag>
        <Typography.Text type="secondary">
          {local ? t("embeddingSearch.local.readyHint") : t("embeddingSearch.fallbackNote")}
        </Typography.Text>
      </Flex>

      {local ? null : (
        <Flex vertical gap={4}>
          <Typography.Text>
            {t("embeddingSearch.remote.hostLabel")}: {status.remote.host}
          </Typography.Text>
          <Typography.Text>
            {t("embeddingSearch.remote.modelLabel")}: {status.remote.model}
          </Typography.Text>
          {status.remote.dim > 0 ? (
            <Typography.Text type="secondary">
              {t("embeddingSearch.remote.dimLabel", { dim: status.remote.dim })}
            </Typography.Text>
          ) : null}
        </Flex>
      )}

      <Flex gap={8} wrap>
        <Button loading={busy === "disable"} onClick={onDisable}>
          {t("embeddingSearch.remote.disable")}
        </Button>
        {local ? (
          <Popconfirm
            title={t("embeddingSearch.local.removeTitle")}
            description={t("embeddingSearch.local.removeConfirm")}
            okText={t("embeddingSearch.local.remove")}
            cancelText={t("common.action.cancel")}
            okButtonProps={{ danger: true }}
            onConfirm={onRemoveAssets}
          >
            <Button danger>{t("embeddingSearch.local.remove")}</Button>
          </Popconfirm>
        ) : (
          <Popconfirm
            title={t("embeddingSearch.remote.clearTitle")}
            description={t("embeddingSearch.remote.clearConfirm")}
            okText={t("embeddingSearch.remote.clear")}
            cancelText={t("common.action.cancel")}
            okButtonProps={{ danger: true }}
            onConfirm={onClearKey}
          >
            <Button danger loading={busy === "clear"}>
              {t("embeddingSearch.remote.clear")}
            </Button>
          </Popconfirm>
        )}
      </Flex>
    </Flex>
  );
}
