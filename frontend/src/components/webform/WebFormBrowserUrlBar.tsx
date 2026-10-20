// SPDX-License-Identifier: Apache-2.0
import { App } from "antd";
import { DeleteOutlined, LinkOutlined } from "@ant-design/icons";
import { Button, Dropdown, Input, Space, Tooltip, Typography, theme } from "antd";
import type { MenuProps } from "antd";
import { useState } from "react";
import type { WebFormUrlHistory } from "../../types";

interface Props {
  value: string;
  history: WebFormUrlHistory[];
  busy: boolean;
  onChange: (value: string) => void;
  onOpen: () => void;
  onSelectHistory: (item: WebFormUrlHistory) => void;
  onDeleteHistory: (item: WebFormUrlHistory) => void;
}

export default function WebFormBrowserUrlBar({
  value,
  history,
  busy,
  onChange,
  onOpen,
  onSelectHistory,
  onDeleteHistory,
}: Props) {
  const { modal } = App.useApp();
  const { token } = theme.useToken();
  // 点击「打开目标页」后提示就该收掉，而不是等鼠标移开才消失（受控开关）。
  const [openTip, setOpenTip] = useState(false);
  // 删除确认走全局 modal：此前每条历史一个 Popconfirm，几十条历史会挂几十个弹层
  // 触发器，页面滚动时逐个做定位计算，整页滚动明显卡顿。
  const confirmDelete = (item: WebFormUrlHistory) => {
    modal.confirm({
      title: "删除这条历史网址？",
      okText: "删除",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: () => onDeleteHistory(item),
    });
  };
  const items: MenuProps["items"] = history.map((item) => ({
    key: String(item.id),
    label: (
      <Space style={{ maxWidth: 420 }} onClick={() => onSelectHistory(item)}>
        {/* 原生 title 提示完整网址：ellipsis 的受控 Tooltip 同样是每条一个触发器，几十条时滚动成本高。 */}
        <Typography.Text ellipsis style={{ width: 330 }} title={item.url}>
          {item.title || item.url}
        </Typography.Text>
        {/* 阻止冒泡：删除不应顺带选中这条网址。 */}
        <Button
          type="text"
          size="small"
          danger
          icon={<DeleteOutlined />}
          aria-label={`删除网址 ${item.url}`}
          onClick={(event) => {
            event.stopPropagation();
            confirmDelete(item);
          }}
        />
      </Space>
    ),
  }));

  return (
    <div className="webform-url-bar">
      <Input
        className="webform-url-input"
        value={value}
        prefix={<LinkOutlined />}
        placeholder="输入要填写网申的目标网址（http:// 或 https://）"
        onChange={(event) => onChange(event.target.value)}
        onPressEnter={onOpen}
        aria-label="网申投递网址"
      />
      <Space className="webform-url-actions" size={8} wrap>
        <Tooltip
          open={openTip}
          onOpenChange={setOpenTip}
          title="在网申专用浏览器中打开，不会覆盖已有网页"
        >
          <span onClick={() => setOpenTip(false)}>
            <Button type="primary" loading={busy} disabled={busy} onClick={onOpen}>
              打开目标页
            </Button>
          </span>
        </Tooltip>
        {/* 历史可能攒几十条：菜单限高滚动，不让整屏被占满。
            menu.styles.list 在 antd 6 实测不生效（菜单仍全高），改用 popupRender
            包一层限高滚动容器。注意两点（2026 用户反馈修复）：
            1. 自定义容器会取代默认浮层的外观——背景/圆角/边框/阴影必须自己补齐，
               否则白底直接贴在页面上没有浮层感；
            2. 滚动只留外层这一条（.webform-history-popup 的 CSS 强制内层菜单
               overflow visible），内层再滚会出现双滚动条。 */}
        <Dropdown
          menu={{
            items,
            disabled: busy || history.length === 0,
          }}
          trigger={["click"]}
          popupRender={(menuNode) => (
            <div
              className="webform-history-popup"
              style={{
                maxHeight: 360,
                overflowY: "auto",
                background: token.colorBgElevated,
                borderRadius: token.borderRadiusLG,
                border: `1px solid ${token.colorBorderSecondary}`,
                boxShadow: token.boxShadowSecondary,
              }}
            >
              {menuNode}
            </div>
          )}
        >
          <Button disabled={busy || history.length === 0}>历史网址</Button>
        </Dropdown>
      </Space>
    </div>
  );
}
