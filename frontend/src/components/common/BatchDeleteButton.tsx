/** 批量选择模式的「删除所选」按钮：Popconfirm 二次确认，文案带已选数量。 */
import { Button, Popconfirm } from "antd";

interface Props {
  count: number;
  /** 数量单位（如「条知识」「份资料」），拼进确认文案。 */
  noun: string;
  disabled?: boolean;
  /** 确认后的删除动作（调用方负责请求、提示与刷新）。 */
  onDelete: () => void;
}

export default function BatchDeleteButton({ count, noun, disabled = false, onDelete }: Props) {
  return (
    <Popconfirm
      title={`删除选中的 ${count} ${noun}？`}
      description="会移入回收站，之后可以在「回收站」里恢复。"
      okText="删除"
      cancelText="取消"
      okButtonProps={{ danger: true }}
      disabled={disabled || count === 0}
      onConfirm={onDelete}
    >
      <Button danger disabled={disabled || count === 0}>
        删除所选
      </Button>
    </Popconfirm>
  );
}
