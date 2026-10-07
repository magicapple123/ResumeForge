/** 「网申资料」自定义字段的改名与删除控件。 */
import { CheckOutlined, CloseOutlined, DeleteOutlined, EditOutlined } from "@ant-design/icons";
import { Button, Input, Popconfirm, Space, Typography } from "antd";
import { useState } from "react";

interface Props {
  label: string;
  editing: boolean;
  saving: boolean;
  onRename: (label: string) => string | undefined;
  onDelete: () => void;
}

/**
 * 自定义字段的 key 必须保持稳定：字段名变化只更新 details.label，
 * 这样已经记住的值、来源和后续实时识别不会因为改名丢失。
 */
export default function WebFormCustomFieldControls({
  label,
  editing,
  saving,
  onRename,
  onDelete,
}: Props) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(label);
  const [error, setError] = useState("");

  // 非编辑态时草稿始终跟随权威 label。Compiler 规范：随 prop 变化的重置用
  // 渲染期守卫式调整。
  const [prevSync, setPrevSync] = useState({ renaming, label });
  if (prevSync.renaming !== renaming || prevSync.label !== label) {
    setPrevSync({ renaming, label });
    if (!renaming) setDraft(label);
  }

  if (!editing) {
    return <Typography.Text type="secondary">{label}</Typography.Text>;
  }

  const commit = () => {
    const message = onRename(draft.trim());
    if (message) {
      setError(message);
      return;
    }
    setError("");
    setRenaming(false);
  };

  if (renaming) {
    return (
      <div>
        <Space.Compact style={{ width: "100%" }}>
          <Input
            value={draft}
            disabled={saving}
            maxLength={40}
            aria-label={"编辑字段名：" + label}
            onChange={(event) => {
              setDraft(event.target.value);
              if (error) setError("");
            }}
            onPressEnter={commit}
          />
          <Button
            type="primary"
            icon={<CheckOutlined />}
            disabled={saving}
            aria-label="保存字段名"
            onClick={commit}
          />
          <Button
            icon={<CloseOutlined />}
            disabled={saving}
            aria-label="取消修改字段名"
            onClick={() => {
              setDraft(label);
              setError("");
              setRenaming(false);
            }}
          />
        </Space.Compact>
        {error ? (
          <Typography.Text type="danger" style={{ fontSize: 12 }}>
            {error}
          </Typography.Text>
        ) : null}
      </div>
    );
  }

  return (
    <Space size={4} wrap>
      <Typography.Text type="secondary">{label}</Typography.Text>
      <Button
        type="link"
        size="small"
        icon={<EditOutlined />}
        disabled={saving}
        aria-label={"修改字段名：" + label}
        onClick={() => {
          setDraft(label);
          setError("");
          setRenaming(true);
        }}
      >
        修改名称
      </Button>
      <Popconfirm
        title={"删除「" + label + "」？"}
        description="保存后将从网申资料和实时识别中移除。"
        okText="确定"
        cancelText="取消"
        disabled={saving}
        onConfirm={onDelete}
      >
        <Button
          type="link"
          danger
          size="small"
          icon={<DeleteOutlined />}
          disabled={saving}
          aria-label={"删除自定义字段：" + label}
        >
          删除
        </Button>
      </Popconfirm>
    </Space>
  );
}
