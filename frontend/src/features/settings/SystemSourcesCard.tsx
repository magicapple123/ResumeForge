// SPDX-License-Identifier: Apache-2.0
/**
 * 「外部连接」C 组：更新源 / 字体源 / RAG 资产源 / 浏览器端口（T12，可编辑）。
 *
 * 这四项**不是密钥**：不进"剥离密钥"白名单，但必须随备份带走（后端已经接在
 * `global_llm.json` 的 `system_sources` 字段上）。所以它们的展示口径也不同——
 * 明文显示当前值，并给出出厂默认值，随时可以恢复。
 *
 * 就地编辑放在行内（与 A/B 组同一形态）：改完立刻能看见"当前值"变了，不必再点开一次。
 * 校验在后端做（端口区间、URL 协议、owner/repo），前端只负责把 400 的原因原样显示出来。
 */

import { Alert, Button, Card, Flex, Input, Space, Tag, Typography } from "antd";
import ErrorState from "../../components/common/ErrorState";
import LoadingBlock from "../../components/common/LoadingBlock";
import { useState } from "react";
import { resetSystemSource, saveSystemSource } from "../../api/connections";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { useToast } from "../../hooks/useToast";
import type { ConnectionItem } from "../../types";
import {
  connectionGroupHint,
  connectionGroupLabel,
  connectionItemHint,
  connectionItemLabel,
  connectionProtectionLabel,
} from "./connectionLabels";
import { useConnections } from "./useConnections";

interface SystemRowProps {
  item: ConnectionItem;
  onApplied: (item: ConnectionItem) => void;
}

/** 一行：当前值 + 就地编辑 + 恢复默认。 */
function SystemRow({ item, onApplied }: SystemRowProps) {
  useLocale();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.value);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const label = connectionItemLabel(item);

  const save = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setFailure("");
    try {
      const payload = await saveSystemSource(item.id, draft.trim());
      const updated = payload.groups
        .flatMap((group) => group.items)
        .find((row) => row.id === item.id);
      if (updated) onApplied(updated);
      setEditing(false);
      toast.success(t("connections.toast.saved", { name: label }));
    } catch (err) {
      // 后端的 400 说明里就带着"怎么改"（端口区间 / http 前缀 / owner/repo），原样显示。
      setFailure(err instanceof Error ? err.message : t("connections.loadFailed"));
    } finally {
      setBusy(false);
    }
  };

  const reset = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setFailure("");
    try {
      const payload = await resetSystemSource(item.id);
      const updated = payload.groups
        .flatMap((group) => group.items)
        .find((row) => row.id === item.id);
      if (updated) onApplied(updated);
      toast.success(t("connections.toast.reset", { name: label }));
    } catch (err) {
      setFailure(err instanceof Error ? err.message : t("connections.loadFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Flex className="connection-row" vertical gap={6}>
      <Flex align="center" gap={8} wrap>
        <Typography.Text strong>{label}</Typography.Text>
        <Tag color={item.is_default ? undefined : "blue"}>
          {item.is_default ? t("connections.status.default") : t("connections.status.modified")}
        </Tag>
        {/* 与 A/B 组同一口径：这四项不是密钥，存储标注如实写"明文配置文件"。 */}
        <Tag>{connectionProtectionLabel(item)}</Tag>
      </Flex>

      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {connectionItemHint(item)}
      </Typography.Text>

      {editing ? (
        <Flex align="center" gap={8} wrap>
          <Input
            aria-label={label}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onPressEnter={() => void save()}
            style={{ maxWidth: 420 }}
          />
          <Button
            type="primary"
            size="small"
            loading={busy}
            // 一页四行同样的按钮：无障碍名带上条目名（antd 会给两个汉字的按钮插空格，
            // 读屏念成"保 存"，所以显式给 aria-label）。
            aria-label={t("connections.action.saveValue", { name: label })}
            disabled={draft.trim() === "" || undefined}
            onClick={() => void save()}
          >
            {t("connections.action.save")}
          </Button>
          <Button
            size="small"
            disabled={busy || undefined}
            onClick={() => {
              setEditing(false);
              setDraft(item.value);
              setFailure("");
            }}
          >
            {t("connections.action.cancel")}
          </Button>
        </Flex>
      ) : (
        <Flex align="center" gap={8} wrap>
          <Typography.Text code>{item.value}</Typography.Text>
          <Space size={4}>
            <Button
              size="small"
              aria-label={t("connections.action.editValue", { name: label })}
              onClick={() => {
                setDraft(item.value);
                setEditing(true);
              }}
            >
              {t("connections.action.edit")}
            </Button>
            {/* 已改过才需要"恢复默认"：默认状态下这只按钮没有任何效果。 */}
            <Button
              size="small"
              aria-label={t("connections.action.resetValue", { name: label })}
              disabled={item.is_default || busy || undefined}
              onClick={() => void reset()}
            >
              {t("connections.action.reset")}
            </Button>
          </Space>
        </Flex>
      )}

      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {t("connections.system.defaultValue", { value: item.default_value })}
      </Typography.Text>
      {failure ? <Alert type="error" showIcon title={failure} /> : null}
    </Flex>
  );
}

export default function SystemSourcesCard() {
  useLocale();
  const { data, loading, error, reload, apply } = useConnections();
  const group = (data?.groups ?? []).find((item) => item.kind === "system");

  /** 单项改完之后只替换那一行：整页状态会由下一次读刷新，这里先让当前值立刻变。 */
  const onApplied = (updated: ConnectionItem): void => {
    if (!data) return;
    apply({
      ...data,
      groups: data.groups.map((item) => ({
        ...item,
        items: item.items.map((row) => (row.id === updated.id ? updated : row)),
      })),
    });
  };

  return (
    <Card
      title={group ? connectionGroupLabel(group) : t("connections.group.system")}
      className="settings-card"
    >
      {error ? (
        <ErrorState
          description={t("connections.loadErrorBody", { message: error })}
          onRetry={() => void reload()}
          retryLabel={t("common.retry")}
        />
      ) : null}

      <LoadingBlock spinning={loading}>
        <Flex vertical gap={16}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {group ? connectionGroupHint(group) : ""}
          </Typography.Text>
          {(group?.items ?? []).map((item) => (
            <SystemRow key={item.id} item={item} onApplied={onApplied} />
          ))}
        </Flex>
      </LoadingBlock>
    </Card>
  );
}
