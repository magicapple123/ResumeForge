// SPDX-License-Identifier: Apache-2.0
/**
 * 简历模板目录里「后端下发的中文展示名」在界面上的文案（只收映射模块需要的新 key）。
 *
 * 为什么单独成包：这些 key 不属于任何既有领域（目录端点只是聚合），而它们的中文必须与
 * 后端下发的原文**逐字一致**——集中一处才对得上「替换后中文渲染结果不变」这条验收口径。
 * 分区名与字号档位复用各自领域已有的 key（`editor.section.*` / `resume.fontScale.*`），
 * 本包只补版式预设这四个名称。命名空间注册统一在 `zh-CN.namespaces.ts` 做。
 */
const enumsResumeCatalog = {
  // 内置版式预设（后端 FORMAT_PRESETS 的四个 name）；自制版式的名字是用户输入，不走这里。
  "enumsResumeCatalog.formatPreset.standard": "标准",
  "enumsResumeCatalog.formatPreset.compact": "紧凑",
  "enumsResumeCatalog.formatPreset.spacious": "舒展",
  "enumsResumeCatalog.formatPreset.mono_accent": "单色强调",
  // 同一批版式的说明文字（后端 FORMAT_PRESETS[].description 逐字）。
  "enumsResumeCatalog.formatPresetDescription.standard": "不改动模板自身的版式",
  "enumsResumeCatalog.formatPresetDescription.compact":
    "行高与间距收紧、页边距变小，适合想压进一页",
  "enumsResumeCatalog.formatPresetDescription.spacious": "行高与留白放大，适合内容不多、想显得从容",
  "enumsResumeCatalog.formatPresetDescription.mono_accent":
    "低调的深灰强调色，适合正式、保守的投递场景",
  // 内置简历模板（后端 RESUME_TEMPLATES[].name）；用户导入的模板带自己的名字，不查这张表。
  "enumsResumeCatalog.template.classic": "经典",
  "enumsResumeCatalog.template.modern": "现代",
  "enumsResumeCatalog.template.compact": "精简",
  "enumsResumeCatalog.template.elegant": "优雅",
  "enumsResumeCatalog.template.technical": "技术",
  "enumsResumeCatalog.template.minimal": "极简",
  "enumsResumeCatalog.template.scholar": "学术",
  "enumsResumeCatalog.template.editorial": "社论",
  "enumsResumeCatalog.template.split": "分栏",
  // 同一批模板的一句话说明（后端 RESUME_TEMPLATES[].description 逐字）。
  "enumsResumeCatalog.templateDescription.classic": "深蓝标题与左侧色条，稳重的通用款式",
  "enumsResumeCatalog.templateDescription.modern": "青绿配色与圆角标签，适合互联网岗位",
  "enumsResumeCatalog.templateDescription.compact": "细线分隔、排版紧凑，适合内容多、想压在一页",
  "enumsResumeCatalog.templateDescription.elegant":
    "居中标题与衬线字，留白舒展，适合文商科与管理岗位",
  "enumsResumeCatalog.templateDescription.technical":
    "色块标题与等宽辅助信息，信息密度高，适合研发岗位",
  "enumsResumeCatalog.templateDescription.minimal": "只用黑灰与字号层级，没有任何色块与装饰",
  "enumsResumeCatalog.templateDescription.scholar":
    "纯黑白、加粗标题配细线，短条目三列并排，适合科研与学术岗位",
  "enumsResumeCatalog.templateDescription.editorial":
    "衬线字体与细线分隔，适合文商科、内容与管理岗位",
  "enumsResumeCatalog.templateDescription.split": "正文双栏、信息密度高，适合经历与技能较多的简历",
} as const;

export default enumsResumeCatalog;
