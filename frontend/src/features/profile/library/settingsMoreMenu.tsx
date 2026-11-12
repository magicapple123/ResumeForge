// SPDX-License-Identifier: Apache-2.0
/**
 * 列表行尾的「⋯」动作菜单（方案 / 板块 / 字段三层共用）。
 *
 * 为什么要有这一层：三层此前把 2–4 个图标平铺在行尾，删除是红色实心图标且紧邻
 * 「字段设置」，误点风险高（问题 18 的 C 段）。收进菜单后每行常驻动作只剩「行首选择 +
 * ⋯」两个，删除也不再靠颜色吸引误触。
 *
 * 删除的二次确认**不在这里**做：菜单项只负责把行切到内联确认条（宿主状态），
 * 因为宿主是 `*Modal.tsx`，弹层文件内禁止再开 `modal.confirm`（popupStackGuard）。
 */
import { Button, Dropdown } from "antd";
import type { MenuProps } from "antd";
import { MoreOutlined } from "@ant-design/icons";

export interface SettingsMenuAction {
  key: string;
  /** 菜单项文字：写清对象与结果（「重命名这个板块」），不用「编辑」这类空动词。 */
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

interface Props {
  /** 无障碍名（每层各不相同，避免一屏多个同名按钮）。 */
  label: string;
  actions: SettingsMenuAction[];
  disabled?: boolean;
}

export default function SettingsMoreMenu({ label, actions, disabled = false }: Props) {
  const items: MenuProps["items"] = actions.map((action) => ({
    key: action.key,
    label: action.label,
    danger: action.danger,
    disabled: action.disabled,
  }));

  const handleClick: MenuProps["onClick"] = ({ key }) => {
    actions.find((action) => action.key === key)?.onSelect();
  };

  return (
    <Dropdown
      menu={{ items, onClick: handleClick }}
      trigger={["click"]}
      placement="bottomRight"
      disabled={disabled}
    >
      <Button
        className="profile-settings-action"
        type="text"
        size="small"
        icon={<MoreOutlined />}
        aria-label={label}
        disabled={disabled || undefined}
      />
    </Dropdown>
  );
}
