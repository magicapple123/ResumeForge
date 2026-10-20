// SPDX-License-Identifier: Apache-2.0
/**
 * 深色主题（A2）：与 `appTheme.ts` 并列的第二套 `ThemeConfig`。
 *
 * 为什么必须是**独立的 ThemeConfig**，而不是"浅色 token + darkAlgorithm"：
 * antd 的 `token` 覆盖发生在算法之后——此前 `ThemeProvider` 把 `appTheme.token`
 * （`colorText: #223047`、`colorTextHeading: #16365c`、`colorLink: #0958d9`）
 * 盖在 `darkAlgorithm` 的结果上，深色下正文对比度只有 1.3:1，标题几乎不可见。
 * 深色需要的是"另一套 token 值"，不是一个滤镜。
 *
 * 与浅色的契约：
 *  - 几何（圆角、控件高度、字号、行高、动效时长）与浅色完全一致，只换颜色；
 *  - `zIndexPopupBase` 必须与浅色同值（`layer.popupBase`），否则弹层与投投族的
 *    层级梯度会整体错位（见 `tokens.ts` 的长注释）；
 *  - 其余颜色交给 `darkAlgorithm` 派生，**不再写死** `#232833` 这类旧值。
 *
 * CSS 侧（`dark-tokens.css`）与这里共享同一组表面色，改色时两边一起改。
 */
import { theme as antdTheme, type ThemeConfig } from "antd";
import { layer } from "./tokens";

/**
 * 深色表面阶梯（四档）与文字三档。
 *
 * 旧版深色只有两档表面（`#1b1f27` / `#15181e`），卡片、页头、侧栏几乎同色，
 * 视觉上"糊成一块"。这版补齐"页面底 < 次级面 < 卡片面 < 浮起面"的层次。
 */
export const darkPalette = {
  /** 页面底：layout / body。 */
  page: "#14171c",
  /** 卡片面：Card / Table / Modal 容器。 */
  surface: "#1a1e24",
  /** 次级面：侧栏、页头、表头、页脚。 */
  surfaceAlt: "#15181d",
  /** 浮起面：下拉、Tooltip、Popover。 */
  surfaceElevated: "#22272f",
  /** 外壳（页头/侧栏）专用底色：比次级面再深一点点，压住边界。 */
  shell: "#171a20",
  /** 正文。 */
  textBody: "#e8ecf2",
  /** 次级文字（说明、发布时间）。 */
  textSecondary: "#aab5c4",
  /** 三级文字（caption、占位符）。 */
  textTertiary: "#909bab",
  /** 品牌文字（标题、品牌强调）。 */
  brandText: "#9dc3ef",
  /** 主按钮底（承载白字，5.2:1）。 */
  primary: "#2f6fb3",
  /** 链接。 */
  link: "#8fc0f0",
  /** 常规边框。 */
  border: "#2a2f37",
  /** 更浅的边框/分隔线。 */
  borderSubtle: "#262b33",
  /** 选中项底色（Menu / Select）：比卡片面亮一档的蓝灰。 */
  selectedBg: "#1e2836",
  /** 选中项文字。 */
  selectedText: "#a9cdf3",
  /** 表头底色。 */
  tableHeaderBg: "#20252c",
  /** 表头文字。 */
  tableHeaderText: "#cfd8e6",
  /** 表格行悬停底色。 */
  rowHoverBg: "#1f2833",
  /** 浮层（Tooltip）底色。 */
  spotlight: "#2a2f37",
  /** 收藏星标：亮琥珀，深底上才看得见。 */
  favorite: "#f0c04a",
} as const;

export const darkTheme: ThemeConfig = {
  // 深色必须从算法出发：`colorBgElevated`、`colorFillAlter`、Tag/Alert 的语义底
  // 都由它派生。手写覆盖只补算法算不出"本产品想要的层次"的那几档。
  algorithm: antdTheme.darkAlgorithm,
  token: {
    colorPrimary: darkPalette.primary,
    colorLink: darkPalette.link,
    colorText: darkPalette.textBody,
    colorTextBase: darkPalette.textBody,
    colorTextHeading: darkPalette.brandText,
    colorTextDescription: darkPalette.textSecondary,
    colorTextSecondary: darkPalette.textSecondary,
    colorTextTertiary: darkPalette.textTertiary,
    colorTextPlaceholder: darkPalette.textTertiary,
    colorBorderSecondary: darkPalette.border,
    // 表面阶梯：页面底 / 卡片面 / 浮起面。三个都显式给，才能保证 Card、Table、
    // Modal 容器、下拉、Tooltip 落在不同的亮度上。
    colorBgLayout: darkPalette.page,
    colorBgContainer: darkPalette.surface,
    colorBgElevated: darkPalette.surfaceElevated,
    colorBgSpotlight: darkPalette.surfaceElevated,
    // 几何：与浅色逐项一致（只换颜色，不改排版）。
    borderRadius: 8,
    controlHeight: 40,
    fontSize: 14,
    lineHeight: 1.6,
    motionDurationFast: "0.15s",
    motionDurationMid: "0.18s",
    motionDurationSlow: "0.2s",
    motionEaseInOut: "ease-in-out",
    // 层级基准必须与浅色同值：投投族（3400+）依赖这个基准来压住容器链。
    zIndexPopupBase: layer.popupBase,
  },
  components: {
    Button: { primaryShadow: "0 2px 4px rgb(0 0 0 / 30%)" },
    Card: { headerFontSize: 16, headerHeight: 56, borderRadiusLG: 16 },
    Table: {
      headerBg: darkPalette.tableHeaderBg,
      headerColor: darkPalette.tableHeaderText,
      rowHoverBg: darkPalette.rowHoverBg,
      borderColor: darkPalette.border,
    },
    Menu: {
      itemSelectedBg: darkPalette.selectedBg,
      itemSelectedColor: darkPalette.selectedText,
    },
    // 与浅色同一处修复（见 appTheme.ts 注释）：antd 默认取 controlItemBgActive，
    // 在深色下会算成一块与表单反差刺眼的灰，这里显式给"蓝灰底 + 浅蓝字"。
    Select: {
      optionSelectedBg: darkPalette.selectedBg,
      optionSelectedColor: darkPalette.selectedText,
    },
    Tooltip: { colorBgSpotlight: darkPalette.spotlight },
  },
};
