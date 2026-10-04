/** 重命名简历弹窗（受控）：输入框 + 确认 loading。
 *
 * 状态与提交逻辑（confirmRename）留在 ResumesPage，经 props 回传。
 */
import { Input, Modal } from "antd";

interface Props {
  open: boolean;
  value: string;
  confirmLoading: boolean;
  onChange: (value: string) => void;
  onOk: () => void;
  onCancel: () => void;
}

export default function ResumeRenameModal({
  open,
  value,
  confirmLoading,
  onChange,
  onOk,
  onCancel,
}: Props) {
  return (
    <Modal
      title="重命名简历"
      open={open}
      okText="保存"
      confirmLoading={confirmLoading}
      onCancel={onCancel}
      onOk={onOk}
    >
      <Input
        value={value}
        maxLength={256}
        placeholder="简历名称"
        onChange={(event) => onChange(event.target.value)}
      />
    </Modal>
  );
}
