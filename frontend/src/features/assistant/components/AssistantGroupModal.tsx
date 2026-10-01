/** 助手会话分组编辑弹窗。 */

import { Input, Modal, Typography } from "antd";

interface Props {
  onChange: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
  open: boolean;
  value: string;
}

export default function AssistantGroupModal({ onChange, onClose, onConfirm, open, value }: Props) {
  return (
    <Modal title="移动到分组" open={open} okText="保存" onCancel={onClose} onOk={onConfirm}>
      <Typography.Paragraph type="secondary">
        给这段对话归个类（例如「字节」「面试准备」）。留空表示移出分组。分组只影响侧栏的显示，不会动对话内容。
      </Typography.Paragraph>
      <Input
        value={value}
        maxLength={64}
        placeholder="分组名称"
        onChange={(event) => onChange(event.target.value)}
      />
    </Modal>
  );
}
