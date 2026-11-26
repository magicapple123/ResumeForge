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
 *
 * ## 「用于」这一行的数据从哪来（#8）
 *
 * `ConnectionItem` 自己没有"谁在用"字段（它描述的是凭据本身），这条信息在
 * `key_map[].used_by` 里。于是这里建一张 `id → used_by_text` 的映射，按 **id** 关联后
 * 作为 prop 传给行——**不新增接口、不多发一次请求**。映射键对不上时那一行不渲染「用于」
 * （而不是显示一句空话），一致性由单测钉住：`key_map` 的 id 集合必须等于各组 items 的
 * id 集合。
 *
 * ## 组标题的「N / M 已配」
 *
 * 由组内 items **现算**（`status !== "not_configured"`），不读任何手写数字：新增一把
 * Key 时这个比值自动变。
 *
 * ## 密钥依赖矩阵（#9）
 *
 * 原来的四列表格（在哪配 / 谁在用 / 留空含义 / 文件位置）换成矩阵：行=功能、列=密钥。
 * 表格里那几句整话仍然在 `key_map` 里，给矩阵下方的详情卡与这里的「用于」用。
 */

import { Alert, Card } from "antd";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import ErrorState from "../../components/common/ErrorState";
import LoadingBlock from "../../components/common/LoadingBlock";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import ConnectionMatrix from "./ConnectionMatrix";
import ConnectionListRow from "./ConnectionListRow";
import {
  connectionGroupHint,
  connectionGroupLabel,
  connectionStorageLabel,
} from "./connectionLabels";
import { useConnections } from "./useConnections";

export default function ConnectionsCard() {
  useLocale();
  const navigate = useNavigate();
  const { data, loading, error, reload } = useConnections();
  // 只取 A/B 两组（`kind === "credential"`）：C 组是下载源与端口，写语义不同，
  // 由 `SystemSourcesCard` 负责（同一行组件，`variant="value"`）。
  const groups = (data?.groups ?? []).filter((group) => group.kind === "credential");
  const plaintext = data?.storage.kind === "plaintext";

  /** `id → used_by_text` 映射：按 id 关联，行组件自己不认识这把 Key 是谁。 */
  const usedByById = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of data?.key_map ?? []) {
      if (row.used_by_text) map.set(row.id, row.used_by_text);
    }
    return map;
  }, [data?.key_map]);

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

      {/* CR-12：整页最上面先给一张地图——"这机器上有哪几把 Key、各在哪改"比逐行读更快。 */}
      <ConnectionMatrix
        matrix={data?.matrix}
        details={data?.key_map ?? []}
        onConfigure={(section, anchor) => {
          // 落点带 tab + anchor：`SettingsPage` 会**先切分组再滚动**（隐藏分区滚不到）。
          navigate(`/settings?tab=${encodeURIComponent(section)}#${anchor}`);
        }}
      />

      <LoadingBlock spinning={loading}>
        {groups.map((group) => {
          const groupLabel = connectionGroupLabel(group);
          const configured = group.items.filter((item) => item.status !== "not_configured").length;
          return (
            <section key={group.id} className="connection-group" aria-label={groupLabel}>
              <div className="connection-group__title">
                <span>{groupLabel}</span>
                {/* 「N / M 已配」：组内现算，不手写。 */}
                <span className="connection-group__count">
                  {t("settingsUi.connections.groupCount", {
                    configured,
                    total: group.items.length,
                  })}
                </span>
              </div>
              <div className="connection-group__hint">{connectionGroupHint(group)}</div>
              <div className="connection-list">
                {group.items.map((item) => (
                  <ConnectionListRow
                    key={item.id}
                    item={item}
                    variant="secret"
                    usedBy={usedByById.get(item.id)}
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
