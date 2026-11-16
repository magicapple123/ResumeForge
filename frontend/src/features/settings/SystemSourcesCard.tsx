// SPDX-License-Identifier: Apache-2.0
/**
 * 「外部连接」C 组：更新源 / 字体源 / RAG 资产源 / 浏览器端口（T12，可编辑）。
 *
 * 这四项**不是密钥**：不进"剥离密钥"白名单，但必须随备份带走（后端已经接在
 * `global_llm.json` 的 `system_sources` 字段上）。所以它们的展示口径也不同——
 * 明文显示当前值，值偏离出厂值时补一句「出厂值 …」，随时可以恢复。
 *
 * 行由 `ConnectionListRow`（`variant="value"`）渲染，与 A/B 组密钥行共用同一份实现
 * （issue I-09 之前这里有一份几乎相同的内联 `SystemRow`）。
 *
 * 校验在后端做（端口区间、URL 协议、owner/repo），前端只负责把 400 的原因原样显示出来。
 */

import { Card } from "antd";
import ErrorState from "../../components/common/ErrorState";
import LoadingBlock from "../../components/common/LoadingBlock";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { ConnectionItem } from "../../types";
import ConnectionListRow from "./ConnectionListRow";
import { connectionGroupHint, connectionGroupLabel } from "./connectionLabels";
import { useConnections } from "./useConnections";

export default function SystemSourcesCard() {
  useLocale();
  const { data, loading, error, reload, apply } = useConnections();
  const group = (data?.groups ?? []).find((item) => item.kind === "system");
  const groupLabel = group ? connectionGroupLabel(group) : t("connections.group.system");

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
    <Card title={groupLabel} className="settings-card">
      {error ? (
        <ErrorState
          description={t("connections.loadErrorBody", { message: error })}
          onRetry={() => void reload()}
          retryLabel={t("common.retry")}
        />
      ) : null}

      <LoadingBlock spinning={loading}>
        <section className="connection-group" aria-label={groupLabel}>
          <div className="connection-group__title">{groupLabel}</div>
          <div className="connection-group__hint">{group ? connectionGroupHint(group) : ""}</div>
          <div className="connection-list">
            {(group?.items ?? []).map((item) => (
              <ConnectionListRow key={item.id} item={item} variant="value" onApplied={onApplied} />
            ))}
          </div>
        </section>
      </LoadingBlock>
    </Card>
  );
}
