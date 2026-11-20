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
 * ## 不渲染 vs 隐藏
 *
 * `Input.Search` 在 antd v6 里**无条件**渲染 enterButton（`es/input/Search.js`），
 * `enterButton={undefined}` 会落回默认的放大镜按钮：图标语义是"搜索"、行为却是"打开
 * 目标页"，且没有 aria-label。所以 `showOpenButton=false` 时这里换成裸 `Input`
 * 自己接 `onPressEnter`，**彻底不渲染**那颗按钮；用 CSS 藏只会把它留在焦点序与
 * 无障碍树里。
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
import type { ChangeEvent } from "react";
import type { WebFormUrlHistory } from "../../types";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

interface Props {
  value: string;
  history: WebFormUrlHistory[];
  busy: boolean;
  /** 浏览器是否在运行：运行中即使还没输入网址，这颗附着按钮仍是主操作位。 */
  running: boolean;
  /**
   * 是否渲染附着的「打开目标页」。onboarding 态的主 CTA 只放在流程轨道右端（I-24），
   * 这里再画一颗同名的 primary 就会变成"同屏两个主按钮"。回车（`onSearch`）仍然可用。
   */
  showOpenButton?: boolean;
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
  showOpenButton = true,
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

  const historySuffix = (
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
  );
  const sharedProps = {
    className: "webform-url-input",
    value,
    prefix: <LinkOutlined />,
    suffix: historySuffix,
    placeholder: t("webFormPage.urlBar.placeholder"),
    onChange: (event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value),
    "aria-label": t("webFormPage.urlBar.inputAria"),
  };

  // `showOpenButton=false` 时必须**换控件**而不是把 `enterButton` 传空：
  // antd v6 的 `Input.Search` 无条件渲染 enterButton（`es/input/Search.js`），
  // 传 `undefined` 仍会落回默认的放大镜 `<Button icon={<SearchOutlined/>}/>`——
  // 图标语义是"搜索"、行为却是"打开目标页"，还没有 aria-label。用 CSS 藏也不行：
  // 按钮仍在焦点序与无障碍树里。所以这一态直接用裸 `Input`，回车照样提交。
  if (!showOpenButton) {
    return <Input {...sharedProps} onPressEnter={() => onOpen()} />;
  }

  return (
    <Input.Search
      {...sharedProps}
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
    />
  );
}
