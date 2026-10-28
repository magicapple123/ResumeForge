// SPDX-License-Identifier: Apache-2.0
/** 设置页「批量操作」：两套参数（生成 / 导出）各一张卡，改动自动保存。 */
const batchOperation = {
  "batchOperation.title": "批量操作",
  "batchOperation.group.hint": "两套参数各自独立，改动后自动保存并立即生效",
  "batchOperation.loadFailed": "读取批量操作参数失败",
  "batchOperation.generation.title": "批量生成简历",
  "batchOperation.generation.intro":
    "岗位广场「批量 AI 生成简历」使用这套参数：每个岗位各生成一份简历。改动会自动保存并立即生效。",
  "batchOperation.export.title": "批量导出简历",
  "batchOperation.export.intro":
    "简历中心「批量导出」使用这套参数：按这套版式把所选简历打成一个 zip。改动会自动保存并立即生效。",
  "batchOperation.status.pending": "改动任意一项即自动启用",
  "batchOperation.status.saving": "保存中…",
  "batchOperation.status.saved": "已自动保存",
  "batchOperation.status.error": "保存失败，下次修改会重试",
  "batchOperation.field.template": "版式模板",
  "batchOperation.field.fontScale": "字号",
  "batchOperation.field.pageLimit": "页数上限",
  "batchOperation.field.language": "简历语言",
  "batchOperation.field.exportFormat": "导出格式",
  "batchOperation.field.enhance": "AI 润色",
  "batchOperation.field.enhancementLevel": "润色强度",
  "batchOperation.field.customInstruction": "附加要求",
  "batchOperation.field.customInstructionPlaceholder":
    "例如：突出后端性能优化经验；不要出现「负责」这类空话",
  "batchOperation.field.optional": "可选",
  "batchOperation.hint.layout": "版式、字号与页数只作用于本卡的批量动作。",
  "batchOperation.guard.title": "先完成批量操作设置",
  "batchOperation.guard.body.generation":
    "批量生成简历的参数还没启用。请先到「设置 → 外观与交互 → 批量操作」打开这张卡；改动任意一项会自动保存，或者直接沿用默认值返回再试一次。",
  "batchOperation.guard.body.export":
    "批量导出的参数还没启用。请先到「设置 → 外观与交互 → 批量操作」打开这张卡；改动任意一项会自动保存，或者直接沿用默认值返回再试一次。",
  "batchOperation.guard.go": "去设置",
  "batchOperation.export.running": "正在导出…",
  "batchOperation.export.done": "已导出 {count} 份简历",
  "batchOperation.export.skipped": "已导出 {exported} 份，跳过 {skipped} 份：{detail}",
  "batchOperation.export.failed": "批量导出失败",
  "batchOperation.pageLimit.unit": "页",
  "batchOperation.language.zh": "中文",
  "batchOperation.language.en": "英文",
  "batchOperation.format.pdf": "PDF",
  "batchOperation.format.docx": "Word（docx）",
  "batchOperation.format.html": "HTML",
  "batchOperation.format.md": "Markdown",
  "batchOperation.enhance.off": "不润色",
  "batchOperation.enhance.light": "轻度润色",
  "batchOperation.enhance.balanced": "均衡润色",
  "batchOperation.enhance.strong": "深度润色",
} as const;

export default batchOperation;
