import { Button, Input, Space, Tag, Typography } from "antd";

interface Props {
  editing: boolean;
  filledCount: number;
  totalCount: number;
  searchTerm: string;
  showOnlyFilled: boolean;
  onSearchChange: (value: string) => void;
  onToggleShowOnlyFilled: () => void;
}

export default function WebFormProfileToolbar({
  editing,
  filledCount,
  totalCount,
  searchTerm,
  showOnlyFilled,
  onSearchChange,
  onToggleShowOnlyFilled,
}: Props) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        flexWrap: "wrap",
        marginBottom: 14,
        padding: "10px 12px",
        border: "1px solid #e6edf5",
        borderRadius: 10,
        background: "#f8fbff",
      }}
    >
      <Space size="small" wrap>
        <Tag color={filledCount ? "blue" : "default"}>
          已填写 {filledCount} / {totalCount}
        </Tag>
        <Typography.Text type="secondary">
          {editing ? "可直接编辑，保存全部资料时一起保存" : "只显示已经填写的资料"}
        </Typography.Text>
      </Space>
      <Space size="small" wrap>
        <Input
          allowClear
          value={searchTerm}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="搜索字段名或内容"
          aria-label="搜索网申资料"
          style={{ width: 220 }}
        />
        {editing ? (
          <Button
            size="small"
            type={showOnlyFilled ? "primary" : "default"}
            onClick={onToggleShowOnlyFilled}
          >
            {showOnlyFilled ? "显示全部字段" : "只看已填写"}
          </Button>
        ) : null}
      </Space>
    </div>
  );
}
