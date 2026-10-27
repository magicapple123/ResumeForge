// SPDX-License-Identifier: Apache-2.0
/**
 * 面经知识库面板：搜索 / 来源筛选、条目摘要、行内菜单、批量删除与详情抽屉。
 *
 * 真实问题清单的预览用 `；` 连接——那是**纯展示**分隔符，已走
 * `separator.question`（英文用 "; "）。来源标签的中文仍取自 `types` 的
 * `EXPERIENCE_SOURCE_LABELS`（协议值 → 展示名的那张表不在本批范围）。
 */
const interviewExperience = {
  "interviewExperience.title": "面经知识库",
  "interviewExperience.searchPlaceholder": "搜索标题 / 岗位 / 正文",
  "interviewExperience.sourcePlaceholder": "来源筛选",
  "interviewExperience.action.create": "新建面经",
  "interviewExperience.action.detail": "详情",
  "interviewExperience.action.edit": "编辑",
  "interviewExperience.deleteNoun": "条面经",
  "interviewExperience.empty": "还没有面经，把面试里被问到的问题记下来吧",
  "interviewExperience.untitled": "未命名面经",
  "interviewExperience.confirm.delete": "删除这条面经？",
  "interviewExperience.aria.select": "选择面经 {name}",
  "interviewExperience.aria.more": "更多操作 {name}",
  "interviewExperience.questions.preview": "真实问题 {count} 个：",
  "interviewExperience.separator.question": "；",
  "interviewExperience.field.job": "关联岗位",
  "interviewExperience.field.createdAt": "创建时间",
  "interviewExperience.field.updatedAt": "更新时间",
  "interviewExperience.section.content": "正文",
  "interviewExperience.section.questions": "真实问题（{count}）",
  "interviewExperience.empty.content": "（无）",
  "interviewExperience.empty.questions": "（还没有记录问题）",
  "interviewExperience.toast.updated": "已更新面经",
  "interviewExperience.toast.created": "已新建面经",
  "interviewExperience.toast.deleted": "已删除这条面经",
  "interviewExperience.toast.batchDeleted": "已删除 {count} 条面经，可在「回收站」里恢复",
  "interviewExperience.error.loadFailed": "读取面经失败",
  "interviewExperience.error.saveFailed": "保存面经失败",
  "interviewExperience.error.deleteFailed": "删除失败",
  "interviewExperience.error.batchDeleteFailed": "批量删除失败，请重试",
} as const;

export default interviewExperience;
