// SPDX-License-Identifier: Apache-2.0
/**
 * 求职助手：消息气泡、空态、会话侧栏、写入提案卡与分组弹窗（2026-10-28 迁移）。
 *
 * 覆盖 `features/assistant/` 下的展示文案：启动提问的**标签**（提示词正文是发给模型的
 * 指令，仍留在 `assistantTypes.ts`）、分时段问候、技能名摘要、消息正文的思考过程与来源、
 * 消息右键菜单与多选工具条、会话侧栏的筛选/操作/确认/Toast、写入提案卡的状态与按钮。
 *
 * 模块级常量表只存 key（`labelKey`），渲染处再 `t()`；本包不含任何协议值。
 * `{note}` 插的是 `components/common/rowActionMenu.ts` 里的删除后果常量
 * （`HARD_DELETE_NOTE` / `TRASH_RECOVERY_NOTE`），那份常量迁出语言包前这里只做拼接。
 */
const assistantUi = {
  "assistantUi.starter.matchAnalysis": "分析岗位匹配度",
  "assistantUi.starter.polishProjects": "优化项目经历",
  "assistantUi.starter.interviewRound": "准备一轮面试",
  "assistantUi.starter.findJobs": "查找招聘信息",
  "assistantUi.greeting.headline": "你好，我是投投",
  "assistantUi.greeting.lateNight": "夜已经深了，改完这一份就早点休息吧",
  "assistantUi.skillNames.separator": "、",
  "assistantUi.skillNames.overflow": "{names} 等 {count} 个",
  "assistantUi.empty.floatingDescription":
    "我可以帮你解决简历通使用问题、分析简历和岗位，并在你明确要求时操作允许的数据。",
  "assistantUi.empty.pageDescription":
    "能帮你打磨简历、对照岗位查缺补漏、解答求职问题。可先关联岗位或简历，再按需开启资料和联网搜索。",
  "assistantUi.empty.starterPromptsAria": "常用求职提问",
  "assistantUi.empty.skillsDiscoveryBefore": "助手还能按你导入的",
  "assistantUi.empty.skillsDiscoveryTerm": "技能",
  "assistantUi.empty.skillsDiscoveryAfter":
    "作答——技能是一份提示词（可附带知识文件），用来固定回答风格或流程。",
  "assistantUi.empty.manageSkills": "到工作台添加技能",
  "assistantUi.group.move": "移动到分组",
  "assistantUi.group.moveCurrent": "移动到分组（当前：{name}）",
  "assistantUi.group.description":
    "给这段对话归个类（例如「字节」「面试准备」）。留空表示移出分组。分组只影响侧栏的显示，不会动对话内容。",
  "assistantUi.group.placeholder": "分组名称",
  "assistantUi.reasoning.title": "思考过程",
  "assistantUi.reasoning.truncated": "思考过程过长，这里只保留了前一部分。",
  "assistantUi.sources.header": "参考来源（{count}）",
  "assistantUi.attachments.notesSeparator": "；",
  "assistantUi.messageList.action.quote": "引用这条继续问",
  "assistantUi.messageList.action.copy": "复制内容",
  "assistantUi.messageList.action.delete": "删除这条消息",
  "assistantUi.messageList.toast.copied": "已复制这条消息",
  "assistantUi.messageList.toast.copyFailed": "复制失败，可以手动选中",
  "assistantUi.messageList.confirm.delete": "删除这条消息？引用它的提问仍会保留引用内容。",
  "assistantUi.messageList.role.self": "你",
  /** 空格是既有渲染结果（页面测试按无障碍名逐字查找勾选框），不要顺手删掉。 */
  "assistantUi.messageList.aria.selectOwn": "选择 你的这条消息",
  /** 同上：空格保留。 */
  "assistantUi.messageList.aria.selectAssistant": "选择 助手的这条消息",
  "assistantUi.messageList.loadEarlier": "加载更早",
  "assistantUi.messageList.total": "共 {count} 条消息",
  "assistantUi.messageList.thinking": "正在思考…",
  "assistantUi.messageList.streaming": "正在生成回答",
  "assistantUi.messageList.preparing": "正在准备回答",
  "assistantUi.selectBar.selected": "已选 {count} 条",
  "assistantUi.selectBar.confirm.title": "删除选中的消息？",
  "assistantUi.selectBar.confirm.content":
    "这 {count} 条消息{note}引用这些消息的提问仍会保留引用内容。",
  "assistantUi.selectBar.deleteSelected": "删除所选",
  "assistantUi.selectBar.exit": "退出多选",
  "assistantUi.actionProposal.status.pending": "待确认",
  "assistantUi.actionProposal.status.approved": "已批准",
  "assistantUi.actionProposal.status.executed": "已执行",
  "assistantUi.actionProposal.status.expired": "已失效",
  "assistantUi.actionProposal.status.rejected": "已拒绝",
  "assistantUi.actionProposal.status.failed": "执行失败",
  "assistantUi.actionProposal.status.unknown": "结果未知",
  "assistantUi.actionProposal.status.fallback": "状态未知",
  "assistantUi.actionProposal.aria": "写入提案：{target}",
  "assistantUi.actionProposal.heading": "助手请求写入数据",
  "assistantUi.actionProposal.changeField": "{field}：",
  "assistantUi.actionProposal.noContent": "（无内容）",
  "assistantUi.actionProposal.notice": "在你确认之前，这条写入不会执行；助手也无法替你确认。",
  "assistantUi.actionProposal.action.approve": "确认执行",
  "assistantUi.actionProposal.action.reject": "拒绝",
  "assistantUi.actionProposal.toast.done": "写入已完成",
  "assistantUi.actionProposal.toast.executed": "提案已执行",
  "assistantUi.actionProposal.error.fallback": "执行提案失败",
  "assistantUi.sidebar.newConversation": "新对话",
  "assistantUi.sidebar.deleteSelected": "删除所选",
  "assistantUi.sidebar.searchPlaceholder": "搜索标题或首条消息",
  "assistantUi.sidebar.searchAria": "搜索对话",
  "assistantUi.sidebar.filter.all": "全部",
  "assistantUi.sidebar.filter.favorite": "收藏",
  "assistantUi.sidebar.filter.archived": "已归档",
  "assistantUi.sidebar.loading": "正在加载对话…",
  "assistantUi.sidebar.empty": "暂无对话",
  "assistantUi.sidebar.aria.selectConversation": "选择对话 {title}",
  "assistantUi.sidebar.moreTooltip": "更多操作（也可以直接右键这条对话）",
  "assistantUi.sidebar.moreAria": "更多对话操作",
  "assistantUi.sidebar.saveTitleTooltip": "保存标题（回车也可以）",
  "assistantUi.sidebar.saveTitleAria": "保存对话标题",
  "assistantUi.sidebar.messageCount": "{count} 条",
  "assistantUi.sidebar.action.pin": "置顶对话",
  "assistantUi.sidebar.action.unpin": "取消置顶",
  "assistantUi.sidebar.action.favorite": "收藏对话",
  "assistantUi.sidebar.action.unfavorite": "取消收藏",
  "assistantUi.sidebar.action.shareLink": "复制分享链接",
  "assistantUi.sidebar.action.rename": "重命名",
  "assistantUi.sidebar.action.fork": "在新对话中继续",
  "assistantUi.sidebar.action.export": "导出为 Markdown",
  "assistantUi.sidebar.action.saveToMaterials": "存进资料箱",
  "assistantUi.sidebar.action.copyId": "复制会话 ID",
  "assistantUi.sidebar.action.archive": "归档对话",
  "assistantUi.sidebar.action.unarchive": "取消归档",
  "assistantUi.sidebar.confirm.deleteSelectedTitle": "删除选中的对话？",
  "assistantUi.sidebar.confirm.deleteSelectedContent": "这 {count} 段对话{note}",
  "assistantUi.sidebar.toast.shareLinkCopied": "已复制会话链接，在本应用打开即可回到这段对话",
  "assistantUi.sidebar.toast.copyLinkFailed": "复制失败，可以手动复制：{link}",
  "assistantUi.sidebar.toast.idCopied": "已复制会话 ID：{id}",
  "assistantUi.sidebar.toast.exported": "已导出为 Markdown 文件",
  "assistantUi.sidebar.toast.exportFailed": "导出失败",
  "assistantUi.sidebar.toast.savedToMaterials": "已存进资料箱",
  "assistantUi.sidebar.toast.saveFailed": "存进资料箱失败",
} as const;

export default assistantUi;
