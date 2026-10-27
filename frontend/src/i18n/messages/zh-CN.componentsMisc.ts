// SPDX-License-Identifier: Apache-2.0
/**
 * 通用组件（第二批收尾）：识别前的文件暂存区与预览、识别结果来源、质量检测弹窗、
 * 版本对比、导出入口、数据集边界与新建数据集弹窗、侧栏检查更新、简历编辑弹窗外壳、
 * 页头主题切换。按组件分块，块内按界面出现顺序排列。
 */
const componentsMisc = {
  "componentsMisc.recognitionField.dropHint": "松开即可添加截图或文档",
  "componentsMisc.recognitionField.add": "添加截图或文档",
  "componentsMisc.recognitionField.ignoredUnsupported":
    "已忽略 {count} 个不支持的文件（只接受截图与 pdf/docx）",
  "componentsMisc.recognitionField.pasteHint":
    "也可以把文件直接拖到这里，或在文本框里按 Ctrl+V 粘贴截图（最多 {count} 个，单个 ≤ 2 MB，合计 ≤ 5 MB；支持截图与 pdf/docx 文档）",
  "componentsMisc.recognitionField.removeTooltip": "移除 {name}",
  "componentsMisc.recognitionField.removeAria": "移除文件 {name}",

  "componentsMisc.recognitionPreview.action": "预览",
  "componentsMisc.recognitionPreview.open": "预览 {name}",
  "componentsMisc.recognitionPreview.loading": "正在生成预览…",
  "componentsMisc.recognitionPreview.error": "这个文件预览不了，识别仍可正常使用",
  "componentsMisc.recognitionPreview.pageAlt": "第 {page} 页",
  "componentsMisc.recognitionPreview.docxHint": "Word 文档不支持浏览器预览，识别时会提取文字",

  "componentsMisc.recognitionOutcome.source.ai": "AI 识别",
  "componentsMisc.recognitionOutcome.hint.ai":
    "由大模型识别，每个字段都校验过能在你给的内容里找到出处；仍请核对后再保存",
  "componentsMisc.recognitionOutcome.source.local": "本地规则",
  "componentsMisc.recognitionOutcome.hint.local":
    "未调用大模型，按内置规则匹配得出；准确度低于 AI 识别，请重点核对后再保存",
  "componentsMisc.recognitionOutcome.recognizedText": "查看模型识别到的原文（请对照截图核对）",

  "componentsMisc.qualityModal.title": "质量检测",
  "componentsMisc.qualityModal.tab.risk": "风险扫描",
  "componentsMisc.qualityModal.tab.ats": "ATS 检测",

  "componentsMisc.resumeDiff.compare": "对比：",
  "componentsMisc.resumeDiff.stat.added": "新增 {added}",
  "componentsMisc.resumeDiff.stat.removed": "删除 {removed}",
  "componentsMisc.resumeDiff.stat.unchanged": "未变 {unchanged}",

  "componentsMisc.exportButtons.export": "导出",

  "componentsMisc.datasetScope.loading": "正在连接本地工作台",
  "componentsMisc.datasetScope.errorTitle": "无法连接本地工作台",
  "componentsMisc.datasetScope.errorBody": "数据尚未加载，请确认服务已启动后刷新。",
  "componentsMisc.datasetScope.refresh": "刷新",

  "componentsMisc.datasetCreate.title": "新建数据集",
  "componentsMisc.datasetCreate.create": "新建",
  "componentsMisc.datasetCreate.intro":
    "每份数据集是一套互相独立的岗位、资料与简历。界面长得一样，但数据不互通—— 适合区分「工作 / 私人 / 面试练习」。",
  "componentsMisc.datasetCreate.namePlaceholder": "例如：工作、私人、面试练习",
  "componentsMisc.datasetCreate.nameAria": "数据集名称",

  "componentsMisc.updateCheck.latest": "已是最新版本（{version}）",
  "componentsMisc.updateCheck.available": "有新版本 {version}。",
  "componentsMisc.updateCheck.goUpdate": "去设置页更新",
  "componentsMisc.updateCheck.failed": "检查更新失败",
  "componentsMisc.updateCheck.checking": "正在检查更新…",
  "componentsMisc.updateCheck.check": "检查更新",

  "componentsMisc.resumeEditorModal.title": "手动调整简历内容",
  "componentsMisc.resumeEditorModal.save": "保存并更新预览",

  "componentsMisc.theme.label": "主题",
  "componentsMisc.theme.light": "浅色",
  "componentsMisc.theme.dark": "深色",
  "componentsMisc.theme.system": "跟随系统",
} as const;

export default componentsMisc;
