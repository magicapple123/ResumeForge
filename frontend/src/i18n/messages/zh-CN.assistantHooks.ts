// SPDX-License-Identifier: Apache-2.0
/**
 * 求职助手 hooks 的执行期提示：流式发送、附件校验、会话增删改、引用与删除消息、
 * 侧栏技能与分组、深链引导。
 *
 * 这些文案由 hooks / store 在回调里经模块级 `t()` 取用，渲染它们的页面负责订阅
 * 语言变化（调用方 `AssistantPage` 已有 `useLocale()`）。
 */
const assistantHooks = {
  "assistantHooks.stream.error.createConversation": "创建会话失败",
  "assistantHooks.stream.attachmentOnly": "[附件]",
  "assistantHooks.stream.error.send": "发送消息失败",
  "assistantHooks.attachments.warning.unsupported": "附件扩展名与文件类型不一致，或格式不受支持",
  "assistantHooks.attachments.warning.tooMany": "每条消息最多添加 {count} 个附件",
  "assistantHooks.attachments.warning.tooLarge": "单个附件不能超过 {size} MB",
  "assistantHooks.attachments.warning.totalTooLarge": "附件总大小不能超过 {size} MB",
  "assistantHooks.attachments.error.read": "读取附件失败",
  "assistantHooks.conversations.error.loadDetail": "加载对话失败",
  "assistantHooks.conversations.error.loadEarlier": "加载更早的消息失败",
  "assistantHooks.conversations.error.create": "创建对话失败",
  "assistantHooks.conversations.error.createWelcome": "创建引导对话失败",
  "assistantHooks.conversations.error.delete": "删除对话失败",
  "assistantHooks.conversations.warning.emptyTitle": "对话标题不能为空",
  "assistantHooks.conversations.error.rename": "重命名失败",
  "assistantHooks.conversations.error.update": "更新会话失败",
  "assistantHooks.conversations.error.fork": "在新对话中继续失败",
  "assistantHooks.conversations.forkTitleSuffix": "（续）",
  "assistantHooks.messageActions.quote.attachmentOnly": "[附件消息]",
  "assistantHooks.messageActions.quote.info": "已引用这条消息，输入你的追问即可",
  "assistantHooks.messageActions.success.deleted": "消息已删除",
  "assistantHooks.messageActions.error.delete": "删除消息失败",
  "assistantHooks.messageSelection.success.deletedCount": "已删除 {count} 条消息",
  "assistantHooks.messageSelection.error.delete": "删除消息失败",
  "assistantHooks.sidebar.success.skillEnabled": "已启用技能「{name}」",
  "assistantHooks.sidebar.success.skillDisabled": "已停用技能「{name}」",
  "assistantHooks.sidebar.error.toggleSkill": "切换技能失败",
  "assistantHooks.sidebar.success.movedToGroup": "已移动到「{name}」",
  "assistantHooks.sidebar.success.removedFromGroup": "已移出分组",
  "assistantHooks.url.info.outOfRange":
    "链接里的对话不在当前列表中，可能超出了最近 100 条对话的范围。",
} as const;

export default assistantHooks;
