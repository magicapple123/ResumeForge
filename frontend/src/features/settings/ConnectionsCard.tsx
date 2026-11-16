// SPDX-License-Identifier: Apache-2.0
/**
 * 「外部连接」页的 A/B 组：AI 服务与搜索来源的**总览 + 就地编辑**（T11）。
 *
 * 一屏看全所有外部凭据是这张卡的唯一目的：状态（已保存 / 未配置 / 仅本次会话）与存储
 * 方式（DPAPI / 当前平台无系统加密 / 仅内存）分开显示，谁的 Key 还没填一眼能看出来。
 *
 * 行由 `ConnectionListRow`（`variant="secret"`）渲染，与 C 组系统来源共用同一份实现。
 * 写侧不在这里：每一行的"改 / 清除"都交回该来源自己的域端点，见 `connectionKeyWrite`。
 *
 * 顶部只留**一个** Alert：原来"这里列了什么"与"密钥存在哪"是两条并列的横幅，读完第一条
 * 才看到第二条，而后者更要紧（明文落盘时才升级成 warning）。
 */

import { Alert, Card } from "antd";
import ErrorState from "../../components/common/ErrorState";
import LoadingBlock from "../../components/common/LoadingBlock";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import ConnectionListRow from "./ConnectionListRow";
import {
  connectionGroupHint,
  connectionGroupLabel,
  connectionStorageLabel,
} from "./connectionLabels";
import { useConnections } from "./useConnections";

export default function ConnectionsCard() {
  useLocale();
  const { data, loading, error, reload } = useConnections();
  // 只取 A/B 两组（`kind === "credential"`）：C 组是下载源与端口，写语义不同，
  // 由 `SystemSourcesCard` 负责（同一行组件，`variant="value"`）。
  const groups = (data?.groups ?? []).filter((group) => group.kind === "credential");
  const plaintext = data?.storage.kind === "plaintext";

  return (
    <Card title={t("connections.tab")} className="settings-card">
      {/* 一个横幅说清两件事：这里有哪些外部依赖，以及密钥在这台机器上怎么存。 */}
      {data ? (
        <Alert
          type={plaintext ? "warning" : "info"}
          showIcon
          style={{ marginBottom: 8 }}
          title={t("connections.storage.title", {
            label: connectionStorageLabel(data.storage.kind, data.storage.label),
          })}
          description={
            data.storage.description
              ? `${t("connections.intro")} ${data.storage.description}`
              : t("connections.intro")
          }
        />
      ) : (
        <Alert type="info" showIcon style={{ marginBottom: 8 }} title={t("connections.intro")} />
      )}

      {error ? (
        <div style={{ marginBottom: 8 }}>
          <ErrorState
            description={t("connections.loadErrorBody", { message: error })}
            onRetry={() => void reload()}
            retryLabel={t("common.retry")}
          />
        </div>
      ) : null}

      <LoadingBlock spinning={loading}>
        {groups.map((group) => {
          const groupLabel = connectionGroupLabel(group);
          return (
            <section key={group.id} className="connection-group" aria-label={groupLabel}>
              <div className="connection-group__title">{groupLabel}</div>
              <div className="connection-group__hint">{connectionGroupHint(group)}</div>
              <div className="connection-list">
                {group.items.map((item) => (
                  <ConnectionListRow
                    key={item.id}
                    item={item}
                    variant="secret"
                    onChanged={reload}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </LoadingBlock>
    </Card>
  );
}
