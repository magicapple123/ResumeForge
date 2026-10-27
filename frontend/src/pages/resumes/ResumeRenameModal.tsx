// SPDX-License-Identifier: Apache-2.0
/** 重命名简历弹窗（受控）：输入框 + 确认 loading。
 *
 * 状态与提交逻辑（confirmRename）留在 ResumesPage，经 props 回传。
 */
import { Input, Modal } from "antd";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

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
  useLocale();
  return (
    <Modal
      title={t("resumesPage.rename.title")}
      open={open}
      okText={t("common.action.save")}
      confirmLoading={confirmLoading}
      onCancel={onCancel}
      onOk={onOk}
    >
      <Input
        value={value}
        maxLength={256}
        placeholder={t("resumesPage.rename.namePlaceholder")}
        onChange={(event) => onChange(event.target.value)}
      />
    </Modal>
  );
}
