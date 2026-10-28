// SPDX-License-Identifier: Apache-2.0
/**
 * 模拟面试页：会话列表、问答、结束/删除确认与结果提示；本批补充面经表单弹窗、
 * 复盘历史折叠卡片与简历改进建议卡片的展示文案。
 *
 * `interview.listSeparator` 是把列表项（关卡焦点题、建议依据）拼成一行时的分隔符：
 * 中文用全角「；」，英文用 "; "，属于随语言变化的符号，必须走语言包而不是硬编码。
 *
 * `interview.confirm.deleteBody` 的后果段用 `{note}` 参数传入共用 key `common.note.hardDelete`
 * （硬删除提示的唯一出处），不在语言包里复制一份。
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
  "interview.confirm.deleteBody": "这 {count} 场面试{note}",
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
  "interview.action.stopRound": "停止本轮",
  "interview.action.retryRound": "重新回答",
  "interview.interrupted.hint": "这一轮没有答完（上次中途停下了），可以重新回答。",
  "interview.listSeparator": "；",

  "interview.experienceForm.title.edit": "编辑面经",
  "interview.experienceForm.title.create": "新建面经",
  "interview.experienceForm.action.save": "保存面经",
  "interview.experienceForm.field.title": "标题",
  "interview.experienceForm.placeholder.title": "例如：某司后端一面",
  "interview.experienceForm.field.company": "公司",
  "interview.experienceForm.placeholder.company": "公司名",
  "interview.experienceForm.field.position": "岗位",
  "interview.experienceForm.placeholder.position": "岗位名",
  "interview.experienceForm.field.job": "关联岗位（选填，删除岗位不影响面经）",
  "interview.experienceForm.placeholder.job": "绑定后自动回填公司/岗位快照（输入关键词搜索）",
  "interview.experienceForm.field.content": "正文（面试过程、怎么答的）",
  "interview.experienceForm.placeholder.content": "记录面试流程与心得",
  "interview.experienceForm.field.questions": "被问到的真实问题",
  "interview.experienceForm.hint.questions": "逐条回车添加，会沉淀进知识库",
  "interview.experienceForm.placeholder.questions": "输入后回车",
  "interview.experienceForm.field.tags": "标签",
  "interview.experienceForm.placeholder.tags": "例如：客户沟通、数据透视表",
  "interview.experienceForm.field.source": "来源",
  "interview.experienceForm.field.difficulty": "难度",
  "interview.experienceForm.placeholder.difficulty": "例如：中等",
  "interview.experienceForm.field.round": "轮次",
  "interview.experienceForm.placeholder.round": "选择常见轮次",
  "interview.experienceForm.field.date": "面试日期",

  "interview.reviewHistory.title": "历史复盘",
  "interview.reviewHistory.fallbackTitle": "复盘",
  "interview.reviewHistory.section.questions": "真实问题",
  "interview.reviewHistory.action.detail": "查看详情",
  "interview.reviewHistory.action.delete": "删除复盘历史",
  "interview.reviewHistory.confirm.delete": "删除这条复盘历史？",
  "interview.reviewHistory.loading": "加载中…",
  "interview.reviewHistory.empty": "还没有保存过复盘",

  "interview.suggestions.title": "简历改进建议",
  "interview.suggestions.empty": "没有产出建议，试试补充更多面试暴露的短板或追问",
  "interview.suggestions.evidence": "依据：{evidence}",
  "interview.suggestions.goToResume": "去简历中心对照修改 →",
} as const;

export default interview;
