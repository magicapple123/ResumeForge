// SPDX-License-Identifier: Apache-2.0
/**
 * 个人资料的分区表单（荣誉奖项 / 校园经历 / 实习工作 / 项目 / 技能）、共用的条目列表容器、
 * 可排序分区外壳，以及识别结果校对清单的界面文案。
 *
 * 这里只有展示文案：条目的对象键（`name` / `organization` / `start_date`）、分区 key
 * （`basic_info`）、`data-profile-section-key` 这类交给后端或做对比的值仍留在组件里，
 * 不翻译也不进包。
 */
const profileUi = {
  /** 荣誉奖项分区（AwardSection）。 */
  "profileUi.award.itemLabel": "荣誉奖项 {index}",
  "profileUi.award.field.name": "奖项名称",
  "profileUi.award.placeholder.name": "如：全国大学生数学建模竞赛一等奖",
  "profileUi.award.field.date": "获得时间",
  "profileUi.award.dateAria": "荣誉奖项{index}获得时间",
  "profileUi.award.field.description": "说明",
  "profileUi.award.placeholder.description": "选填，如：全国前 1%",

  /** 校园经历分区（CampusExperienceSection）。 */
  "profileUi.campus.itemLabel": "校园经历 {index}",
  "profileUi.campus.field.organization": "组织/部门",
  "profileUi.campus.placeholder.organization": "如：学生会、团支部、学院社团",
  "profileUi.campus.field.role": "职务/角色",
  "profileUi.campus.placeholder.role": "如：团支书、部长、负责人",
  "profileUi.campus.field.startDate": "开始时间",
  "profileUi.campus.startDateAria": "校园经历{index}开始时间",
  "profileUi.campus.field.endDate": "结束时间",
  "profileUi.campus.endDateAria": "校园经历{index}结束时间",
  "profileUi.campus.field.description": "经历描述",
  "profileUi.campus.placeholder.description": "负责的工作、组织的活动与取得的结果，每行一条",

  /** 实习/工作经历分区（ExperienceSection）。 */
  "profileUi.experience.itemLabel": "实习/工作经历 {index}",
  "profileUi.experience.field.company": "公司",
  "profileUi.experience.placeholder.company": "如：字节跳动",
  "profileUi.experience.field.role": "岗位",
  "profileUi.experience.placeholder.role": "如：市场部实习生",
  "profileUi.experience.startDateAria": "实习工作经历{index}开始时间",
  "profileUi.experience.endDateAria": "实习工作经历{index}结束时间",
  "profileUi.experience.field.description": "工作内容",
  "profileUi.experience.placeholder.description":
    "每行一条工作内容，尽量包含做了什么、用了什么方法或工具、结果如何（数字量化更好）",

  /** 实习/工作与项目两个分区共用的起止标签（同一含义只留一条 key）。 */
  "profileUi.field.start": "开始",
  "profileUi.field.end": "结束",

  /** 项目经历分区（ProjectSection）。 */
  "profileUi.project.itemLabel": "项目经历 {index}",
  "profileUi.project.field.name": "项目名称",
  "profileUi.project.placeholder.name": "如：AI 简历生成平台",
  "profileUi.project.field.role": "担任角色",
  "profileUi.project.placeholder.role": "如：项目负责人",
  "profileUi.project.startDateAria": "项目经历{index}开始时间",
  "profileUi.project.endDateAria": "项目经历{index}结束时间",
  "profileUi.project.field.techStack": "技术栈 / 工具 / 方法",
  "profileUi.project.placeholder.techStack": "逗号分隔，如：Excel, SQL, 用户调研",
  "profileUi.project.field.description": "项目描述",
  "profileUi.project.placeholder.description": "项目背景、解决了什么问题，每行一条",
  "profileUi.project.field.highlights": "亮点/成果",
  "profileUi.project.placeholder.highlights": "量化成果优先，如：接口性能提升 40%，每行一条",

  /** 专业技能分区（SkillSection）。 */
  "profileUi.skill.itemLabel": "技能 {index}",
  "profileUi.skill.field.name": "技能名称",
  "profileUi.skill.placeholder.name": "如：Python / 深度学习 / React",
  "profileUi.skill.field.level": "熟练程度",
  "profileUi.skill.placeholder.level": "熟练 / 掌握 / 了解",

  /** 条目列表容器（ProfileSection）：拖动把手与删除按钮的可访问名。 */
  "profileUi.entry.drag": "拖动调整{label}顺序",
  "profileUi.entry.delete": "删除{label}",

  /**
   * 可排序分区外壳（ProfileSectionShell）。
   *
   * 带引号的是 Tooltip 标题，不带的是 aria-label——两处渲染结果必须与原中文逐字相同。
   */
  "profileUi.section.moveUpTooltip": "上移“{label}”",
  "profileUi.section.moveUpAria": "上移{label}",
  "profileUi.section.moveDownTooltip": "下移“{label}”",
  "profileUi.section.moveDownAria": "下移{label}",
  "profileUi.section.expandAria": "展开{label}",
  "profileUi.section.collapseAria": "收起{label}",
  "profileUi.section.movedTo": "{label} 已移到第 {order} 位",
  "profileUi.section.dragTooltip": "拖动调整“{label}”顺序",
  "profileUi.section.dragAria": "拖动调整{label}顺序",

  /** 识别结果校对清单（RecognitionReviewList）：分组条数与新字段标签。 */
  "profileUi.review.selectAria": "选用 {label}",
  "profileUi.review.fieldNameAria": "字段名 {label}",
  "profileUi.review.newFieldTag": "新增字段",
  "profileUi.review.itemCount": "（{count} 项）",
} as const;

export default profileUi;
