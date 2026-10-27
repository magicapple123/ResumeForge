// SPDX-License-Identifier: Apache-2.0
/**
 * 个性化题库面板（面试 Tab 里的「题库」）：生成入口、历史题库回看、批量删除确认与提示。
 *
 * `TRASH_RECOVERY_NOTE` 是别处共享的中文常量，这里只引用不翻译；`{count}` / `{note}` /
 * `{ok}` / `{failed}` / `{id}` / `{time}` 是插值占位符，中英两侧名字与出现次数一致。
 */
const questionBankPanel = {
  "questionBankPanel.page.title": "个性化题库",
  "questionBankPanel.page.description":
    "题库基于岗位 JD、简历与已确认的事实台账即时生成，覆盖基础题、项目深挖题与反问 HR 题三类。",
  "questionBankPanel.select.jobPlaceholder": "关联岗位（选填，输入关键词搜索）",
  "questionBankPanel.select.resumePlaceholder": "关联简历（选填，输入关键词搜索）",
  "questionBankPanel.action.generate": "生成题库",
  "questionBankPanel.action.startSession": "开始模拟面试",
  "questionBankPanel.action.save": "保存题库",
  "questionBankPanel.action.regenerate": "重新生成",
  "questionBankPanel.empty.needSelection": "选择岗位或简历后生成题库",
  "questionBankPanel.empty.recordEmpty": "该历史记录为空",
  "questionBankPanel.history.title": "历史题库",
  "questionBankPanel.history.viewingTitle": "正在查看历史题库 #{id}（{time}）",
  "questionBankPanel.history.legacyTitle": "此为旧版记录，仅可查看",
  "questionBankPanel.history.legacyBody":
    "旧版历史以纯文本保存，无法还原为结构化题库，仅展示原始内容。",
  "questionBankPanel.summary.total": "共 {count} 题",
  "questionBankPanel.validate.needJobOrResume": "请至少选择一个岗位或一份简历，题库才能有针对性",
  "questionBankPanel.error.generate": "生成题库失败",
  "questionBankPanel.error.autoSave": "自动保存题库历史失败",
  "questionBankPanel.error.delete": "删除题库历史失败",
  "questionBankPanel.error.answer": "生成参考答案失败",
  "questionBankPanel.error.answerWriteBack": "参考答案已生成，但写回历史失败",
  "questionBankPanel.confirm.bulkDeleteTitle": "删除选中的题库历史？",
  "questionBankPanel.confirm.bulkDeleteBody": "这 {count} 份题库历史{note}",
  "questionBankPanel.toast.deletedMany": "已删除 {count} 份题库历史",
  "questionBankPanel.toast.deletedPartial": "已删除 {ok} 份，{failed} 份失败，请重试",
  "questionBankPanel.toast.deleted": "已删除题库历史",
} as const;

export default questionBankPanel;
