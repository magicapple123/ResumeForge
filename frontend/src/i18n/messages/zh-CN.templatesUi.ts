// SPDX-License-Identifier: Apache-2.0
/**
 * 「版式」工作台这一批（内置模板画廊 · 版式编辑器 · 自制版式列表 · 版式预览 ·
 * 可视化调节器 · 工作台卡片）的界面文案。
 *
 * 口径与既有领域包一致：扁平点分 key、一个默认导出、`as const`。文案**逐字**沿用迁移前
 * 组件里的中文，渲染结果不变。不翻译的只剩三类：喂给助手的 prompt（`TemplateWorkbench`
 * 的预填提问）与随模板配置落库的徽章 alt——它们都在组件里就地标了 `i18n-ok`。
 */
const templatesUi = {
  // ── 内置模板缩略图墙（BuiltinStyleGallery）─────────────────────
  /** 缩略图卡片的无障碍名；`label` 是后端下发的内置模板名。 */
  "templatesUi.gallery.thumbAria": "预览「{label}」样式效果",
  /** 缩略图 iframe 的无障碍名（同时被测试用来定位）。 */
  "templatesUi.gallery.thumbTitle": "{label} 样式缩略图",
  /** 大图弹窗标题：没有打开任何一项时的兜底。 */
  "templatesUi.gallery.modalTitle": "内置模板预览",
  /** 大图弹窗标题：带上当前模板名。 */
  "templatesUi.gallery.modalTitleWithLabel": "内置模板预览 · {label}",
  /** 大图弹窗里 A4 画布的无障碍名。 */
  "templatesUi.gallery.previewTitle": "内置模板大图预览",

  // ── 版式编辑器（FormatTemplateEditorModal）──────────────────────
  "templatesUi.formatEditor.title.edit": "编辑版式",
  "templatesUi.formatEditor.title.create": "自制版式",
  "templatesUi.formatEditor.action.save": "保存版式",
  "templatesUi.formatEditor.field.name": "名称",
  "templatesUi.formatEditor.placeholder.name": "如：我的紧凑版式",
  "templatesUi.formatEditor.field.description": "说明（选填）",
  "templatesUi.formatEditor.placeholder.description": "一句话说明它解决什么问题",
  /** 参数没填时的显示值与占位符（颜色项与数值项共用同一条）。 */
  "templatesUi.formatEditor.value.unset": "未设置",
  /** 颜色项旁「回到跟随模板」的按钮。 */
  "templatesUi.formatEditor.action.clear": "清除",
  /** 表单底部的说明：留空的参数不提交。 */
  "templatesUi.formatEditor.hint.blank": "留空表示沿用模板的设置；只有填过的项才会生效。",
  "templatesUi.formatEditor.error.save": "保存失败",
  "templatesUi.formatEditor.toast.needName": "请填写模板名称",
  "templatesUi.formatEditor.toast.needValue": "至少设置一项参数，否则这个版式没有任何效果",
  "templatesUi.formatEditor.toast.updated": "版式已更新",
  "templatesUi.formatEditor.toast.created": "版式已创建，可以在生成或预览简历时选用",

  // ── 自制版式列表（TemplateCustomTable）─────────────────────────
  "templatesUi.table.column.template": "模板",
  /** 行内来源标签：`name` 是复制来源的内置模板名。 */
  "templatesUi.table.source": "来自 {name}",
  "templatesUi.table.noDescription": "（无说明）",
  "templatesUi.table.column.actions": "操作",
  "templatesUi.table.action.preview": "预览效果",
  "templatesUi.table.action.edit": "编辑",
  "templatesUi.table.action.ask": "找助手改这个模板",
  "templatesUi.table.action.delete": "删除",
  /** 删除的二次确认标题：动作 + 对象 + 后果（引用它的简历会退回默认模板）。 */
  "templatesUi.table.confirm.delete": "删除模板「{name}」？引用它的简历会退回默认模板。",

  // ── 版式预览（TemplatePreviewModal）────────────────────────────
  "templatesUi.preview.title": "模板预览",
  "templatesUi.preview.titleWithName": "模板预览 · {name}",
  "templatesUi.preview.fontScale.small": "小字号",
  "templatesUi.preview.fontScale.standard": "标准",
  "templatesUi.preview.fontScale.large": "大字号",
  "templatesUi.preview.followTemplate": "跟随模板",
  /** 预览一律用内置示例简历，这条说明防"以为看到的是自己的内容"。 */
  "templatesUi.preview.demoNote": "预览使用内置示例简历内容",
  "templatesUi.preview.errorTitle": "预览渲染失败",
  "templatesUi.preview.error": "预览失败",

  // ── 可视化调节器（TemplateStyleControls）──────────────────────
  "templatesUi.styleControls.label": "自定义标签 / 图片",
  "templatesUi.styleControls.action.add": "添加",
  "templatesUi.styleControls.action.upload": "上传图片",
  "templatesUi.styleControls.placeholder.label": "标签文字（可留空）",
  /** 选项/数值没设过时沿用的取值。 */
  "templatesUi.styleControls.placeholder.inherit": "沿用模板",
  /** 十六进制输入框的无障碍名；`label` 是这个颜色项的名字。 */
  "templatesUi.styleControls.colorHexAria": "{label}十六进制",
  /** 删除按钮的无障碍名；`count` 从 1 开始。 */
  "templatesUi.styleControls.removeAria": "删除第 {count} 个自定义标签",
  "templatesUi.styleControls.hint":
    "可添加个人品牌、证书、语言或作品标签；图片需为 ≤300 KB 的 PNG / JPG / WEBP，内嵌到模板，不会请求外部地址。",
  "templatesUi.styleControls.error.imageTooLarge":
    "自定义标签图片不能超过 300 KB，请先缩小或压缩图片",
  "templatesUi.styleControls.error.readImage": "读取图片失败",

  // ── 版式工作台（TemplateWorkbench）────────────────────────────
  /** 卡片标题与页签同一个词（`skills.tab.layout`）。 */
  "templatesUi.workbench.title": "版式",
  "templatesUi.workbench.action.askAssistant": "找求职助手制作",
  "templatesUi.workbench.action.create": "自制版式",
  /** 内置版式标签行的行首（标签本身是后端下发的名字，不翻）。 */
  "templatesUi.workbench.builtinLabel": "内置版式：",
  "templatesUi.workbench.empty": "还没有自制版式。想压进一页时，用它调行高与页边距最快。",
  "templatesUi.workbench.error.loadTemplates": "读取自制版式失败",
  "templatesUi.workbench.error.loadCatalog": "读取版式目录失败",
  "templatesUi.workbench.error.delete": "删除失败",
  "templatesUi.workbench.toast.deleted": "已删除「{name}」；引用它的简历会退回默认版式",
} as const;

export default templatesUi;
