// SPDX-License-Identifier: Apache-2.0
/**
 * 补充事实（A3）界面文案：论文 / 科研项目 / 专利 / 资格证照 / 作品项目 / 实践或服务经历。
 *
 * 边界：
 * - 只放本批新增的 key。论文与专利的状态名、作者字段等与制作台科研板块共用，
 *   直接复用 `research.*` 命名空间（同一状态两处两个叫法必然漂移）。
 * - 状态如实描述、不做推断：论文「在投」不是「已发表」，专利「已申请」不是「已授权」；
 *   资格证照状态由用户自己填，系统不判断"是否有效"。
 * - 证号是本地私密字段：文案必须说明默认不外发、不印到简历。
 */
const profileFacts = {
  // ── 区块外壳 ────────────────────────────────────────────────
  "profileFacts.section.title": "补充事实",
  "profileFacts.section.hint":
    "独立保存，不会改动上方简历资料的旧字段；生成简历时会作为真实事实参考",
  "profileFacts.section.count": "共 {count} 条",
  "profileFacts.section.loading": "正在加载补充事实",
  "profileFacts.section.loadError": "补充事实加载失败：{detail}。可以点「重试」再试一次",
  "profileFacts.section.limitHint": "共 {total} 条，当前显示 {shown} 条",
  "profileFacts.section.schemaWarning": "字段设置加载失败：{detail}。已按默认字段显示",
  "profileFacts.section.schemaRetry": "重试",
  "profileFacts.error.unknown": "原因未知",

  // ── 六类实体名（按钮/标题里用 {label} 插值） ─────────────────
  "profileFacts.kind.publication": "论文",
  "profileFacts.kind.research_project": "科研项目",
  "profileFacts.kind.patent": "专利",
  "profileFacts.kind.credential": "资格证照",
  "profileFacts.kind.work_project": "作品项目",
  "profileFacts.kind.practice": "实践或服务经历",
  "profileFacts.kind.award": "荣誉与获奖",
  "profileFacts.kind.training": "培训与课程",
  "profileFacts.kind.language": "语言能力",

  // ── 空态与新建入口 ──────────────────────────────────────────
  "profileFacts.empty.description":
    "还没有补充事实：论文、科研项目、专利、资格证照、作品项目、实践或服务经历、荣誉与获奖、培训与课程、语言能力都可以在这里单独记录",
  "profileFacts.empty.action": "新建第一条事实",
  "profileFacts.add.button": "新建事实",

  // ── 列表行 ─────────────────────────────────────────────────
  "profileFacts.list.untitled": "未命名",
  "profileFacts.list.editAria": "编辑这条{label}：{title}",
  "profileFacts.list.deleteAria": "删除这条{label}：{title}",
  "profileFacts.list.deleteTooltip": "删除这条{label}：会移入回收站，之后可以在「回收站」里恢复",
  "profileFacts.list.loadMore": "加载更多",

  // ── 编辑器外壳 ─────────────────────────────────────────────
  "profileFacts.editor.createTitle": "新建{label}",
  "profileFacts.editor.editTitle": "编辑{label}",
  "profileFacts.editor.kind": "事实类型",
  "profileFacts.editor.cancel": "取消编辑",
  "profileFacts.editor.conflict": "这条内容已在其他窗口被修改，刷新后再编辑",
  "profileFacts.editor.refresh": "刷新",
  "profileFacts.editor.saveFailedTitle": "没能保存这条{label}",
  "profileFacts.editor.saveFailedFallback": "补充事实保存失败",

  // 保存按钮具体到类别（动词 + 对象，不写「确定」「提交」）。
  "profileFacts.editor.save.publication": "保存这条论文",
  "profileFacts.editor.save.research_project": "保存这条科研项目",
  "profileFacts.editor.save.patent": "保存这项专利",
  "profileFacts.editor.save.credential": "保存这个资格证照",
  "profileFacts.editor.save.work_project": "保存这个作品项目",
  "profileFacts.editor.save.practice": "保存这段实践经历",
  "profileFacts.editor.save.award": "保存这条获奖记录",
  "profileFacts.editor.save.training": "保存这段培训记录",
  "profileFacts.editor.save.language": "保存这项语言能力",
  "profileFacts.editor.customFields": "自定义字段",

  // ── 结果提示 ───────────────────────────────────────────────
  "profileFacts.toast.saved": "已保存这条{label}",
  "profileFacts.toast.deleted": "已删除这条{label}，移入回收站",
  "profileFacts.toast.deleteFailed": "没能删除这条{label}，请重试",

  // ── 实践 / 服务经历 ─────────────────────────────────────────
  "profileFacts.experienceKind.unset": "未设置",
  "profileFacts.experienceKind.full_time": "全职",
  "profileFacts.experienceKind.part_time": "兼职",
  "profileFacts.experienceKind.contract": "合同项目制",
  "profileFacts.experienceKind.self_employed": "自雇",
  "profileFacts.experienceKind.internship": "实习",
  "profileFacts.experienceKind.volunteer": "志愿",
  "profileFacts.experienceKind.other": "其他",
  "profileFacts.practice.organization": "机构或客户",
  "profileFacts.practice.organizationPlaceholder": "如：社区服务中心",
  "profileFacts.practice.role": "角色",
  "profileFacts.practice.rolePlaceholder": "如：志愿者",
  "profileFacts.practice.kind": "关系类型",
  "profileFacts.practice.start": "开始",
  "profileFacts.practice.end": "结束",
  "profileFacts.practice.description": "贡献",
  "profileFacts.practice.descriptionPlaceholder": "每行一条：你做了什么、带来什么结果",

  // ── 作品项目 ───────────────────────────────────────────────
  "profileFacts.workProject.name": "作品名称",
  "profileFacts.workProject.namePlaceholder": "如：品牌官网改版",
  "profileFacts.workProject.role": "本人角色",
  "profileFacts.workProject.rolePlaceholder": "如：主设计 / 独立开发",
  "profileFacts.workProject.start": "开始",
  "profileFacts.workProject.end": "结束",
  "profileFacts.workProject.techStack": "工具与方法",
  "profileFacts.workProject.techStackPlaceholder": "每行一条，如：Figma、用户访谈",
  "profileFacts.workProject.description": "项目说明",
  "profileFacts.workProject.descriptionPlaceholder": "每行一条：背景、你做了什么",
  "profileFacts.workProject.highlights": "成果与亮点",
  "profileFacts.workProject.highlightsPlaceholder": "每行一条：结果、数据或反响",
  "profileFacts.workProject.publicUrl": "公开链接",
  "profileFacts.workProject.publicUrlPlaceholder": "https://…",
  "profileFacts.workProject.artifactType": "成果类型",
  "profileFacts.workProject.artifactTypePlaceholder": "如：网站、文章、设计、课程、代码仓库、其他",

  // ── 作者 / 发明人（顺序即署名顺序） ───────────────────────────
  "profileFacts.people.orderHint": "顺序即署名顺序",
  "profileFacts.people.name": "姓名",
  "profileFacts.people.namePlaceholder": "姓名",
  "profileFacts.people.nameRequired": "请填写姓名",
  "profileFacts.people.nameAria": "第 {index} 位{unit}的姓名",
  "profileFacts.people.authorUnit": "作者",
  "profileFacts.people.inventorUnit": "发明人",
  "profileFacts.people.removeAria": "删除第 {index} 位{unit}",
  "profileFacts.people.moveUpAria": "把第 {index} 位{unit}上移",
  "profileFacts.people.moveDownAria": "把第 {index} 位{unit}下移",

  // ── 从资料箱显式选入（A3）─────────────────────────────────────
  "profileFacts.material.open": "从资料箱选入",
  "profileFacts.material.title": "从资料箱选入",
  "profileFacts.material.hint": "选入后先出现在编辑器里，确认保存才写入补充事实。",
  "profileFacts.material.searchPlaceholder": "搜索资料标题或内容",
  "profileFacts.material.materialLabel": "选择资料",
  "profileFacts.material.materialPlaceholder": "选择一条资料",
  "profileFacts.material.kindLabel": "事实类型",
  "profileFacts.material.confirm": "选入并填写",
  "profileFacts.material.cancel": "取消",
  "profileFacts.material.empty": "资料箱还是空的，可先在资料箱里添加资料",
  "profileFacts.material.loadFailed": "资料箱加载失败，请重试",

  // ── 字段设置（契约 §2-4：隐藏默认字段 / 自定义字段 / 恢复默认）──────────
  "profileFacts.settings.open": "编辑字段",
  "profileFacts.settings.kind": "事实类型",
  "profileFacts.settings.revision": "修订 {revision}",
  "profileFacts.settings.revisionDefault": "默认设置",
  "profileFacts.settings.hint":
    "隐藏的字段不再出现在录入与列表里，已填内容仍保留；自定义字段可按你的行业补充要记录的信息。",
  "profileFacts.settings.defaultFields": "默认字段",
  "profileFacts.settings.defaultHint": "取消勾选即隐藏该字段；恢复默认后重新显示",
  "profileFacts.settings.customFields": "自定义字段",
  "profileFacts.settings.customHint": "最多 {max} 个；名称不能与默认字段重名",
  "profileFacts.settings.addCustom": "添加自定义字段",
  "profileFacts.settings.customPlaceholder": "字段名称，如：项目规模",
  "profileFacts.settings.customAria": "第 {index} 个自定义字段名称",
  "profileFacts.settings.customFallback": "自定义字段 {index}",
  "profileFacts.settings.removeCustomAria": "删除自定义字段：{label}",
  "profileFacts.settings.save": "保存字段设置",
  "profileFacts.settings.saved": "已保存「{label}」的字段设置",
  "profileFacts.settings.reset": "恢复默认",
  "profileFacts.settings.resetDone": "已恢复「{label}」默认字段",
  "profileFacts.settings.resetConfirmTitle": "恢复「{label}」默认字段？",
  "profileFacts.settings.resetConfirmBody": "隐藏与自定义字段设置会清空；已填内容仍保留",
  "profileFacts.settings.resetConfirm": "恢复默认",
  "profileFacts.settings.cancelConfirm": "取消",
  "profileFacts.settings.back": "返回列表",
  "profileFacts.settings.conflict": "「{label}」的字段设置已在其他窗口被修改，刷新后再保存",
  "profileFacts.settings.refresh": "刷新",
  "profileFacts.settings.failedTitle": "没能保存字段设置",
  "profileFacts.settings.failedFallback": "字段设置保存失败",
  "profileFacts.settings.validationTitle": "字段设置不能保存",
  "profileFacts.settings.inputRequired": "请填写字段名称",
  "profileFacts.settings.inputDuplicate": "自定义字段名不能重复：{label}",
  "profileFacts.settings.maxReached": "最多 {max} 个自定义字段",
  "profileFacts.settings.labelTooLong": "字段名称最多 {max} 字",

  // ── 荣誉与获奖（契约 §1 award）──────────────────────────────
  "profileFacts.award.name": "荣誉或获奖名称",
  "profileFacts.award.namePlaceholder": "如：全国大学生数学建模竞赛一等奖",
  "profileFacts.award.issuer": "颁发机构",
  "profileFacts.award.date": "获奖时间",
  "profileFacts.award.level": "级别",
  "profileFacts.award.levelPlaceholder": "如：国家级",
  "profileFacts.award.description": "说明",

  // ── 培训与课程（契约 §1 training）───────────────────────────
  "profileFacts.training.name": "培训或课程名称",
  "profileFacts.training.namePlaceholder": "如：项目管理基础课程",
  "profileFacts.training.organization": "机构",
  "profileFacts.training.start": "开始",
  "profileFacts.training.end": "结束",
  "profileFacts.training.hours": "学时",
  "profileFacts.training.hoursPlaceholder": "如：32",
  "profileFacts.training.description": "培训内容",
  "profileFacts.training.descriptionPlaceholder": "每行一条：学了什么",
  "profileFacts.training.outcomes": "收获与成果",
  "profileFacts.training.outcomesPlaceholder": "每行一条：产出或应用",

  // ── 语言能力（契约 §1 language）─────────────────────────────
  "profileFacts.language.name": "语言",
  "profileFacts.language.namePlaceholder": "如：英语",
  "profileFacts.language.level": "水平",
  "profileFacts.language.levelPlaceholder": "如：CET-6 / 流利",
  "profileFacts.language.certificate": "证书名称",
  "profileFacts.language.certificatePlaceholder": "如：大学英语六级",
  "profileFacts.language.score": "分数",
  "profileFacts.language.scorePlaceholder": "如：512",
  "profileFacts.language.date": "取得时间",

  // ── 自定义字段值在列表/摘要里的一行 ───────────────────────────
  "profileFacts.fact.customFieldLine": "{label}：{value}",
} as const;

export default profileFacts;
