/** 自制模板列表：样式模板与格式模板共用一套操作语义。 */
import { DeleteOutlined, EditOutlined, EyeOutlined, RobotOutlined } from "@ant-design/icons";
import { Space, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { ResumeTemplateDetail } from "../../types";
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
  const columns: ColumnsType<ResumeTemplateDetail> = [
    {
      title: "模板",
      dataIndex: "name",
      render: (value: string, row) => (
        <Space orientation="vertical" size={0}>
          <Space size={6}>
            <b>{value}</b>
            {row.source_name ? <Tag>来自 {row.source_name}</Tag> : null}
          </Space>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {row.description || "（无说明）"}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: "操作",
      key: "actions",
      width: 96,
      render: (_, row) => (
        <RowActions
          more={[
            {
              key: "preview",
              label: "预览效果",
              icon: <EyeOutlined />,
              onClick: () => onPreview(row),
            },
            {
              key: "edit",
              label: "编辑",
              icon: <EditOutlined />,
              onClick: () => onEdit(row),
            },
            ...(row.kind === "format"
              ? [
                  {
                    key: "ask",
                    label: "找助手改这个模板",
                    icon: <RobotOutlined />,
                    onClick: () => onAsk(row),
                  },
                ]
              : []),
            {
              key: "delete",
              label: "删除",
              icon: <DeleteOutlined />,
              danger: true,
              confirm: "删除模板「" + row.name + "」？引用它的简历会退回默认模板。",
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
