// SPDX-License-Identifier: Apache-2.0
/**
 * 地址条：`Input.Search` 一体（输入框 + 附着的「打开目标页」），历史网址收进输入框内的时钟图标。
 *
 * ## 为什么历史不再是一颗独立按钮
 *
 * 它此前和「打开目标页」并排，两颗按钮 + 状态区 + 刷新 + 更多挤成一行；历史是"偶尔回头
 * 找一条"，不该和主操作争同一行。收进 suffix 的时钟图标后，这一行只剩输入框与它自己
 * 那颗动作按钮，360px 宽也不会折行。
 *
 * ## 主按钮只有一颗
 *
 * 有网址时这颗附着按钮是 primary（「打开目标页」）；没网址时它是 default 且禁用，
 * 主按钮让给工具条的「开启专用浏览器」。两者不并存（见 `Workbar`）。
 *
 * ## 历史菜单的限高
 *
 * 自绘容器仍是**唯一**滚动层（内层菜单 `overflow: visible` 的兜底在 `modules-webform.css`）。
 * 限高从固定的 360px 改成 `min(360px, 60vh)`（在 `styles/webform-onboarding.css`）：
 * 360×420 的窄窗里固定 360px 会顶到窗口下沿，最后几条被裁掉。
 */
import { App } from "antd";
import { ClockCircleOutlined, DeleteOutlined, LinkOutlined } from "@ant-design/icons";
import { Button, Dropdown, Input, Tooltip, Typography, theme } from "antd";
import type { MenuProps } from "antd";
import type { WebFormUrlHistory } from "../../types";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

interface Props {
  value: string;
  history: WebFormUrlHistory[];
  busy: boolean;
  /** 浏览器是否在运行：运行中即使还没输入网址，这颗附着按钮仍是主操作位。 */
  running: boolean;
  onChange: (value: string) => void;
  onOpen: () => void;
  onSelectHistory: (item: WebFormUrlHistory) => void;
  onDeleteHistory: (item: WebFormUrlHistory) => void;
}

export default function WebFormBrowserUrlBar({
  value,
  history,
  busy,
  running,
  onChange,
  onOpen,
  onSelectHistory,
  onDeleteHistory,
}: Props) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后这一块不重渲染。
  useLocale();
  const { modal } = App.useApp();
  const { token } = theme.useToken();
  const hasUrl = value.trim().length > 0;
  // 点击「打开目标页」后提示就该收掉，而不是等鼠标移开才消失（受控开关）。
  // 删除确认走全局 modal：此前每条历史一个 Popconfirm，几十条历史会挂几十个弹层
  // 触发器，页面滚动时逐个做定位计算，整页滚动明显卡顿。
  const confirmDelete = (item: WebFormUrlHistory) => {
    modal.confirm({
      title: t("webFormPage.urlBar.confirmDeleteTitle"),
      okText: t("common.action.delete"),
      cancelText: t("common.action.cancel"),
      okButtonProps: { danger: true },
      onOk: () => onDeleteHistory(item),
    });
  };
  const items: MenuProps["items"] = history.map((item) => ({
    key: String(item.id),
    label: (
      <div className="webform-history-item" onClick={() => onSelectHistory(item)}>
        {/* 原生 title 提示完整网址：ellipsis 的受控 Tooltip 同样是每条一个触发器，几十条时滚动成本高。 */}
        <Typography.Text ellipsis style={{ width: 300 }} title={item.url}>
          {item.title || item.url}
        </Typography.Text>
        {/* 阻止冒泡：删除不应顺带选中这条网址。 */}
        <Button
          type="text"
          size="small"
          danger
          icon={<DeleteOutlined />}
          aria-label={t("webFormPage.urlBar.deleteAria", { url: item.url })}
          onClick={(event) => {
            event.stopPropagation();
            confirmDelete(item);
          }}
        />
      </div>
    ),
  }));

  return (
    <Input.Search
      className="webform-url-input"
      value={value}
      prefix={<LinkOutlined />}
      suffix={
        <Dropdown
          trigger={["click"]}
          disabled={busy || history.length === 0}
          menu={{ items, disabled: busy || history.length === 0 }}
          // 历史可能攒几十条：菜单自绘成限高滚动容器（外观取 token，限高在页面样式里）。
          // 1. 自定义容器会取代默认浮层的外观——背景/圆角/边框/阴影必须自己补齐，
          //    否则白底直接贴在页面上没有浮层感；
          // 2. 滚动只留外层这一条（内层菜单的 overflow 兜底在 modules-webform.css），
          //    内层再滚会出现双滚动条（2026 用户反馈）。
          popupRender={(menuNode) => (
            <div
              className="webform-history-popup"
              style={{
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
          <Tooltip title={t("webFormPage.urlBar.history")}>
            {/* 时钟图标只是历史入口：点它不提交，输入框的 Enter / 附着按钮才是提交。 */}
            <Button
              type="text"
              size="small"
              icon={<ClockCircleOutlined />}
              aria-label={t("webFormPage.urlBar.history")}
              disabled={busy || history.length === 0}
            />
          </Tooltip>
        </Dropdown>
      }
      placeholder={t("webFormPage.urlBar.placeholder")}
      onChange={(event) => onChange(event.target.value)}
      onSearch={() => onOpen()}
      enterButton={
        <Button
          type={hasUrl || running ? "primary" : "default"}
          loading={busy}
          disabled={busy || !hasUrl}
        >
          {t("webFormPage.urlBar.open")}
        </Button>
      }
      aria-label={t("webFormPage.urlBar.inputAria")}
    />
  );
}
