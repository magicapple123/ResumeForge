// SPDX-License-Identifier: Apache-2.0
/**
 * 「导入参考模板」弹窗：上传、识别、微调与保存的文案。
 *
 * 两处**没有**迁移，都留在基线里：`draft.source_names.join("、")` 拼出来的
 * `source_name` 会随模板落库并长期回显，顿号属于存储格式；`evidence` / `warnings`
 * 之间的分隔符是**纯展示**，已经走 `separator.*` 两个 key。
 */
const templateImport = {
  "templateImport.title.import": "导入参考模板",
  "templateImport.title.edit": "微调导入模板",
  "templateImport.action.analyze": "识别并预览",
  "templateImport.action.saveAsMine": "保存为我的模板",
  "templateImport.intro":
    "上传你想照着做的简历截图或文档。识别结果会先进入编辑器，确认后才会保存；不会直接覆盖已有模板。",
  "templateImport.upload.text": "点这里选择，或把文件拖进来",
  "templateImport.upload.hint":
    "最多 {count} 份 PNG / JPG / WEBP 图片或 PDF / DOCX，单个 ≤ {single} MB、合计 ≤ {total} MB",
  "templateImport.field.name": "模板名称（可留空，由模型起名）",
  "templateImport.placeholder.name": "例如：深蓝简洁版式",
  "templateImport.aria.name": "模板名称",
  "templateImport.draft.recognized": "已完成初步识别",
  "templateImport.draft.evidenceTitle": "识别依据",
  "templateImport.draft.noEvidence": "模型没有返回可解释依据",
  "templateImport.draft.exportNote":
    "HTML 预览与 HTML 导出使用完整样式；PDF / Word 会应用颜色、字号、行高和页边距等通用参数，但不能完整复现自定义双栏、标签图片或任意 CSS，建议导出后核对。",
  "templateImport.aria.confidence": "识别置信度",
  "templateImport.draft.confidenceTitle": "识别置信度：",
  "templateImport.draft.noConfidence": "模型未提供",
  "templateImport.draft.previewFailedTitle": "预览失败",
  "templateImport.draft.previewTitle": "导入模板预览",
  "templateImport.draft.previewing": "正在生成预览…",
  "templateImport.model.title": "识别需要已配置的大模型",
  "templateImport.model.body":
    "参考图片会发给你配置的大模型；若含真实姓名、电话或邮箱，建议先遮挡。PDF / DOCX 原文留在本机，仅发送本地生成的脱敏结构统计。识别结果会先预览和微调，再保存为模板。",
  "templateImport.separator.item": "；",
  "templateImport.separator.period": "。",
  "templateImport.toast.needFile": "先选一份参考模板文件",
  "templateImport.toast.analyzed": "识别完成，请检查右侧预览并微调后再保存",
  "templateImport.toast.saved": "已保存模板「{name}」",
  "templateImport.error.previewFailed": "预览渲染失败",
  "templateImport.error.importFailed": "导入失败，请稍后重试",
  "templateImport.error.fileTooLarge": "文件不能超过 {size} MB，请压缩后再试",
  "templateImport.error.totalTooLarge": "参考模板文件合计不能超过 {size} MB",
} as const;

export default templateImport;
