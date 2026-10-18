/**
 * 语义设计 token（RF-12：克制的设计体系）。
 *
 * 颜色、间距与层级的共享出口。主题在 appTheme.ts 组装，CSS 变量在
 * design-tokens.css 同步维护；文字色需要同时检查白底和应用浅底的对比度。
 *
 * 弹层层级（`layer`）以 `zIndexPopupBase: 3100` 为基准。注意 antd 6 的 useZIndex
 * 会给 Modal/Drawer 再加 +100 容器偏移（Drawer 内的 Modal 经 ZIndexContext 继承后
 * 再 +100，即实际 3200/3300），投投整族因此整体压在容器链之上——有 Modal
 * 弹出时悬浮球与投投卡片仍可用。ResumeDetailPreview、TouTouOrb 的测试钉着
 * 3100/3700。
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
  textTertiary: "#626f7f",
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
  /** Text-bearing semantic states, including light alert backgrounds. */
  success: "#176b41",
  warning: "#875300",
  error: "#b42318",
  textBody: "#223047",
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
 * 弹层层级：3100 基准 + 投投整族。
 *
 * antd 6 容器链的实际高度（useZIndex）：单层 Modal/Drawer = popupBase+100 = 3200，
 * Drawer 内嵌 Modal = popupBase+200 = 3300，再嵌一层 +100。这正是 2026-10 用户
 * 截图「岗位广场详情弹窗盖住剪贴板卡」的根因——旧值 clipboardCard=3300 与
 * Drawer 内 Modal 同层，门户后 DOM 顺序靠后的 Modal 胜出。投投三卡因此全部
 * 抬到容器链之上：助手卡 3400 > 三层容器链（3400 为病态上限，仅两层内的
 * 嵌套被保证）。message（+1010=4110）/notification（+1050=4150）仍高于整个
 * 投投族——toast 不被卡片遮挡，几何上也互不重叠（toast 顶部、卡片底部）。
 *
 * 梯度：悬浮球 tip3700＞球3650＞卡内弹层3550＞剪贴板3500＞保存卡3450（壳内
 * 地标，不参与全局排序）＞助手3400；ResumeEditorModal 3110 盖在旧语义的宿主
 * 弹窗之上（其打开场景无并存容器，见 ResumeEditorModal.tsx 注释）。
 * 剪贴板卡刻意压在助手卡之上：两卡同时弹出时剪贴板不能被大尺寸的助手卡盖住。
 */
export const layer = {
  /** antd ConfigProvider zIndexPopupBase：confirm/message/dropdown/Modal 的基准。 */
  popupBase: 3100,
  /** 简历编辑器 Modal：盖在打开它的宿主弹窗之上（打开时无并存容器）。 */
  editorModal: 3110,
  /** 投投助手卡片。高于 antd 6 容器链两层（3200/3300）。 */
  assistantCard: 3400,
  /** 投投资料保存卡（.tt-shell 壳内地标，不参与全局排序）。 */
  saveCard: 3450,
  /** 投投剪贴板卡片（两卡同开时压在助手卡之上；高于三层容器链）。 */
  clipboardCard: 3500,
  /**
   * 投投卡片内弹出层（下拉 / Select / Tooltip / 图片预览 / 二次确认）的基准。
   * antd 各弹层组件在 zIndexPopupBase 之上还有 +50~+80 的自身偏移，全局基准
   * （3100）抬不满卡片的高度——弹层从卡片里挂到 body 后会被卡片盖住，看起来
   * 就是"菜单被裁掉"。这里把卡片内弹层的基准抬到剪贴板卡（3500）之上、
   * 悬浮球（3650）之下：由投投两张卡各自的局部 ConfigProvider 注入。
   */
  cardPopup: 3550,
  /** 投投悬浮球。 */
  orb: 3650,
  /** 悬浮球身 Tooltip 的例外抬层（高于球身）。 */
  orbTooltip: 3700,
  /**
   * 全局 AI 润色的按钮与卡片。必须盖住**承载输入框的那一层**：简历编辑器 3110、
   * 单层 Modal/Drawer 3200、Drawer 内嵌 Modal 3300——否则按钮会被它正要服务的那张
   * 弹窗盖住。取投投族最高层（orbTooltip 3700）+10；仍低于 antd message（4110）
   * 与 notification（4150），toast 照常压在上面。
   */
  aiPolish: 3710,
} as const;
