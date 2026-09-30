import { PlusOutlined } from "@ant-design/icons";
import { Button, Input, Space } from "antd";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onAdd: () => void;
}

export default function WebFormProfileCustomFieldAdder({ value, onChange, onAdd }: Props) {
  return (
    <Space.Compact style={{ width: "100%", marginTop: 4 }}>
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onPressEnter={onAdd}
        placeholder="字段名称，如：实验室、导师姓名"
        maxLength={40}
        aria-label="新增自定义网申字段名称"
      />
      <Button type="dashed" icon={<PlusOutlined />} onClick={onAdd}>
        添加
      </Button>
    </Space.Compact>
  );
}
