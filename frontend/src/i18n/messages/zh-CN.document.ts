// SPDX-License-Identifier: Apache-2.0
/**
 * 简历文档模型 v2（字段级文档）编辑器的界面文案。
 *
 * 边界与口径：
 * - 位置名称与用户手册/结构面板**逐字一致**：标题行 / 元信息 / 正文前灰字 / 正文 /
 *   正文后灰字 / 隐藏；页眉位置单独一套（姓名行 / 姓名旁小字 / 求职意向 / 联系方式 / 照片）。
 * - 三区卡的三个区：标题与元信息（head）、灰色短字段（lead/trail）、正文（body）。
 * - 按钮写具体动作，不用「确定 / 确认 / 提交」；标题不超过 7 字，Toast 不超过 20 字。
 * - 字段目录已经下发了本地化标签的，本文件不重复；这里只放**目录给不了**的编辑器骨架文案。
 * - 禁止在模块作用域求值 t()：本文件是纯数据。
 */

const document = {
  // ── 位置名称（与结构面板、用户指南逐字一致）────────────────────
  "document.placement.title": "标题行",
  "document.placement.meta": "元信息",
  "document.placement.lead": "正文前灰字",
  "document.placement.trail": "正文后灰字",
  "document.placement.body": "正文",
  "document.placement.hidden": "隐藏",
  /** 位置选择器的无障碍名。 */
  "document.placement.aria": "字段位置",
  /** 隐藏的语义说明：数据保留，只是不上纸面。 */
  "document.placement.hiddenHint": "隐藏的字段仍留在文档里，只是不印到纸面上",

  // ── 页眉位置 ────────────────────────────────────────────────
  "document.headerPlacement.name": "姓名行",
  "document.headerPlacement.name_meta": "姓名旁小字",
  "document.headerPlacement.subtitle": "求职意向行",
  "document.headerPlacement.contact": "联系方式行",
  "document.headerPlacement.photo": "照片",

  // ── 三区卡：区名与空态 ─────────────────────────────────────
  "document.zone.head": "标题与元信息",
  "document.zone.lead": "正文前",
  "document.zone.trail": "正文后",
  "document.zone.body": "正文",
  "document.zone.detail": "灰色短字段",
  "document.zone.detailHint": "短字段在正文前后按列排布，同一行放得下就并排显示",
  "document.zone.emptyLead": "还没有正文前的灰色字段",
  "document.zone.emptyTrail": "还没有正文后的灰色字段",
  "document.zone.emptyBody": "还没有正文内容",
  "document.zone.emptyTitle": "还没有标题字段",
  "document.zone.emptyMeta": "还没有元信息字段",
  "document.zone.dropHere": "松手放到这里",
  "document.zone.hidden": "已隐藏字段",

  // ── 条目卡 ─────────────────────────────────────────────────
  "document.entry.add": "添加条目",
  "document.entry.addHint": "添加一条经历后即可编辑",
  "document.entry.empty": "这个板块还没有条目",
  "document.entry.copy": "复制条目",
  "document.entry.remove": "移除条目",
  "document.entry.hide": "隐藏条目",
  "document.entry.show": "显示条目",
  "document.entry.moveUp": "上移条目",
  "document.entry.moveDown": "下移条目",
  "document.entry.hidden": "条目已隐藏",
  "document.entry.headLayout": "标题布局",
  "document.entry.headLayout.split": "左右",
  "document.entry.headLayout.stacked": "上下",
  "document.entry.headLayout.meta_first": "元信息在上",
  "document.entry.lockContent": "锁定内容",
  "document.entry.lockLayout": "锁定排版",

  // ── 添加字段 / 添加正文块 ───────────────────────────────────
  "document.addField.action": "添加字段",
  "document.addField.custom": "自定义字段",
  "document.addField.customLabel": "字段标签",
  "document.addField.empty": "没有可添加的字段",
  "document.addField.fromProfile": "来自资料",
  "document.addField.materialOnly": "仅素材",
  "document.addField.materialOnlyHint": "只用于生成素材，不印到纸面",
  "document.body.addBlock": "添加正文块",
  "document.body.addFieldBlock": "添加字段块",
  "document.head.addTitle": "添加标题字段",
  "document.head.addMeta": "添加元信息字段",
  "document.detail.addLead": "添加正文前字段",
  "document.detail.addTrail": "添加正文后字段",

  // ── 字段控件 ───────────────────────────────────────────────
  "document.item.drag": "拖动字段",
  "document.item.dragHint": "拖动排序；聚焦后也可用方向键移动",
  "document.item.remove": "移除字段",
  "document.item.hide": "隐藏字段",
  "document.item.show": "显示字段",
  "document.item.solo": "独占一行",
  "document.item.showLabel": "显示标签",
  "document.item.hideLabel": "隐藏标签",
  "document.item.wrap": "值加括号",
  "document.item.moveUp": "上移字段",
  "document.item.moveDown": "下移字段",
  "document.item.format": "格式",
  "document.item.bodyStyle": "正文样式",
  "document.item.bodyStyle.bullet": "要点",
  "document.item.bodyStyle.paragraph": "段落",
  "document.item.materialOnly": "仅素材",
  "document.item.materialOnlyHint": "不上纸面，只用于生成素材",
  "document.item.hiddenBadge": "已隐藏",
  "document.item.fromProfile": "来自资料",
  "document.item.manual": "手动添加",
  "document.item.custom": "自定义字段",
  "document.item.untitled": "未填写",
  "document.item.expand": "展开编辑",
  "document.item.collapse": "收起编辑",
  "document.item.selected": "已选中",
  "document.item.placementAria": "把字段移到{placement}",
  "structure.inspector.title": "字段格式",

  // ── 字段编辑器 ─────────────────────────────────────────────
  "document.field.value": "内容",
  "document.field.valuePlaceholder": "输入内容",
  "document.field.label": "标签",
  "document.field.labelPlaceholder": "字段标签",
  "document.field.dateStart": "开始日期",
  "document.field.dateEnd": "结束日期",
  "document.field.datePresent": "至今",
  "document.field.enumPlaceholder": "选择",
  "document.field.urlPlaceholder": "输入以 https:// 开头的链接",
  "document.field.numberPlaceholder": "输入数字",
  "document.field.periodPlaceholder": "开始日期 - 结束日期",
  "document.field.listAdd": "添加一项",
  "document.field.listPlaceholder": "输入一项",
  "document.field.listEmpty": "还没有内容",
  "document.field.valueAria": "第 {index} 项",
  "document.field.removeValue": "移除这项",
  "document.field.authorsAdd": "添加作者",
  "document.field.authorsEmpty": "还没有作者",
  "document.field.authorName": "姓名",
  "document.field.authorNamePlaceholder": "作者姓名",
  "document.field.authorSelf": "本人",
  "document.field.authorCorresponding": "通讯作者",
  "document.field.authorRemove": "移除作者",
  "document.field.textPlaceholder": "输入正文",

  // ── 拖拽与键盘等价物 ───────────────────────────────────────
  "document.drag.aria": "移动字段：方向键移动，回车确认，Esc 取消",
  "document.drag.grabbed": "已拿起，方向键移动位置，回车确认",
  "document.drag.invalid": "这个位置放不下该字段",
  "document.drag.moved": "字段位置已更新",
  "document.drag.canceled": "已取消移动",
  "document.drag.boundary": "已经到边界了",
  "document.drag.unsupported": "该字段不能放在这里",
  "document.drag.illegalTitle": "不能放到这里",
  "document.drag.illegalBody": "把标题类字段放回标题行或元信息，正文块只放在正文里",

  // ── 板块页签与行内/文本板块 ─────────────────────────────────
  "document.tabs.label": "板块",
  "document.tabs.add": "添加板块",
  "document.section.inlineEmpty": "还没有行内条目",
  "document.section.inlineAdd": "添加{name}",
  "document.section.inlineHint": "每条是一行：正文在前，灰色的补充信息在后",
  "document.section.textHint": "单段文本板块只排正文",
  "document.section.titleLabel": "板块标题",
  "document.section.hideTitle": "不显示板块标题",

  // ── 基本信息（页眉）──────────────────────────────────────
  "document.basic.title": "基本信息",
  "document.basic.hint": "姓名、联系方式与照片等页眉字段",
  "document.basic.empty": "还没有页眉字段",
  "document.basic.add": "添加页眉字段",
  "document.headerField.name": "姓名",
  "document.headerField.gender": "性别",
  "document.headerField.birth_year": "出生年份",
  "document.headerField.phone": "手机",
  "document.headerField.email": "邮箱",
  "document.headerField.city": "城市",
  "document.headerField.job_intent": "求职意向",
  "document.headerField.github": "GitHub",
  "document.headerField.personal_website": "个人主页",
  "document.headerField.photo": "照片",
  "document.headerField.unknown": "自定义字段",

  // ── 提示与无障碍 ───────────────────────────────────────────
  "document.toast.fieldAdded": "已添加字段",
  "document.toast.fieldRemoved": "已移除字段",
  "document.toast.hidden": "已隐藏字段",
  "document.toast.shown": "已显示字段",
  "document.toast.entryAdded": "已添加条目",
  "document.toast.entryRemoved": "已移除条目",
  "document.toast.entryCopied": "已复制条目",
  "document.toast.materialOnly": "仅素材字段不会印到纸面",
  "document.editor.region": "简历文档编辑器",
  "document.editor.readOnly": "只读",
  "document.editor.empty": "还没有任何板块",
  "document.editor.selectHint": "点纸面或结构树可以定位字段",

  // ── 旧简历转换提示（v1 → v2，读取时一次性转换）──────────────
  "document.conversion.title": "旧简历已转换",
  "document.conversion.body": "已整理为字段级结构，文字与条目都在",
  "document.conversion.summary": "查看转换摘要",
  "document.conversion.dismiss": "收起提示",
  "document.conversion.toast": "旧简历已转换，可以继续编辑",

  // ── 目录兜底标签（后端目录接口不可用时）────────────────────
  "document.field.period": "起止时间",
  "document.field.publicUrl": "公开链接",
  "document.field.customContent": "正文内容",
} as const;

export default document;
