// SPDX-License-Identifier: Apache-2.0
/**
 * 页头主题切换（A3）：三档图标 —— 浅色 / 深色 / 跟随系统。
 *
 * 为什么放在页头而不是设置页：主题是"随时想调一下"的显示偏好，埋进设置页要多点两层；
 * R21 的模型选择器与全站搜索图标下掉后，页头右侧正好留出这三个图标的位置。
 *
 * 选中档用**实心图标**、其余用描边：只靠 Segmented 的浅底选中态，在深色下对比不够，
 * 图标形态本身也要能表达"当前是哪一档"。没有 `DesktopFilled` 图标，跟随系统那一档
 * 用同风格的内联 SVG（`currentColor`，不引入硬编码颜色）。
 *
 * 状态仍只有 `themeStore` 一个来源（localStorage + 服务端持久化），本组件不持有状态。
 *
 * 切档时走 `themeTransition`：支持 View Transitions 的浏览器会把新主题从这颗控件的中心
 * 圆形扩散出来（WF-09），不支持的（含 jsdom、reduced-motion）直接切。
 */
import {
  DesktopOutlined,
  MoonFilled,
  MoonOutlined,
  SunFilled,
  SunOutlined,
} from "@ant-design/icons";
import { Segmented } from "antd";
import { useRef } from "react";
import { resolveTheme, setThemeMode, useThemeMode, type ThemeMode } from "./themeStore";
import { startThemeTransition, themeSwitchOrigin } from "./themeTransition";
import { t, type MessageKey } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

const OPTIONS: { value: ThemeMode; labelKey: MessageKey }[] = [
  { value: "light", labelKey: "componentsMisc.theme.light" },
  { value: "dark", labelKey: "componentsMisc.theme.dark" },
  { value: "system", labelKey: "componentsMisc.theme.system" },
];

/** 实心的"显示器"图标：antd 只有 DesktopOutlined，跟随系统这一档需要实心态。 */
function DesktopFilledIcon() {
  return (
    <svg
      viewBox="0 0 1024 1024"
      width="1em"
      height="1em"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M128 128h768a64 64 0 0 1 64 64v480a64 64 0 0 1-64 64H576v96h160a32 32 0 0 1 0 64H288a32 32 0 0 1 0-64h160v-96H128a64 64 0 0 1-64-64V192a64 64 0 0 1 64-64z" />
    </svg>
  );
}

function iconFor(value: ThemeMode, selected: boolean) {
  if (value === "light") return selected ? <SunFilled /> : <SunOutlined />;
  if (value === "dark") return selected ? <MoonFilled /> : <MoonOutlined />;
  return selected ? <DesktopFilledIcon /> : <DesktopOutlined />;
}

export default function ThemeSwitch() {
  useLocale();
  const mode = useThemeMode();
  // 圆形扩散的圆心取这颗 Segmented 的中心（WF-09）：主题从哪里点，就从哪里长出来。
  const rootRef = useRef<HTMLDivElement>(null);

  const change = (value: ThemeMode) => {
    const next = resolveTheme(value);
    // 解析结果没变（例如"跟随系统"解析出来还是当前主题）就不播动画：
    // 快照一模一样的一段扩散只会让用户以为点错了。
    if (next === document.documentElement.dataset.theme) {
      setThemeMode(value);
      return;
    }
    startThemeTransition(next, themeSwitchOrigin(rootRef.current), () => setThemeMode(value));
  };

  return (
    <Segmented<ThemeMode>
      ref={rootRef}
      aria-label={t("componentsMisc.theme.label")}
      className="app-theme-switch"
      value={mode}
      onChange={change}
      options={OPTIONS.map(({ value, labelKey }) => {
        const label = t(labelKey);
        return {
          value,
          tooltip: label,
          label: (
            <span
              className="app-theme-switch-icon"
              role="img"
              aria-label={label}
              title={label}
              data-filled={mode === value ? "true" : "false"}
            >
              {iconFor(value, mode === value)}
            </span>
          ),
        };
      })}
    />
  );
}
