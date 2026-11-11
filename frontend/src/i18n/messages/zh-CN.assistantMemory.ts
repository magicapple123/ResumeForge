// SPDX-License-Identifier: Apache-2.0
/**
 * 助手记忆设置页（#31C）与结构化画像手填（#18D）的界面文案。
 *
 * 记忆本身是用户数据（内容不翻译）；这里放标题、类型名、来源/状态标签、确认文案。
 * 七类 kind 是协议值，显示名在前端按 kind 映射；后端下发的 kind_label 只做兜底。
 */
const assistantMemory = {
  "assistantMemory.title": "助手记忆",
  "assistantMemory.intro":
    "助手只参考你明确表达过的求职偏好（每轮最多注入 5 条）。这里是唯一能看到、能改的地方：手填一条画像，或删除不想再用的记忆。",
  "assistantMemory.count": "共 {count} 条",
  "assistantMemory.empty": "还没有记忆。补充一条目标岗位或薪资底线，下一轮对话助手就会按它理解你。",
  "assistantMemory.loadFailed": "助手记忆读取失败，请重试",
  "assistantMemory.autoExtract.label": "对话结束后自动抽取记忆",
  "assistantMemory.autoExtract.hint":
    "开启后，对话空闲约 5 分钟由后台任务抽取；默认关闭，直到你确认这里能看见并修改它。",
  "assistantMemory.autoExtract.enableToast": "已开启自动抽取记忆",
  "assistantMemory.autoExtract.disableToast": "已关闭自动抽取记忆",
  "assistantMemory.autoExtract.saveFailed": "保存自动抽取开关失败，请稍后重试",
  "assistantMemory.source.manual": "手填",
  "assistantMemory.source.extracted": "自动抽取",
  "assistantMemory.status.superseded": "已被新说法替换",
  "assistantMemory.confidence": "置信度 {percent}%",
  "assistantMemory.updatedAt": "更新于 {time}",
  "assistantMemory.openConversation": "回到原对话",
  "assistantMemory.action.add": "补充画像",
  "assistantMemory.action.edit": "编辑",
  "assistantMemory.action.delete": "删除",
  "assistantMemory.action.neverUse": "永不使用",
  "assistantMemory.action.cancel": "取消",
  "assistantMemory.action.save": "保存修改",
  "assistantMemory.action.create": "保存",
  "assistantMemory.action.clearAll": "清空全部",
  "assistantMemory.deleteConfirm.title": "删除这条记忆",
  "assistantMemory.deleteConfirm.body":
    "删除后助手不再使用这条记忆；后台保留记录可回溯，但这里不再显示。",
  "assistantMemory.deleteConfirm.ok": "删除这条记忆",
  "assistantMemory.neverUseConfirm.title": "不再使用这条记忆",
  "assistantMemory.neverUseConfirm.body":
    "标记后助手不会再在回答里使用它；记录保留，但列表里不再显示。",
  "assistantMemory.neverUseConfirm.ok": "标记永不使用",
  "assistantMemory.clearConfirm.title": "清空全部记忆",
  "assistantMemory.clearConfirm.body":
    "将逐条删除全部 {count} 条记忆：删除后助手不再使用它们，且这里不再显示（后台保留可回溯）。",
  "assistantMemory.clearConfirm.ok": "清空全部记忆",
  "assistantMemory.toast.deleted": "已删除这条记忆",
  "assistantMemory.toast.neverUse": "已标记不再使用",
  "assistantMemory.toast.cleared": "已清空 {count} 条记忆",
  "assistantMemory.toast.saved": "记忆已保存",
  "assistantMemory.toast.failed": "操作失败，请稍后重试",
  "assistantMemory.error.valueRequired": "请填写记忆内容",
  "assistantMemory.form.createTitle": "补充一条画像",
  "assistantMemory.form.editTitle": "编辑记忆",
  "assistantMemory.form.kind": "类型",
  "assistantMemory.form.kindHint":
    "只有七类求职事实会进记忆：公司规模、届别/年限、面试反馈摘要等归入「其他约束」。",
  "assistantMemory.form.kindLocked": "类型创建后不可修改",
  "assistantMemory.form.value": "内容",
  "assistantMemory.form.valuePlaceholder": "一句话说清，例如：只要上海或杭州的岗位",
  "assistantMemory.form.key": "细分键（可选）",
  "assistantMemory.form.keyPlaceholder": "例如按城市记薪资底线时填「上海」",
  "assistantMemory.form.keyHint": "同一类型下要区分维度时才填；留空表示该类型只记一条。",
  "assistantMemory.form.sensitiveHint":
    "不要填身份证号、手机号、银行卡或工资流水；只记求职相关的稳定偏好。",
  "assistantMemory.kind.target_role": "目标岗位",
  "assistantMemory.kind.city": "意向城市",
  "assistantMemory.kind.salary_floor": "薪资底线",
  "assistantMemory.kind.avoid_company": "不去公司",
  "assistantMemory.kind.work_mode": "远程偏好",
  "assistantMemory.kind.skill_tag": "技术栈",
  "assistantMemory.kind.constraint": "其他约束",
} as const;

export default assistantMemory;
