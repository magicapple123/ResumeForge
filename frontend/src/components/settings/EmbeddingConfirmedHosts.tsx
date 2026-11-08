// SPDX-License-Identifier: Apache-2.0
/** 已确认 host 的清单：可逐条撤销；撤销当前生效 host 时由 hook 一并停用。 */
import { Button, Flex, Popconfirm, Tag, Typography } from "antd";
import type { EmbeddingActionId } from "../../features/settings/useEmbeddingSettings";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

interface Props {
  hosts: string[];
  /** 当前生效配置的 host（为空表示未启用远程）。 */
  activeHost: string;
  busy: EmbeddingActionId | null;
  onRevoke: (host: string) => void;
}

export default function EmbeddingConfirmedHosts({ hosts, activeHost, busy, onRevoke }: Props) {
  useLocale();
  if (hosts.length === 0) return null;
  return (
    <div>
      <Typography.Text strong>{t("embeddingSearch.hosts.title")}</Typography.Text>
      <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
        {t("embeddingSearch.hosts.hint")}
      </Typography.Text>
      <Flex vertical gap={8} style={{ marginTop: 8 }}>
        {hosts.map((host) => (
          <Flex key={host} gap={8} align="center" wrap>
            <Typography.Text code>{host}</Typography.Text>
            {host === activeHost ? (
              <Tag color="green">{t("embeddingSearch.hosts.active")}</Tag>
            ) : null}
            <Popconfirm
              title={t("embeddingSearch.hosts.revokeTitle")}
              description={t("embeddingSearch.hosts.revokeBody")}
              okText={t("embeddingSearch.hosts.revoke")}
              cancelText={t("common.action.cancel")}
              okButtonProps={{ danger: true, loading: busy === "revoke" }}
              onConfirm={() => onRevoke(host)}
            >
              <Button size="small" danger>
                {t("embeddingSearch.hosts.revoke")}
              </Button>
            </Popconfirm>
          </Flex>
        ))}
      </Flex>
    </div>
  );
}
