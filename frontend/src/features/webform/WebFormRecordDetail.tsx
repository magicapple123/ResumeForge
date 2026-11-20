// SPDX-License-Identifier: Apache-2.0
/**
 * 一条填充记录的**明细**（T03）：页面信息 + 逐字段表 + 快照摘要。
 *
 * 两个宿主共用：
 * - 完整记录面板（`WebFormRecordsPanel` 的 Collapse 展开区）；
 * - 初始态右卡「最近填写」的就地展开（点「查看全部」后展开，不再开抽屉）。
 *
 * 抽出来的直接收益是两处不用各写一份列定义：`id_number` 的掩码与状态标签一旦分叉，
 * 一边会泄露证件号、另一边会显示协议值。
 */
import { Button, Descriptions, Space, Spin, Table, Tag, Typography } from "antd";
import type { TableColumnsType } from "antd";
import { useState } from "react";

import { t } from "../../i18n";
import type { MessageKey } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { WebFormFillRecord, WebFormRecordItem } from "../../types";

/**
 * 记录里那条明细的状态 → 显示名（labelKey）与颜色（与填充结果用的是同一套取值）。
 *
 * 状态键是协议值（与填充结果同源），只有显示名走 `labelKey`：模块作用域不能调 `t()`，
 * 否则切语言不重渲染。
 */
const ITEM_STATUS_META: Record<string, { color: string; labelKey: MessageKey }> = {
  filled: { color: "success", labelKey: "webFormRecords.status.filled" },
  unverified: { color: "warning", labelKey: "webFormRecords.status.unverified" },
  failed: { color: "error", labelKey: "webFormRecords.status.failed" },
  skipped: { color: "default", labelKey: "webFormRecords.status.skipped" },
  conflict: { color: "error", labelKey: "webFormRecords.status.conflict" },
};

/** #36: 证件号默认打码；点「显示」才看（不给复制快捷键）。 */
function MaskedValue({ value }: { value: string }) {
  const [revealed, setRevealed] = useState(false);
  const masked =
    value.length <= 7
      ? "*".repeat(value.length)
      : `${value.slice(0, 3)}${"*".repeat(Math.max(1, value.length - 7))}${value.slice(-4)}`;
  return (
    <Space size={6}>
      <span>{revealed ? value : masked}</span>
      <Button
        type="link"
        size="small"
        style={{ padding: 0 }}
        onClick={() => setRevealed((current) => !current)}
      >
        {revealed ? t("webFormRecords.hide") : t("webFormRecords.reveal")}
      </Button>
    </Space>
  );
}

const isIdNumber = (item: WebFormRecordItem) => item.field === "id_number";

interface Props {
  /** 记录的页面标题（摘要里带，详情取回前就能显示）。 */
  pageTitle?: string | null;
  url?: string | null;
  /** 明细：`null` + `loading` = 正在取；`null` + `!loading` = 取不到（如实空表）。 */
  detail: WebFormFillRecord | null;
  loading?: boolean;
}

export default function WebFormRecordDetail({ pageTitle, url, detail, loading = false }: Props) {
  useLocale();

  // 列名要按当前语言取，所以放在组件内（模块作用域调 t() 切语言不重渲染）。
  const itemColumns: TableColumnsType<WebFormRecordItem> = [
    {
      title: t("webFormRecords.column.field"),
      key: "field",
      width: 150,
      render: (_, item) => item.field_label || item.control_label || "—",
    },
    {
      title: t("webFormRecords.column.value"),
      dataIndex: "value",
      key: "value",
      ellipsis: true,
      render: (_, item) => (isIdNumber(item) ? <MaskedValue value={item.value} /> : item.value),
    },
    {
      title: t("webFormRecords.column.status"),
      key: "status",
      width: 200,
      render: (_, item) => {
        const meta = ITEM_STATUS_META[item.status];
        return (
          <Space orientation="vertical" size={0}>
            {/* 状态值不在词表里时如实显示协议值，不吞掉。 */}
            <Tag color={meta?.color ?? "default"}>{meta ? t(meta.labelKey) : item.status}</Tag>
            {item.detail ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {item.detail}
              </Typography.Text>
            ) : null}
          </Space>
        );
      },
    },
  ];

  return (
    <Space orientation="vertical" size={12} style={{ width: "100%" }}>
      <Descriptions size="small" column={1}>
        <Descriptions.Item label={t("webFormRecords.field.page")}>
          {pageTitle || t("webFormRecords.untitled")}
          {url ? (
            <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
              {url}
            </Typography.Text>
          ) : null}
        </Descriptions.Item>
      </Descriptions>
      {loading ? (
        <div style={{ textAlign: "center", padding: 16 }}>
          <Spin />
        </div>
      ) : (
        <>
          <Table
            rowKey="index"
            size="small"
            pagination={{ pageSize: 20, hideOnSinglePage: true, showSizeChanger: false }}
            columns={itemColumns}
            dataSource={detail?.items ?? []}
            locale={{ emptyText: t("webFormRecords.table.empty") }}
          />
          {(detail?.page_snapshot.length ?? 0) > 0 ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t("webFormRecords.snapshot.summary", {
                filled: detail?.page_snapshot.filter((row) => row.filled).length ?? 0,
              })}
            </Typography.Text>
          ) : null}
        </>
      )}
    </Space>
  );
}
