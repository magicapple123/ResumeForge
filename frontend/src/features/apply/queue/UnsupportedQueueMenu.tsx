// SPDX-License-Identifier: Apache-2.0
/**
 * 队列里「平台不支持投递」那批的入口：带数量的按钮 + 下拉菜单 + 二次确认。
 *
 * 为什么确认框是受控的（`trigger={[]}`）：菜单项点击要先收起菜单、再弹确认框；
 * 两个浮层各自管自己的开关就会叠在一起。删的是整批记录，删完只能重新采集，所以必须确认。
 */
import { DownOutlined } from "@ant-design/icons";
import { Button, Dropdown, Popconfirm, Space, Typography } from "antd";
import { useState } from "react";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";

export function UnsupportedQueueMenu({
  count,
  busy,
  onRemove,
}: {
  count: number;
  busy: boolean;
  onRemove: () => void;
}) {
  useLocale();
  const [confirmOpen, setConfirmOpen] = useState(false);
  if (count === 0) return null;
  return (
    <Popconfirm
      open={confirmOpen}
      trigger={[]}
      onOpenChange={setConfirmOpen}
      title={t("applyQueue.unsupported.chipTitle", { count })}
      description={t("applyQueue.unsupported.chipBody")}
      okText={t("applyQueue.action.removeShort")}
      cancelText={t("common.action.cancel")}
      okButtonProps={{ danger: true }}
      onConfirm={() => {
        setConfirmOpen(false);
        onRemove();
      }}
    >
      <Dropdown
        trigger={["click"]}
        menu={{
          items: [
            {
              key: "unsupported",
              type: "group",
              label: (
                <Space orientation="vertical" size={2}>
                  <Typography.Text strong>
                    {t("applyQueue.unsupported.chipTitle", { count })}
                  </Typography.Text>
                  <Typography.Text type="secondary">
                    {t("applyQueue.unsupported.chipBody")}
                  </Typography.Text>
                </Space>
              ),
              children: [
                {
                  key: "remove",
                  label: t("applyQueue.action.removeSelected"),
                  danger: true,
                  disabled: busy,
                  onClick: () => setConfirmOpen(true),
                },
              ],
            },
          ],
        }}
      >
        <Button
          icon={<DownOutlined />}
          aria-label={t("applyQueue.unsupported.chip", { count })}
          disabled={busy || undefined}
        >
          {t("applyQueue.unsupported.chip", { count })}
        </Button>
      </Dropdown>
    </Popconfirm>
  );
}
