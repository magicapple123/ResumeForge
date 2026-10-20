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
      // 选中行底色：原先由 `styles/modules.css` 里一条 `!important` 硬压（审计 §P1-3），
      // 现在改由组件 token 表达——深色那套才有自己的选中色，不再被浅色 tint 蒙住。
      rowSelectedBg: palette.brandTint,
      rowSelectedHoverBg: palette.brandTint,
    },
    Menu: {
      itemSelectedBg: palette.brandTint,
      itemSelectedColor: palette.brand,
      // 选中条由 antd 的 `::after` 画，原先用 `display: none` 抹掉；token 归零才是正确表达。
      // 注意：`itemHeight` / `itemMarginBlock` / `itemBorderRadius` **故意不迁**——
      // 它们是组件级全局 token，会连带改掉下拉菜单（`QueueTable`）与移动端抽屉
      // （`MobileNavigation`）的菜单项高度（默认 `controlHeightLG` = 50 → 44）。
      // 那两处不在本页的视觉验收范围内，所以尺寸仍留在 `styles/base.css` 的
      // `.app-nav-menu .ant-menu-item`（只作用于侧栏）。
      activeBarBorderWidth: 0,
    },
    /**
     * 弹窗三段（标题条 / 内容 / 页脚）的表面色。
     *
     * 注意 antd 6.6.5 的 `Modal.ComponentToken` 只公开 6 个键（headerBg / titleLineHeight /
     * titleFontSize / titleColor / contentBg / footerBg）——`headerPadding`、
     * `headerBorderBottom`、`footerPadding`、`footerBorderTop`、`bodyPadding` 等只存在于
     * `prepareComponentToken` 的**内部**返回类型里，写进 ThemeConfig 会直接 TS 报错。
     * 所以内边距 / 分隔线仍留在 `styles/modules.css`（那里逐条标了 antd-override 理由）。
     */
    Modal: {
      headerBg: palette.surfaceAlt,
      titleColor: palette.brand,
      titleFontSize: 16,
      contentBg: palette.surface,
      footerBg: palette.surfaceAlt,
    },
    // Select 下拉"当前选中项"的底色：antd 默认取 controlItemBgActive（= colorPrimaryBg），
    // 而本主题品牌色 #16365c 过深过灰，antd 调色板对其算出的 colorPrimaryBg 是 #92989c
    // 中灰——下拉里的选中项就成了深灰底，与浅色表单反差刺眼（2026 用户截图反馈）。
    // 对齐上方 Menu 的做法：品牌浅 tint 底 + 品牌深色字。这是全局 token，一处修复全站
    // 生效（含编辑配置记录弹窗与受控浏览器设置等所有 Select）。
    Select: { optionSelectedBg: palette.brandTint, optionSelectedColor: palette.brand },
  },
};
