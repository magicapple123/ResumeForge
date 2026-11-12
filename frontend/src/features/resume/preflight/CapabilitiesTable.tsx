// SPDX-License-Identifier: Apache-2.0
/**
 * 格式能力矩阵（W11 消费 W05，契约 §4.5）：HTML / 精确 PDF / 下载 PDF / Word / MD / TXT / JSON
 * 各自对每项能力的 支持 / 近似 / 不支持。唯一来源是后端下发的 `capabilities`。
 */
import { Table, Tag, Tooltip, Typography } from "antd";
import type { TableColumnsType } from "antd";
import EmptyState from "../../../components/common/EmptyState";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import {
  FORMAT_LABEL_KEY,
  LEVEL_LABEL_KEY,
  NOTE_MESSAGE_KEY,
  parseCapabilities,
  parseCapabilityNotes,
  type CapabilityCell,
  type CapabilityLevel,
} from "./capabilities";

const LEVEL_COLOR: Record<CapabilityLevel, string> = {
  supported: "green",
  approx: "orange",
  unsupported: "red",
  unknown: "default",
};

interface Props {
  capabilities: Record<string, unknown> | null | undefined;
  /** R-26：`{format: {capability: 原因码}}`；缺省时退化成纯标签（不弹提示）。 */
  notes?: Record<string, unknown> | null;
}

export default function CapabilitiesTable({ capabilities, notes }: Props) {
  useLocale();
  const matrix = parseCapabilities(capabilities);
  const noteOf = (format: string, capability: string): string => {
    const code = parseCapabilityNotes(notes)[`${format}:${capability}`];
    const key = code ? NOTE_MESSAGE_KEY[code] : undefined;
    return key ? t(key) : "";
  };
  if (matrix.rows.length === 0) {
    return <EmptyState inline description={t("preflight.capabilities.empty")} />;
  }
  const columns: TableColumnsType<CapabilityCell> = [
    {
      title: t("preflight.capabilities.capability"),
      dataIndex: "capability",
      key: "capability",
      render: (_value: string, row: CapabilityCell) =>
        row.labelKey ? t(row.labelKey) : row.capability,
    },
    ...matrix.formats.map((format) => {
      const labelKey = FORMAT_LABEL_KEY[format];
      return {
        title: labelKey ? t(labelKey) : format,
        key: format,
        render: (_value: unknown, row: CapabilityCell) => {
          const level = row.levels[format] ?? "unknown";
          const tag = <Tag color={LEVEL_COLOR[level]}>{t(LEVEL_LABEL_KEY[level])}</Tag>;
          // 「支持」格不弹（没有需要解释的东西），坑：不要再给 Tag 传 title，否则双提示。
          const note = level === "supported" ? "" : noteOf(format, row.capability);
          return note ? <Tooltip title={note}>{tag}</Tooltip> : tag;
        },
      };
    }),
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <Table<CapabilityCell>
        size="small"
        rowKey={(row) => row.capability}
        columns={columns}
        dataSource={matrix.rows}
        pagination={false}
        scroll={{ x: "max-content" }}
      />
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {t("preflight.capabilities.hint")}
      </Typography.Text>
    </div>
  );
}
