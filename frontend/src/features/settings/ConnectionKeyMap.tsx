// SPDX-License-Identifier: Apache-2.0
/**
 * 「密钥地图」：一台机器上到底有哪几把 Key、各在哪改、谁在用、留空会发生什么（CR-12）。
 *
 * ## 为什么不在这里写清单
 *
 * 行由后端从 `credentials.registry` 投影（`GET /api/connections` 的 `key_map`），前端
 * 只负责渲染。页面里再维护一份"有哪几把 Key"的中文表，下一次新增来源时它一定落后——
 * 而落后的表现是"用户在页面上看到一行、地图里找不到它"，比没有地图更糟。
 *
 * ## 四列的分工
 *
 * - **在哪配**：界面路径（用户要去点哪里）；
 * - **谁在用**：这把 Key 被哪些功能拿去发请求（回答"删了会怎样"）；
 * - **留空含义**：空串/清除的语义。四套写语义本来就不同（搜索=移除、语音=沿用本条、
 *   代理=保留、大模型=哨兵），不写清就会按别的页面的习惯操作，得到相反的结果；
 * - 文件存储位置收在名称的 `title` 里，排障时才需要，不占版面。
 */

import { Table, Typography } from "antd";
import type { TableColumnsType } from "antd";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { ConnectionKeyMapRow } from "../../types";

const columns = (): TableColumnsType<ConnectionKeyMapRow> => [
  {
    title: t("connections.keyMap.col.source"),
    dataIndex: "label",
    key: "label",
    render: (_value, row) => <span title={row.where || undefined}>{row.label}</span>,
  },
  {
    title: t("connections.keyMap.col.configureAt"),
    dataIndex: "configure_at",
    key: "configure_at",
  },
  { title: t("connections.keyMap.col.usedBy"), dataIndex: "used_by", key: "used_by" },
  {
    title: t("connections.keyMap.col.empty"),
    dataIndex: "empty_meaning",
    key: "empty_meaning",
  },
];

export default function ConnectionKeyMap({ rows }: { rows: ConnectionKeyMapRow[] }) {
  useLocale();
  if (rows.length === 0) return null;
  return (
    <section className="connection-key-map" aria-label={t("connections.keyMap.title")}>
      <Typography.Text strong>{t("connections.keyMap.title")}</Typography.Text>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 8, fontSize: 12 }}>
        {t("connections.keyMap.hint", { count: rows.length })}
      </Typography.Paragraph>
      <Table<ConnectionKeyMapRow>
        size="small"
        rowKey="id"
        pagination={false}
        columns={columns()}
        dataSource={rows}
      />
    </section>
  );
}
