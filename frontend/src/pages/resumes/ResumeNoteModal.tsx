// SPDX-License-Identifier: Apache-2.0
/** 编辑简历备注弹窗（受控）：多行输入 + 确认 loading。
 *
 * 状态与提交逻辑（confirmNote）留在 ResumesPage，经 props 回传。
 */
import { Input, Modal } from "antd";
import { MaxLengthHint } from "../../components/common/MaxLengthHint";
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

export default function ResumeNoteModal({
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
      title={t("resumesPage.note.title")}
      open={open}
      okText={t("common.action.save")}
      confirmLoading={confirmLoading}
      onCancel={onCancel}
      onOk={onOk}
    >
      <Input.TextArea
        value={value}
        maxLength={2000}
        rows={4}
        placeholder={t("resumesPage.note.placeholder")}
        onChange={(event) => onChange(event.target.value)}
      />
      <MaxLengthHint value={value} maxLength={2000} />
    </Modal>
  );
}
