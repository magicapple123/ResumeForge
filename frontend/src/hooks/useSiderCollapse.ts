// SPDX-License-Identifier: Apache-2.0
/**
 * 左侧导航的**手动折叠**状态（桌面档）。
 *
 * 与 `useResponsiveShell` 的分工：那个回答"窗口窄到必须折叠"，这里回答"用户自己想不想
 * 收起"。两者取或：窄档一定折叠（64px 是 CSS 断点给的，展开也没地方写字），宽档才轮得到
 * 用户选择。状态存 localStorage，刷新/重开应用保持——侧栏宽度是工作习惯，不该每次重设。
 *
 * 为什么不用 antd Sider 的受控 `collapsed` + `onCollapse`：那套是"受控组件自己管自己"，
 * 而宽度真相在 CSS 变量里；这里只暴露一个布尔，Sider 的 `width` / `collapsedWidth` 与
 * `.app-main` 的左边距仍读同一个变量（见 theme/design-tokens.css）。
 */
import { useCallback, useState } from "react";

const STORAGE_KEY = "rf_sider_collapsed";

function readStored(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    // 隐私模式 / 存储被禁用：默认展开，不因为读不到偏好就折叠。
    return false;
  }
}

export function useSiderCollapse(): { collapsed: boolean; toggle: () => void } {
  const [collapsed, setCollapsed] = useState(readStored);

  const toggle = useCallback(() => {
    setCollapsed((previous) => {
      const next = !previous;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // 写失败只影响下次启动的默认值，不影响本次交互。
      }
      return next;
    });
  }, []);

  return { collapsed, toggle };
}
