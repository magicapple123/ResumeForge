/** 编辑简历备注弹窗（受控）：多行输入 + 确认 loading。
 *
 * 状态与提交逻辑（confirmNote）留在 ResumesPage，经 props 回传。
 */
import { Input, Modal } from "antd";
import { MaxLengthHint } from "../../components/common/MaxLengthHint";

interface Props {
  open: boolean;
  value: string;
  confirmLoading: boolean;
  onChange: (value: string) => void;
  onOk: () => void;
  onCancel: () => void;
}

export default function ResumeNoteModal({
  open,
  value,
  confirmLoading,
  onChange,
  onOk,
  onCancel,
}: Props) {
  return (
    <Modal
      title="编辑备注"
      open={open}
      okText="保存"
      confirmLoading={confirmLoading}
      onCancel={onCancel}
      onOk={onOk}
    >
      <Input.TextArea
        value={value}
        maxLength={2000}
        rows={4}
        placeholder="备注会显示在简历列表里（选填）"
        onChange={(event) => onChange(event.target.value)}
      />
      <MaxLengthHint value={value} maxLength={2000} />
    </Modal>
  );
}
