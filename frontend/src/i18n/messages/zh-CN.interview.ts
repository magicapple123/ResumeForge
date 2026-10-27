// SPDX-License-Identifier: Apache-2.0
/**
 * 模拟面试页：会话列表、问答、结束/删除确认与结果提示。
 *
 * `interview.listSeparator` 是把关卡焦点题拼成一行时的分隔符：中文用全角「；」，
 * 英文用 "; "，属于随语言变化的符号，必须走语言包而不是硬编码。
 */
const interview = {
  "interview.toast.loadFailed": "读取面试记录失败",
  "interview.toast.startFailed": "开始面试失败",
  "interview.toast.openFailed": "打开面试失败",
  "interview.toast.reportReady": "面试结束，评分报告已生成",
  "interview.toast.submitFailed": "提交回答失败，请重试",
  "interview.toast.ended": "面试已结束",
  "interview.toast.endFailed": "结束面试失败",
  "interview.toast.deleted": "已删除这场面试",
  "interview.toast.deleteFailed": "删除失败",
  "interview.toast.deletedMany": "已删除 {count} 场面试",
  "interview.toast.deletedPartial": "已删除 {ok} 场，{failed} 场失败，请重试",
  "interview.toast.savedToMaterials": "已存进资料箱的「面试复盘」分类",
  "interview.toast.saveFailed": "存进资料箱失败",
  "interview.toast.questionsImported": "题目已带入「考察重点」，调整后即可开始面试",
  "interview.confirm.endTitle": "结束这场面试？",
  "interview.confirm.endBody": "结束后会根据已有的问答生成评分报告，不能再补充回答。",
  "interview.confirm.endOk": "结束并出报告",
  "interview.confirm.endCancel": "继续面试",
  "interview.confirm.deleteTitle": "删除选中的面试记录？",
  "interview.page.title": "模拟面试",
  "interview.page.subtitle": "让 AI 面试官按你设定的类型与难度提问，结束后给出评分报告与改进建议。",
  "interview.action.backToSettings": "回到设置",
  "interview.tab.interview": "模拟面试",
  "interview.tab.questionBank": "题库",
  "interview.tab.experiences": "面经",
  "interview.tab.review": "面试复盘",
  "interview.round.withClosing": "第 {current} 轮 · 面试官按表现收尾",
  "interview.round.progress": "第 {current} / {total} 轮",
  "interview.action.end": "结束并出报告",
  "interview.action.new": "新开一场",
  "interview.role.you": "我",
  "interview.role.comment": "面试官点评：",
  "interview.thinking": "正在思考下一个问题…",
  "interview.placeholder":
    "像真实面试那样回答：先说结论，再说做了什么、结果如何（Ctrl+Enter 发送）",
  "interview.hint.dontKnow": "答不上来可以直接说「不知道」，面试官会给回答思路。",
  "interview.action.submit": "提交回答",
  "interview.listSeparator": "；",
} as const;

export default interview;
