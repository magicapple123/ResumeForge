// SPDX-License-Identifier: Apache-2.0
/** 自制模板列表：模板与版式共用一套操作语义。 */
import { DeleteOutlined, EditOutlined, EyeOutlined, RobotOutlined } from "@ant-design/icons";
import { Space, Table, Tag, Typography } from "antd";
import type { TableColumnsType } from "antd";
import type { ResumeTemplateDetail } from "../../types";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { RowActions } from "../common/RowActions";

interface Props {
  templates: ResumeTemplateDetail[];
  loading: boolean;
  onPreview: (template: ResumeTemplateDetail) => void;
  onEdit: (template: ResumeTemplateDetail) => void;
  onAsk: (template: ResumeTemplateDetail) => void;
  onDelete: (template: ResumeTemplateDetail) => void;
}

export default function TemplateCustomTable({
  templates,
  loading,
  onPreview,
  onEdit,
  onAsk,
  onDelete,
}: Props) {
  useLocale();
  const columns: TableColumnsType<ResumeTemplateDetail> = [
    {
      title: t("templatesUi.table.column.template"),
      dataIndex: "name",
      render: (value: string, row) => (
        <Space orientation="vertical" size={0}>
          <Space size={6}>
            <b>{value}</b>
            {row.source_name ? (
              <Tag>{t("templatesUi.table.source", { name: row.source_name })}</Tag>
            ) : null}
          </Space>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {row.description || t("templatesUi.table.noDescription")}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: t("templatesUi.table.column.actions"),
      key: "actions",
      width: 96,
      render: (_, row) => (
        <RowActions
          more={[
            {
              key: "preview",
              label: t("templatesUi.table.action.preview"),
              icon: <EyeOutlined />,
              onClick: () => onPreview(row),
            },
            {
              key: "edit",
              label: t("templatesUi.table.action.edit"),
              icon: <EditOutlined />,
              onClick: () => onEdit(row),
            },
            ...(row.kind === "format"
              ? [
                  {
                    key: "ask",
                    label: t("templatesUi.table.action.ask"),
                    icon: <RobotOutlined />,
                    onClick: () => onAsk(row),
                  },
                ]
              : []),
            {
              key: "delete",
              label: t("templatesUi.table.action.delete"),
              icon: <DeleteOutlined />,
              danger: true,
              confirm: t("templatesUi.table.confirm.delete", { name: row.name }),
              onClick: () => onDelete(row),
            },
          ]}
        />
      ),
    },
  ];

  return (
    <Table
      rowKey="id"
      size="small"
      loading={loading}
      columns={columns}
      dataSource={templates}
      pagination={false}
    />
  );
}
