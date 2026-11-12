// SPDX-License-Identifier: Apache-2.0
/**
 * 已确认 host 的清单：可逐条撤销；撤销当前生效 host 时由 hook 一并停用。
 *
 * 2026-11-10 第二轮（清单 §3.2 第 6 条）：安全设置不该与配置列表同级常驻展开——
 * 默认收起，标题行给出「确认了几个」与「换地址要重新确认」的提示，展开后才渲染
 * host 与撤销按钮。收起时**条件渲染**（不是 display:none），
 * "页面上只有一个 host"这类断言才有意义。
 */
import { Button, Flex, Popconfirm, Tag, Typography } from "antd";
import { useState } from "react";
import type { EmbeddingActionId } from "./useEmbeddingSettings";
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
  const [open, setOpen] = useState(false);
  if (hosts.length === 0) return null;
  return (
    <div>
      <Flex justify="space-between" align="center" gap={12} wrap>
        <Typography.Text>
          <Typography.Text strong>{t("embeddingSearch.hosts.title")}</Typography.Text>
          <Typography.Text type="secondary">
            {" · "}
            {t("embeddingSearch.hosts.count", { count: hosts.length })}
            {" · "}
            {t("embeddingSearch.hosts.hint")}
          </Typography.Text>
        </Typography.Text>
        <Button
          type="text"
          size="small"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? t("embeddingSearch.hosts.toggleOpen") : t("embeddingSearch.hosts.toggle")}
        </Button>
      </Flex>
      {open ? (
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
      ) : null}
    </div>
  );
}
