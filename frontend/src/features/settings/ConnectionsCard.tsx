// SPDX-License-Identifier: Apache-2.0
/**
 * 「外部连接」页的 A/B 组：AI 服务与搜索来源的**总览 + 就地编辑**（T11）。
 *
 * 一屏看全所有外部凭据是这张卡的唯一目的：三态（已保存 / 未配置 / 仅本次会话）与存储
 * 方式（DPAPI / 当前平台无系统加密 / 仅内存）并列显示，谁的 Key 还没填一眼能看出来。
 *
 * 写侧不在这里：每一行的"改 / 清除"都交回该来源自己的域端点，见 `connectionKeyWrite`。
 */

import { Alert, Card, Flex, Typography } from "antd";
import ErrorState from "../../components/common/ErrorState";
import LoadingBlock from "../../components/common/LoadingBlock";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import ConnectionRow from "./ConnectionRow";
import {
  connectionGroupHint,
  connectionGroupLabel,
  connectionStorageLabel,
} from "./connectionLabels";
import { useConnections } from "./useConnections";

export default function ConnectionsCard() {
  useLocale();
  const { data, loading, error, reload } = useConnections();
  // 只取 A/B 两组（`kind === "credential"`）：C 组是下载源与端口，控件形态不同，
  // 由 `SystemSourcesCard` 负责。
  const groups = (data?.groups ?? []).filter((group) => group.kind === "credential");

  return (
    <Card title={t("connections.tab")} className="settings-card">
      <Alert type="info" showIcon title={t("connections.intro")} style={{ marginBottom: 16 }} />

      {error ? (
        <div style={{ marginBottom: 16 }}>
          <ErrorState
            description={
              <>
                <div>{t("connections.loadFailed")}</div>
                <Typography.Text type="secondary">
                  {t("connections.loadErrorBody", { message: error })}
                </Typography.Text>
              </>
            }
            onRetry={() => void reload()}
            retryLabel={t("common.retry")}
          />
        </div>
      ) : null}

      <LoadingBlock spinning={loading}>
        <Flex vertical gap={20}>
          {data ? (
            // 明文落盘要显眼：这不是"提示"，是用户应当知道的存储事实（Q19）。
            <Alert
              type={data.storage.kind === "plaintext" ? "warning" : "info"}
              showIcon
              title={t("connections.storage.title", {
                label: connectionStorageLabel(data.storage.kind, data.storage.label),
              })}
              description={data.storage.description}
            />
          ) : null}

          {groups.map((group) => (
            <section key={group.id} aria-label={connectionGroupLabel(group)}>
              <Typography.Text strong>{connectionGroupLabel(group)}</Typography.Text>
              <div style={{ marginBottom: 8 }}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {connectionGroupHint(group)}
                </Typography.Text>
              </div>
              <Flex vertical gap={16}>
                {group.items.map((item) => (
                  <ConnectionRow key={item.id} item={item} onChanged={reload} />
                ))}
              </Flex>
            </section>
          ))}
        </Flex>
      </LoadingBlock>
    </Card>
  );
}
