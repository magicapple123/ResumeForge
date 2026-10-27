// SPDX-License-Identifier: Apache-2.0
/**
 * 新建数据集弹窗（受控）：输入名称 + 确认 loading。
 *
 * 状态与提交逻辑（createDataset、切换询问）留在 AppHeaderContext，经 props 回传；
 * 这里只负责把"数据集是什么、名字有什么限制"说清楚，避免用户把它当成文件夹。
 */
import { Input, Modal, Typography } from "antd";
import { t } from "../i18n";
import { useLocale } from "../i18n/i18nContext";

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
  useLocale();
  return (
    <Modal
      title={t("componentsMisc.datasetCreate.title")}
      open={open}
      okText={t("componentsMisc.datasetCreate.create")}
      confirmLoading={confirmLoading}
      onCancel={onCancel}
      onOk={onOk}
      destroyOnHidden
    >
      <Typography.Paragraph type="secondary">
        {t("componentsMisc.datasetCreate.intro")}
      </Typography.Paragraph>
      <Input
        value={value}
        maxLength={64}
        showCount
        autoFocus
        placeholder={t("componentsMisc.datasetCreate.namePlaceholder")}
        aria-label={t("componentsMisc.datasetCreate.nameAria")}
        onChange={(event) => onChange(event.target.value)}
        onPressEnter={onOk}
      />
    </Modal>
  );
}
