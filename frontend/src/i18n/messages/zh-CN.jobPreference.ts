// SPDX-License-Identifier: Apache-2.0
/**
 * 求职偏好档（T14）：设置页卡片、偏好行、编辑弹窗与确认卡两个按钮。
 *
 * kind / value_kind / source / state 是协议值，**永不翻译**；这里只存展示名。
 * 13 类目录标签与三组枚举选项必须与后端 job_preference_catalog.py 一一对应
 * （后端 label 只服务注入块与日志；英文界面不显示后端中文）。
 */
const jobPreference = {
  /** 设置页卡片。 */
  "jobPreference.title": "求职偏好",
  "jobPreference.intro":
    "这些是你亲口设的约束：助手会照着做，但不会把它们当成你的经历写进简历或事实台账。",
  "jobPreference.empty": "还没有设置过偏好。",
  "jobPreference.error.load": "偏好没有读出来，请重试一次",
  /** 动作。 */
  "jobPreference.action.add": "新增一条偏好",
  "jobPreference.action.edit": "编辑",
  "jobPreference.action.undo": "撤销到上一版",
  "jobPreference.action.delete": "删除",
  /** 行上的标注。 */
  "jobPreference.tag.sessionOnly": "仅本次对话",
  "jobPreference.updatedAt": "{date} 更新",
  "jobPreference.source.user_stated": "你告诉助手的",
  "jobPreference.source.user_edited": "你手动设置的",
  "jobPreference.source.imported": "导入的",
  /** 13 类 kind 的展示名（顺序与后端 catalog 一致，但界面按后端列表顺序渲染）。 */
  "jobPreference.kind.target_role_family": "期望岗位方向",
  "jobPreference.kind.target_city": "期望城市",
  "jobPreference.kind.exclude_company": "排除公司",
  "jobPreference.kind.exclude_industry": "排除行业",
  "jobPreference.kind.salary_floor": "薪资底线",
  "jobPreference.kind.work_mode": "工作方式",
  "jobPreference.kind.employment_type": "用工形式",
  "jobPreference.kind.overtime": "加班接受度",
  "jobPreference.kind.redline_banned_word": "写作红线（禁用词）",
  "jobPreference.kind.redline_length": "写作红线（篇幅）",
  "jobPreference.kind.redline_tone": "写作红线（语气）",
  "jobPreference.kind.available_from": "到岗时间",
  "jobPreference.kind.session_note": "对话内说明",
  /** 三组枚举选项（协议值 → 展示名）。 */
  "jobPreference.option.work_mode.onsite": "现场",
  "jobPreference.option.work_mode.hybrid": "混合",
  "jobPreference.option.work_mode.remote": "远程",
  "jobPreference.option.overtime.accept": "接受",
  "jobPreference.option.overtime.limited": "尽量少",
  "jobPreference.option.overtime.reject": "不接受",
  "jobPreference.option.redline_tone.professional": "专业",
  "jobPreference.option.redline_tone.plain": "平实",
  "jobPreference.option.redline_tone.warm": "温和",
  /** 值的展示格式。 */
  "jobPreference.value.separator": "、",
  "jobPreference.value.monthly": "月薪 ≥ {amount} 元",
  "jobPreference.value.yearly": "年薪 ≥ {amount} 元",
  "jobPreference.value.maxPages": "正文最多 {count} 页",
  "jobPreference.value.immediate": "随时到岗",
  "jobPreference.value.fromDate": "{date} 起",
  /** 编辑弹窗。 */
  "jobPreference.form.titleCreate": "新增一条偏好",
  "jobPreference.form.titleEdit": "编辑这条偏好",
  "jobPreference.form.kind": "偏好类别",
  "jobPreference.form.kindLocked": "类别保存后不能再改；要换类别请新增一条。",
  "jobPreference.form.value": "内容",
  "jobPreference.form.listPlaceholder": "输入后按回车，可加多个",
  "jobPreference.form.salaryAmount": "金额（元）",
  "jobPreference.form.salaryUnit": "单位",
  "jobPreference.form.salaryUnit.month": "月薪",
  "jobPreference.form.salaryUnit.year": "年薪",
  "jobPreference.form.maxPages": "正文最多几页",
  "jobPreference.form.enumPlaceholder": "选择一项",
  "jobPreference.form.datePlaceholder": "例如 2026-12-01，或填「随时」",
  "jobPreference.form.sessionNotePlaceholder": "这次对话里的临时说明（不会长期生效）",
  "jobPreference.form.textPlaceholder": "输入内容",
  "jobPreference.form.note": "备注（可选）",
  "jobPreference.form.notePlaceholder": "记下你当时是怎么说的",
  "jobPreference.form.save": "保存这条偏好",
  "jobPreference.form.needValue": "先填一下内容",
  /** 结果提示（含对象）。 */
  "jobPreference.toast.created": "已记下这条偏好",
  "jobPreference.toast.updated": "已更新这条偏好",
  "jobPreference.toast.deleted": "已删除这条偏好",
  "jobPreference.toast.deletedTrash": "已删除这条偏好，可在回收站恢复",
  "jobPreference.toast.undone": "已撤销到上一版",
  /** 错误提示（409 稳定码有专属说法）。 */
  "jobPreference.error.notCurrent": "这条偏好已经不是当前版本，刷新后再试",
  "jobPreference.error.noPrevious": "这条偏好没有上一版可撤销",
  "jobPreference.error.save": "偏好没有保存上，请重试一次",
  "jobPreference.error.delete": "偏好没有删除上，请重试一次",
  "jobPreference.error.undo": "偏好没有撤销上，请重试一次",
  "jobPreference.error.restore": "撤销删除没有成功，请到回收站手动恢复",
  /** 助手确认卡：两个按钮 + 提示 + 结果。 */
  "jobPreference.proposal.notice":
    "选一种生效范围：「以后都这样」长期生效；「只在这次对话」只影响当前对话。偏好不会被写进简历正文或经历。",
  "jobPreference.proposal.rememberLongTerm": "以后都这样",
  "jobPreference.proposal.sessionOnly": "只在这次对话",
  "jobPreference.proposal.sessionToast": "已记住，只在这次对话生效",
  "jobPreference.proposal.sessionError": "这次对话的偏好没有记住，请重试一次",
} as const;

export default jobPreference;
