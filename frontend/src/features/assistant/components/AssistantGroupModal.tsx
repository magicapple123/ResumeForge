// SPDX-License-Identifier: Apache-2.0
/** 助手会话分组编辑弹窗。 */

import { Input, Modal, Typography } from "antd";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";

interface Props {
  onChange: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
  open: boolean;
  value: string;
}

export default function AssistantGroupModal({ onChange, onClose, onConfirm, open, value }: Props) {
  useLocale();
  return (
    <Modal
      title={t("assistantUi.group.move")}
      open={open}
      okText={t("common.action.save")}
      onCancel={onClose}
      onOk={onConfirm}
    >
      <Typography.Paragraph type="secondary">
        {t("assistantUi.group.description")}
      </Typography.Paragraph>
      <Input
        value={value}
        maxLength={64}
        placeholder={t("assistantUi.group.placeholder")}
        onChange={(event) => onChange(event.target.value)}
      />
    </Modal>
  );
}
