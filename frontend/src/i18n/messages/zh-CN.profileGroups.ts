// SPDX-License-Identifier: Apache-2.0
/**
 * 资料方案 / 当前方案界面文案（F6）。扁平点分 key，单独成域以免把主 zh-CN.ts 继续顶过预算。
 *
 * 口径：标题 ≤7 字、正文/说明 ≤30 字、Toast ≤20 字；长确认拆成多个各自合规的句子
 * （动作 + 对象/条数 + 后果 + 恢复位置），不为凑字数删安全后果。
 */
const profileGroups = {
  /** 默认组还没被改过名时的展示名（后端 `DEFAULT_GROUP_NAME` 逐字一致）；改名后原样显示用户的输入。 */
  "profileGroups.defaultName": "默认组",
  "profileGroups.control.label": "当前方案",
  "profileGroups.control.manage": "管理方案",
  "profileGroups.control.locked": "编辑中不能切换方案，请先保存或取消",
  "profileGroups.control.switchFailed": "切换方案失败：{detail}",

  "profileGroups.manager.title": "方案与板块",
  "profileGroups.manager.groupsTab": "方案",
  "profileGroups.manager.sectionsTab": "板块与字段",
  "profileGroups.manager.close": "关闭",
  "profileGroups.manager.back": "返回",
  "profileGroups.manager.create": "新建方案",
  "profileGroups.manager.createHint": "方案名称 1–40 个字符",
  "profileGroups.manager.nameLabel": "方案名称",
  "profileGroups.manager.namePlaceholder": "如：技术岗投递",
  "profileGroups.manager.saveName": "保存名称",
  "profileGroups.manager.membersTitle": "包含的板块",
  "profileGroups.manager.membersHint": "基本信息始终包含；勾选后该方案显示对应板块",
  "profileGroups.manager.saveMembers": "保存板块清单",
  "profileGroups.manager.setCurrent": "设为当前方案",
  "profileGroups.manager.current": "当前方案",
  "profileGroups.manager.default": "默认方案",
  "profileGroups.manager.editTitle": "编辑方案",
  "profileGroups.manager.rename": "编辑",
  "profileGroups.manager.membersVisibilityHint":
    "取消勾选即在该方案资料页隐藏；隐藏的板块不参与生成与网申",
  "profileGroups.manager.createVisibilityHint": "新方案默认只显示基本信息，其余板块可逐项打开",
  "profileGroups.manager.createdSwitched":
    "已新建并切换到「{name}」，默认只显示基本信息，其余板块可在资料页逐项打开",
  "profileGroups.manager.createdKeepEditing":
    "已新建方案「{name}」；先保存或取消编辑，再把它设为当前方案",
  "profileGroups.manager.delete": "删除方案",
  "profileGroups.manager.defaultProtected": "默认方案不可删除",
  "profileGroups.manager.groupCount": "最多 20 个方案",
  "profileGroups.manager.membersRequired": "至少保留基本信息",
  "profileGroups.manager.saveFailed": "保存失败：{detail}",
  "profileGroups.manager.conflict": "内容已在其他窗口修改，请刷新后比较",

  "profileGroups.manager.deleteTitle": "删除方案「{name}」？",
  "profileGroups.manager.deleteBody":
    "删除后该方案不再出现在列表，板块清单保留以便恢复；资料条目一条都不会删。",
  "profileGroups.manager.deleteConfirm": "删除「{name}」",
  "profileGroups.manager.deleteRestore": "可在回收站恢复",
  "profileGroups.manager.undo": "撤销",
  "profileGroups.manager.deleted": "已删除方案「{name}」",
  "profileGroups.manager.restoreFailed": "恢复失败：{detail}",

  "profileGroups.notice.fallback": "当前方案已不可用，已切换到默认方案",
  "profileGroups.notice.ack": "知道了",

  "profileGroups.summary.label": "本次使用：{name}（{count} 个板块）",
  "profileGroups.summary.loading": "正在读取当前方案",
  "profileGroups.summary.fields": "包含的板块",
  "profileGroups.summary.empty": "当前方案还没有包含任何板块",
  /** 板块清单在 Tooltip 里的分隔符（避免源码里出现中文标点）。 */
  "profileGroups.summary.separator": "、",

  "profileGroups.leave.title": "有未保存的修改",
  "profileGroups.leave.body.navigate": "离开这一页后，本次修改会丢失。",
  "profileGroups.leave.body.cancel": "取消编辑会丢弃本次修改。",
  "profileGroups.leave.body.switchGroup": "切换当前方案会丢弃本次修改。",
  "profileGroups.leave.discard": "放弃修改",
  "profileGroups.leave.keep": "继续编辑",
} as const;

export default profileGroups;
