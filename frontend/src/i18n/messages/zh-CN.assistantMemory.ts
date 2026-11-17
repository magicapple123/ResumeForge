// SPDX-License-Identifier: Apache-2.0
/**
 * 助手记忆设置页（#31C）与结构化画像手填（#18D）的界面文案。
 *
 * 记忆本身是用户数据（内容不翻译）；这里放标题、类型名、来源/状态标签、确认文案。
 * 七类 kind 是协议值，显示名在前端按 kind 映射；后端下发的 kind_label 只做兜底。
 */
const assistantMemory = {
  "assistantMemory.title": "助手记忆",
  "assistantMemory.intro": "助手只参考你明确表达过的求职偏好。手动添加一条，或删掉不想再用的记忆。",
  /** T23 卡头右侧的信任语：记忆是本地数据。 */
  "assistantMemory.trust.local": "只存在本机",
  /**
   * 列表头左侧：「记忆 · {count} 条」。{count} 是**列表长度**（含停用与已被替换的
   * 条目），不再是只数 active——用户看到几行，这里就写几条。
   */
  "assistantMemory.list.count": "记忆 · {count} 条",
  /** 每条右侧 `⋯` 菜单的无障碍名（图标按钮本身没有文字）。 */
  "assistantMemory.list.menu": "更多操作",
  "assistantMemory.empty": "还没有记忆。添加一条目标岗位或薪资底线，下一轮对话助手就会按它理解你。",
  "assistantMemory.loadFailed": "助手记忆读取失败，请重试",
  "assistantMemory.autoExtract.label": "自动整理对话记忆",
  "assistantMemory.autoExtract.hint":
    "开启后，下次使用助手时会自动整理上一段对话；抽到的条目出现在下面，随时可以改或删。关闭这个开关不会删除已经保存的记忆。",
  "assistantMemory.autoExtract.enableToast": "已开启自动抽取记忆",
  "assistantMemory.autoExtract.disableToast": "已关闭自动抽取记忆",
  "assistantMemory.autoExtract.saveFailed": "保存自动抽取开关失败，请稍后重试",
  /** T23 注入总开关：默认开；关掉后一条记忆都不进系统提示。 */
  "assistantMemory.inject.label": "对话时参考记忆",
  "assistantMemory.inject.hint": "关掉后助手这一轮不再参考下面的记忆；条目本身不会被删除。",
  "assistantMemory.inject.enableToast": "已开启记忆注入",
  "assistantMemory.inject.disableToast": "已关闭记忆注入",
  "assistantMemory.source.manual": "手填",
  "assistantMemory.source.extracted": "自动抽取",
  "assistantMemory.status.superseded": "已被新说法替换",
  "assistantMemory.confidence": "置信度 {percent}%",
  /** 一行的元信息：来源 · 更新时间（进 `⋯` 菜单与读屏专用文本，不再占正文行）。 */
  "assistantMemory.meta.line": "{source} · {updated}",
  "assistantMemory.updatedAt": "更新于 {time}",
  /** 卡底隐私句：记忆是本地数据。 */
  "assistantMemory.footnote.privacy": "这些记忆只保存在本机数据库，不会上传到任何服务器。",
  /** 机制说明收进 ⓘ：默认折叠，不占版面。 */
  "assistantMemory.injection.info":
    "每轮按与本条消息的相关性注入，最多 5 条；关掉「对话时参考记忆」后一条都不注入。",
  "assistantMemory.injection.infoLabel": "记忆怎么被使用",
  "assistantMemory.openConversation": "回到原对话",
  "assistantMemory.source.label": "来源",
  "assistantMemory.sourceExcerpt": "「{text}」",
  "assistantMemory.action.add": "添加记忆",
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
    "标记后助手不会再在回答里使用它；条目会留在列表里（置灰），随时可以恢复使用。",
  "assistantMemory.neverUseConfirm.ok": "停用这条记忆",
  "assistantMemory.clearConfirm.title": "清空全部记忆",
  "assistantMemory.clearConfirm.body":
    "将逐条删除全部 {count} 条记忆：删除后助手不再使用它们，且这里不再显示（后台保留可回溯）。",
  "assistantMemory.clearConfirm.ok": "清空全部记忆",
  "assistantMemory.toast.deleted": "已删除这条记忆",
  "assistantMemory.toast.neverUse": "已停用，不会再被使用",
  "assistantMemory.toast.restored": "已恢复使用",
  "assistantMemory.status.suppressed": "已停用",
  "assistantMemory.action.restore": "恢复使用",
  "assistantMemory.action.history": "历史",
  "assistantMemory.history.title": "变更历史",
  "assistantMemory.history.empty": "这条记忆还没有变更记录",
  "assistantMemory.history.loadFailed": "变更历史读取失败",
  "assistantMemory.history.action.create": "新建",
  "assistantMemory.history.action.update": "编辑",
  "assistantMemory.history.action.supersede": "被新说法替换",
  "assistantMemory.history.action.suppress": "停用",
  "assistantMemory.history.action.restore": "恢复使用",
  "assistantMemory.history.action.delete": "删除",
  "assistantMemory.history.changed": "{before} → {after}",
  "assistantMemory.search.placeholder": "搜索记忆内容",
  "assistantMemory.sort.label": "排序",
  "assistantMemory.sort.recent": "最近更新",
  "assistantMemory.sort.kind": "按类别",
  "assistantMemory.toast.cleared": "已清空 {count} 条记忆",
  "assistantMemory.toast.saved": "记忆已保存",
  "assistantMemory.toast.failed": "操作失败，请稍后重试",
  "assistantMemory.error.valueRequired": "请填写记忆内容",
  "assistantMemory.form.createTitle": "添加一条记忆",
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
