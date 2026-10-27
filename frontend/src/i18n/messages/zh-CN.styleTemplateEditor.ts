// SPDX-License-Identifier: Apache-2.0
/**
 * 「自制模板」编辑器弹窗：标题、表单标签、说明、预览与保存反馈。
 *
 * 该弹窗 2026-11 起已从界面入口下线（文件保留供历史测试与回滚），文案仍按迁移口径
 * 收进本包，避免组件里再出现一份中文字面量。`hint.starter` 里的 `{{ resume.* }}` /
 * `{% include "..." %}` 是模板语法本身，不是本包的占位符：它们带空格，
 * `translate()` 的 `{name}` 替换不会命中。
 */
const styleTemplateEditor = {
  "styleTemplateEditor.title.edit": "编辑模板",
  "styleTemplateEditor.title.create": "自制模板",
  "styleTemplateEditor.action.save": "保存模板",
  "styleTemplateEditor.action.refreshPreview": "刷新预览",
  "styleTemplateEditor.field.name": "模板名称",
  "styleTemplateEditor.placeholder.name": "如：我的深蓝模板",
  "styleTemplateEditor.field.description": "说明（选填）",
  "styleTemplateEditor.placeholder.description": "一句话说明它适合什么场景",
  "styleTemplateEditor.field.styleControls": "视觉与排版微调",
  "styleTemplateEditor.field.html": "模板 HTML",
  "styleTemplateEditor.hint.starter":
    '模板是一份完整的 HTML 页面，可用的变量：{{ resume.* }}（简历内容）、{{ page_limit }}（页数）、{{ base_px }}（基准字号像素）、{{ csp_nonce }}。正文结构可以直接 include：{% include "_resume_sections.j2" %}',
  "styleTemplateEditor.hint.export":
    "HTML 预览与 HTML 导出使用完整自制样式；PDF / Word 使用后端版式引擎，能沿用强调色、字号、行高和页边距等通用参数，但不会完整复现自定义双栏、装饰图或任意 CSS。",
  "styleTemplateEditor.hint.sampleResume": "预览用的是内置示例简历；导入时脚本与外链会被自动去掉。",
  "styleTemplateEditor.preview.title": "模板预览",
  "styleTemplateEditor.preview.empty": "还没有预览，点「刷新预览」试试。",
  "styleTemplateEditor.error.load": "读取模板失败",
  "styleTemplateEditor.error.preview": "预览渲染失败",
  "styleTemplateEditor.error.save": "保存失败",
  "styleTemplateEditor.error.renderTitle": "模板渲染失败",
  "styleTemplateEditor.toast.needName": "请填写模板名称",
  "styleTemplateEditor.toast.htmlTooShort": "模板内容太短，请提供完整的 HTML",
  "styleTemplateEditor.toast.updated": "模板已更新",
  "styleTemplateEditor.toast.created": "模板已创建，可以在生成简历时选用",
} as const;

export default styleTemplateEditor;
