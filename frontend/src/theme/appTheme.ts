// SPDX-License-Identifier: Apache-2.0
import type { ThemeConfig } from "antd";
import { layer, palette } from "./tokens";

/** Shared by the production root and browser accessibility checks. */
export const appTheme: ThemeConfig = {
  token: {
    // 层级基准：投投族（3400+）靠它压住 antd 的 Modal/Drawer 容器链。
    // 以前由 ThemeProvider 拼在 token 外面；深色改用独立 darkTheme 后，
    // 两套主题各自持有同一个基准值，ThemeProvider 才能直接 `theme={...}`。
    zIndexPopupBase: layer.popupBase,
    colorPrimary: palette.brand,
    colorText: palette.textBody,
    colorTextHeading: palette.brand,
    colorTextDescription: palette.textSecondary,
    colorTextSecondary: palette.textSecondary,
    colorTextTertiary: palette.textTertiary,
    colorTextPlaceholder: palette.textTertiary,
    colorLink: palette.link,
    // Preserve the original success/warning seeds and their light derived surfaces.
    // Text contrast colors belong on text, not on the palette generator's input.
    colorError: palette.error,
    colorInfo: palette.link,
    colorBorderSecondary: palette.border,
    borderRadius: 8,
    controlHeight: 40,
    fontSize: 14,
    lineHeight: 1.6,
    motionDurationFast: "0.15s",
    motionDurationMid: "0.18s",
    motionDurationSlow: "0.2s",
    motionEaseInOut: "ease-in-out",
  },
  components: {
    Button: { primaryShadow: "0 2px 4px rgb(22 54 92 / 12%)" },
    Card: { headerFontSize: 16, headerHeight: 56, borderRadiusLG: 16 },
    Table: {
      headerBg: palette.surfaceAlt,
      headerColor: palette.brand,
      rowHoverBg: palette.brandWash,
    },
    Menu: { itemSelectedBg: palette.brandTint, itemSelectedColor: palette.brand },
    // Select 下拉"当前选中项"的底色：antd 默认取 controlItemBgActive（= colorPrimaryBg），
    // 而本主题品牌色 #16365c 过深过灰，antd 调色板对其算出的 colorPrimaryBg 是 #92989c
    // 中灰——下拉里的选中项就成了深灰底，与浅色表单反差刺眼（2026 用户截图反馈）。
    // 对齐上方 Menu 的做法：品牌浅 tint 底 + 品牌深色字。这是全局 token，一处修复全站
    // 生效（含编辑配置记录弹窗与受控浏览器设置等所有 Select）。
    Select: { optionSelectedBg: palette.brandTint, optionSelectedColor: palette.brand },
  },
};
