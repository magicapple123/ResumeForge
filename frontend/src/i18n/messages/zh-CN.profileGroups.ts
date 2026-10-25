// SPDX-License-Identifier: Apache-2.0
/**
 * 资料组 / 当前组界面文案（F6）。扁平点分 key，单独成域以免把主 zh-CN.ts 继续顶过预算。
 *
 * 口径：标题 ≤7 字、正文/说明 ≤30 字、Toast ≤20 字；长确认拆成多个各自合规的句子
 * （动作 + 对象/条数 + 后果 + 恢复位置），不为凑字数删安全后果。
 */
const profileGroups = {
  "profileGroups.control.label": "当前组",
  "profileGroups.control.manage": "管理组",
  "profileGroups.control.locked": "编辑中不能切换组，请先保存或取消",
  "profileGroups.control.switchFailed": "切换组失败：{detail}",

  "profileGroups.manager.title": "管理组与大字段",
  "profileGroups.manager.groupsTab": "组",
  "profileGroups.manager.sectionsTab": "大字段与字段",
  "profileGroups.manager.close": "关闭",
  "profileGroups.manager.back": "返回",
  "profileGroups.manager.create": "新建组",
  "profileGroups.manager.createHint": "组名 1–40 个字符",
  "profileGroups.manager.nameLabel": "组名",
  "profileGroups.manager.saveName": "保存名称",
  "profileGroups.manager.membersTitle": "参与的大字段",
  "profileGroups.manager.membersHint": "基本信息恒参与；勾选后该组显示对应大字段",
  "profileGroups.manager.saveMembers": "保存参与清单",
  "profileGroups.manager.setCurrent": "设为当前组",
  "profileGroups.manager.current": "当前组",
  "profileGroups.manager.default": "默认组",
  "profileGroups.manager.rename": "编辑",
  "profileGroups.manager.membersVisibilityHint":
    "取消勾选即在该组资料页隐藏；隐藏的大字段不参与生成与网申",
  "profileGroups.manager.createVisibilityHint":
    "新组默认隐藏所有大字段（基本信息除外），创建后可逐项显示",
  "profileGroups.manager.createdSwitched":
    "已新建并切换到「{name}」，所有大字段默认隐藏（基本信息除外），可在资料页逐项显示",
  "profileGroups.manager.createdKeepEditing":
    "已新建组「{name}」；先保存或取消编辑，再把它设为当前组",
  "profileGroups.manager.delete": "删除这个组",
  "profileGroups.manager.defaultProtected": "默认组不能删除，可以编辑",
  "profileGroups.manager.groupCount": "活动组最多 20 个",
  "profileGroups.manager.membersRequired": "至少保留基本信息",
  "profileGroups.manager.saveFailed": "保存失败：{detail}",
  "profileGroups.manager.conflict": "内容已在其他窗口修改，请刷新后比较",

  "profileGroups.manager.deleteTitle": "删除组「{name}」？",
  "profileGroups.manager.deleteBody":
    "删除后该组不再出现在列表，参与关系保留以便恢复；资料条目一条都不会删。",
  "profileGroups.manager.deleteConfirm": "删除「{name}」",
  "profileGroups.manager.deleteRestore": "可在回收站恢复",
  "profileGroups.manager.undo": "撤销",
  "profileGroups.manager.deleted": "已删除组「{name}」",
  "profileGroups.manager.restoreFailed": "恢复失败：{detail}",

  "profileGroups.notice.fallback": "当前组已不可用，已切换到默认组",
  "profileGroups.notice.ack": "知道了",

  "profileGroups.summary.label": "本次使用：{name}（{count} 个大字段）",
  "profileGroups.summary.loading": "正在读取当前组",
  "profileGroups.summary.fields": "参与的大字段",
  "profileGroups.summary.empty": "当前组暂无参与的大字段",
  /** 参与清单在 Tooltip 里的分隔符（避免源码里出现中文标点）。 */
  "profileGroups.summary.separator": "、",

  "profileGroups.leave.title": "有未保存的修改",
  "profileGroups.leave.body.navigate": "离开这一页后，本次修改会丢失。",
  "profileGroups.leave.body.cancel": "取消编辑会丢弃本次修改。",
  "profileGroups.leave.body.switchGroup": "切换当前组会丢弃本次修改。",
  "profileGroups.leave.discard": "放弃修改",
  "profileGroups.leave.keep": "继续编辑",
} as const;

export default profileGroups;
