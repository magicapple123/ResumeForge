// SPDX-License-Identifier: Apache-2.0
/** 助手消息多选工具条。 */

import { DeleteOutlined, CloseOutlined } from "@ant-design/icons";
import { App, Button, Space, Typography } from "antd";
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
              // 删除后果的唯一出处是 common.note.hardDelete（语言包），这里只做拼接。
              content: t("assistantUi.selectBar.confirm.content", {
                count: selectedCount,
                note: t("common.note.hardDelete"),
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
