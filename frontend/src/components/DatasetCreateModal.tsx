// SPDX-License-Identifier: Apache-2.0
/**
 * 新建数据集弹窗（受控）：输入名称 + 确认 loading。
 *
 * 状态与提交逻辑（createDataset、切换询问）留在 AppHeaderContext，经 props 回传；
 * 这里只负责把"数据集是什么、名字有什么限制"说清楚，避免用户把它当成文件夹。
 */
import { Input, Modal, Typography } from "antd";

interface Props {
  open: boolean;
  value: string;
  confirmLoading: boolean;
  onChange: (value: string) => void;
  onOk: () => void;
  onCancel: () => void;
}

export default function DatasetCreateModal({
  open,
  value,
  confirmLoading,
  onChange,
  onOk,
  onCancel,
}: Props) {
  return (
    <Modal
      title="新建数据集"
      open={open}
      okText="新建"
      confirmLoading={confirmLoading}
      onCancel={onCancel}
      onOk={onOk}
      destroyOnHidden
    >
      <Typography.Paragraph type="secondary">
        每份数据集是一套互相独立的岗位、资料与简历。界面长得一样，但数据不互通—— 适合区分「工作 /
        私人 / 面试练习」。
      </Typography.Paragraph>
      <Input
        value={value}
        maxLength={64}
        showCount
        autoFocus
        placeholder="例如：工作、私人、面试练习"
        aria-label="数据集名称"
        onChange={(event) => onChange(event.target.value)}
        onPressEnter={onOk}
      />
    </Modal>
  );
}
