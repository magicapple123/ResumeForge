// SPDX-License-Identifier: Apache-2.0
/** 助手消息多选工具条。 */

import { DeleteOutlined, CloseOutlined } from "@ant-design/icons";
import { App, Button, Space, Typography } from "antd";
import { HARD_DELETE_NOTE } from "../../../components/common/rowActionMenu";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";

interface Props {
  disabled: boolean;
  onDelete: () => Promise<void>;
  onExit: () => void;
  selectedCount: number;
}

export default function AssistantSelectBar({ disabled, onDelete, onExit, selectedCount }: Props) {
  useLocale();
  const { modal } = App.useApp();
  return (
    <div className="assistant-select-bar">
      <Typography.Text type="secondary">
        {t("assistantUi.selectBar.selected", { count: selectedCount })}
      </Typography.Text>
      <Space size={8}>
        <Button
          danger
          size="small"
          icon={<DeleteOutlined />}
          disabled={disabled}
          onClick={() =>
            modal.confirm({
              title: t("assistantUi.selectBar.confirm.title"),
              // HARD_DELETE_NOTE 是删除后果的唯一出口；迁出语言包前先按原文拼接。
              content: t("assistantUi.selectBar.confirm.content", {
                count: selectedCount,
                note: HARD_DELETE_NOTE,
              }),
              okText: t("common.action.delete"),
              okButtonProps: { danger: true },
              cancelText: t("common.action.cancel"),
              onOk: onDelete,
            })
          }
        >
          {t("assistantUi.selectBar.deleteSelected")}
        </Button>
        <Button size="small" icon={<CloseOutlined />} onClick={onExit}>
          {t("assistantUi.selectBar.exit")}
        </Button>
      </Space>
    </div>
  );
}
