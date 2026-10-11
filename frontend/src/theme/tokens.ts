/**
 * 语义设计 token（RF-12：克制的设计体系）。
 *
 * 这里**只收编既有值，不发明新值**：每个常量都来自 main.tsx 的主题、全局 CSS 或
 * 投投/编辑器弹层现用的数字。新增 UI 优先引用这里的 token；存量样式只在色值完全
 * 相同的前提下做机械替换，保证 diff 可审。
 *
 * 弹层层级（`layer`）以 `zIndexPopupBase: 3100` 为基准，整族高于基准——有 Modal
 * 弹出时悬浮球与投投卡片仍可用。**不得改变任何实际渲染值**：ResumeDetailPreview、
 * AssistantComposer、TouTouOrb 的测试分别钉着 3100/3110/3450。
 */

/** 品牌与中性色（来源：main.tsx colorPrimary 与 styles/base.css 现值）。 */
export const palette = {
  /** 品牌色：主按钮、选中态、强调文字。 */
  brand: "#16365c",
  /** 品牌浅底：选中菜单、图标底座。 */
  brandTint: "#eaf1f8",
  /** 品牌极浅底：悬停行。 */
  brandWash: "#f7faff",
  /** 应用底色（侧栏外的主区背景）。 */
  surfaceAlt: "#f6f8fb",
  /** 卡片白。 */
  surface: "#ffffff",
  /** 一级文字（近黑）。 */
  textPrimary: "#16365c",
  /** 二级文字（菜单、正文辅助）。 */
  textSecondary: "#5f6b7a",
  /** 三级文字（caption、版本号）。RF-12 由 #8a94a3 加深到 4.5:1 对比度达标值。 */
  textTertiary: "#6b7683",
  /** 常规边框。 */
  border: "#e7ebf0",
  /** 更浅的边框/分隔线。 */
  borderSubtle: "#e5e7eb",
  /** 危险/错误前景（antd 语义红）。 */
  danger: "#ff4d4f",
  /** 焦点描边（键盘导航可见焦点）。 */
  focusRing: "#91caff",
  /** 链接色：antd 默认 #1677ff 只有 4.1:1，加深到 blue-7 达标。 */
  link: "#0958d9",
} as const;

/** 间距刻度：只允许 4/8 体系（antd 默认 spacing 单位即 8/4）。 */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
} as const;

/** 字号刻度（base.css 现值收编）。 */
export const fontSize = {
  caption: 11,
  small: 12,
  body: 13,
  base: 14,
  subtitle: 16,
  title: 17,
} as const;

/**
 * 弹层层级：3100 基准 + 投投整族。悬浮球 tip3450＞球3400＞助手3300＞
 * 保存卡3250＞剪贴板3200；ResumeEditorModal 3110 盖在宿主 Modal（3100）之上。
 */
export const layer = {
  /** antd ConfigProvider zIndexPopupBase：confirm/message/dropdown/Modal 的基准。 */
  popupBase: 3100,
  /** 简历编辑器 Modal：盖在打开它的宿主弹窗（3100）之上。 */
  editorModal: 3110,
  /** 投投剪贴板卡片。 */
  clipboardCard: 3200,
  /** 投投资料保存卡。 */
  saveCard: 3250,
  /** 投投助手卡片。 */
  assistantCard: 3300,
  /** 投投悬浮球。 */
  orb: 3400,
  /** 悬浮球身 Tooltip 的例外抬层（高于球身）。 */
  orbTooltip: 3450,
} as const;
