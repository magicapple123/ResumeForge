// SPDX-License-Identifier: Apache-2.0
/**
 * 「已就绪」态：显示当前生效的服务与清理出口；失败态不会走到这里。
 *
 * ## 危险操作收进「···」（条目 08）
 *
 * 这一态原先并排两颗按钮：「关闭语义检索」（主操作）+ 一颗裸红按钮（本地「删除本地模型
 * 文件」/ 远程「清除已保存的密钥」，各带一个 Popconfirm）。改后：
 *
 * - 「关闭语义检索」移到卡头 `extra`（整张卡唯一主操作，与「大模型 API 配置」卡同构）；
 * - 删除/清除进「···」，二次确认复用 `useRowActionMenu`（`confirm` / `confirmBody` /
 *   `danger` 自动走 `modal.confirm`），与列表行同一套确认，不手写第三份；
 * - `busy !== null` 时「···」禁用。
 */
import { Button, Dropdown, Flex, Tag, Typography } from "antd";
import { MoreOutlined } from "@ant-design/icons";
import type { EmbeddingStatus } from "../../api/settings";
import type { EmbeddingActionId } from "../../features/settings/useEmbeddingSettings";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { useRowActionMenu } from "../common/rowActionMenu";

interface Props {
  status: EmbeddingStatus;
  busy: EmbeddingActionId | null;
  onClearKey: () => void;
  onRemoveAssets: () => void;
}

export default function EmbeddingReadyPanel({ status, busy, onClearKey, onRemoveAssets }: Props) {
  useLocale();
  const buildMenu = useRowActionMenu();
  const local = status.provider !== "openai-http";

  // 本地只清理模型文件，远程只清除密钥：两者的后果不同（一个要重下 111 MB，一个要重填 Key）。
  const cleanupItem = local
    ? {
        key: "remove-assets",
        label: t("embeddingSearch.local.remove"),
        danger: true,
        confirm: t("embeddingSearch.local.removeTitle"),
        confirmBody: t("embeddingSearch.local.removeConfirm"),
        confirmOkText: t("embeddingSearch.local.remove"),
        confirmCancelText: t("common.action.cancel"),
        onClick: onRemoveAssets,
      }
    : {
        key: "clear-key",
        label: t("embeddingSearch.remote.clear"),
        danger: true,
        confirm: t("embeddingSearch.remote.clearTitle"),
        confirmBody: t("embeddingSearch.remote.clearConfirm"),
        confirmOkText: t("embeddingSearch.remote.clear"),
        confirmCancelText: t("common.action.cancel"),
        onClick: onClearKey,
      };

  return (
    <Flex vertical gap={12}>
      <Flex gap={8} align="center" wrap>
        <Tag color="blue">
          {local ? t("embeddingSearch.state.readyLocal") : t("embeddingSearch.state.readyRemote")}
        </Tag>
        <Typography.Text type="secondary">
          {local ? t("embeddingSearch.local.readyHint") : t("embeddingSearch.fallbackNote")}
        </Typography.Text>
        <Dropdown
          trigger={["click"]}
          disabled={busy !== null}
          menu={{ items: buildMenu([cleanupItem]) }}
        >
          <Button
            icon={<MoreOutlined />}
            aria-label={t("common.rowActions.more")}
            disabled={busy !== null || undefined}
          />
        </Dropdown>
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
    </Flex>
  );
}
