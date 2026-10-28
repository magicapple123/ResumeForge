// SPDX-License-Identifier: Apache-2.0
/**
 * 简历编辑器的分区标题、表单标签、校验提示与占位符。
 *
 * 为什么不复用 `bilingual.field.*`：那套是**双语对照**用的宽泛字段名（「岗位/角色」
 * 「技术栈/工具」），而表单标签要精确到该分区的实际含义（实习用「岗位」、校园用
 * 「职务/角色」、项目用「担任角色」）。同一份简历在两种场景下的用词不同，硬套会让
 * 表单出现"这个条目到底该填什么"的歧义。
 */
const resumeEditor = {
  "editor.field.personName": "姓名",
  "editor.field.photo": "照片",
  "editor.field.gender": "性别",
  "editor.field.birthYear": "出生年份",
  "editor.field.phone": "手机",
  "editor.field.email": "邮箱",
  "editor.field.city": "城市",
  "editor.field.targetCity": "期望城市",
  "editor.field.jobIntent": "求职意向",
  "editor.field.website": "个人主页",
  "editor.field.github": "GitHub",
  "editor.field.summary": "个人总结",
  "editor.field.cet4": "四级分数",
  "editor.field.cet6": "六级分数",
  "editor.field.customSection": "自定义",

  "editor.jobKind.fullTime": "全职",
  "editor.jobKind.partTime": "兼职",
  "editor.jobKind.contract": "合同",
  "editor.jobKind.selfEmployed": "自雇",
  "editor.jobKind.internship": "实习",
  "editor.jobKind.volunteer": "志愿",
  "editor.jobKind.other": "其他",

  "editor.section.education": "教育经历",
  "editor.section.experience": "实习/工作经历",
  "editor.section.campus": "校园经历",
  "editor.section.projects": "项目经历",
  "editor.section.skills": "专业技能",
  "editor.section.awards": "荣誉奖项",

  "editor.field.school": "学校",
  "editor.field.major": "专业",
  "editor.field.degree": "学历",
  "editor.field.startDate": "开始时间",
  "editor.field.endDate": "结束时间",
  "editor.field.gpa": "绩点/排名",
  "editor.field.studyForm": "学习形式",
  "editor.field.degreeType": "学位类型",
  "editor.field.department": "院系",
  "editor.field.classRank": "成绩排名",
  "editor.field.advisor": "导师",
  "editor.field.researchDirection": "研究方向",
  "editor.field.courses": "核心课程",
  "editor.field.studyAchievements": "在校成果",

  "editor.field.company": "公司",
  "editor.field.expRole": "岗位",
  "editor.field.start": "开始",
  "editor.field.end": "结束",
  "editor.field.teamSize": "团队规模",
  "editor.field.jobKind": "工作类型",
  "editor.field.expDescription": "工作内容",

  "editor.field.organization": "组织/部门",
  "editor.field.campusRole": "职务/角色",
  "editor.field.activityType": "活动类型",
  "editor.field.campusDescription": "经历描述",

  "editor.field.projectName": "项目名称",
  "editor.field.projectRole": "担任角色",
  "editor.field.projectSize": "项目规模",
  "editor.field.artifactType": "成果类型",
  "editor.field.techStack": "技术栈",
  "editor.field.projectDescription": "项目描述",
  "editor.field.highlights": "亮点/成果",

  "editor.field.skillName": "技能名称",
  "editor.field.skillLevel": "熟练程度",
  "editor.field.skillCategory": "技能分类",

  "editor.section.languages": "语言能力",
  "editor.field.language": "语言",
  "editor.field.languageLevel": "水平/等级",
  "editor.field.languageCertificate": "证书",
  "editor.field.languageScore": "分数",
  "editor.field.languageObtained": "取得时间",
  "editor.required.language": "请填写语言",
  "editor.placeholder.language": "如：英语",
  "editor.placeholder.languageLevel": "如：CET-6 / 流利",
  "editor.placeholder.languageCertificate": "如：六级证书",
  "editor.placeholder.languageScore": "如：550",
  "editor.placeholder.languageObtained": "如：2024.06",

  "editor.field.awardName": "奖项名称",
  "editor.field.awardDate": "获奖时间",
  "editor.field.issuer": "颁发机构",
  "editor.field.awardLevel": "奖项级别",
  "editor.field.awardRatio": "获奖比例",
  "editor.field.notes": "说明",

  "editor.required.school": "请填写学校",
  "editor.required.company": "请填写公司",
  "editor.required.organization": "请填写组织/部门",
  "editor.required.projectName": "请填写项目名称",
  "editor.required.skillName": "请填写技能名称",
  "editor.required.awardName": "请填写奖项名称",

  "editor.placeholder.classRank": "如：前 10%",
  "editor.placeholder.onePerLine": "每行一项",
  "editor.placeholder.onePointPerLine": "每行一个要点",
  "editor.placeholder.teamSize": "如：8 人",
  "editor.placeholder.skillLevel": "熟练 / 掌握 / 了解",
  "editor.placeholder.skillCategory": "如：编程语言 / 工具",
  "editor.placeholder.awardRatio": "如：前 5%",

  // ── 编辑器头部、「从我的资料填入」下拉与分区条目的增删 ────────────────
  // 三个入口（模块顶部追加 / 条目级填入 / 分区底部的添加与删除）共用同一批候选与
  // 去重语义；后缀带前导空格，拼在候选标题（或「标题（说明）」）后面。
  "editor.header.fillAll": "填入我的资料全部数据",
  "editor.profileFill.title.entry": "从资料填入本条",
  "editor.profileFill.placeholder.entry": "选择资料条目",
  "editor.profileFill.aria.entry": "从我的资料选择填入本条",
  "editor.profileFill.empty": "没有可填入的条目",
  "editor.profileFill.allBlocked": "资料里的{label}都已经在这份简历里了",
  "editor.profileFill.fillEntryAria": "填入本条的{label}",
  "editor.profileFill.action.fill": "填入",
  "editor.profileFill.onlyBlank": "只填空字段",
  /** 候选的「标题（次要说明）」拼接；括号是全角，与资料页的展示一致。 */
  "editor.profileFill.option": "{label}（{hint}）",
  "editor.profileFill.suffix.current": "当前条目",
  "editor.profileFill.suffix.other": "已在其他条目",
  "editor.listSection.removeEntry": "删除这一条{label}",
  "editor.listSection.removeEntryAria": "删除{label}",
  "editor.listSection.addEntry": "添加{label}",
} as const;

export default resumeEditor;
