// SPDX-License-Identifier: Apache-2.0
/**
 * 个人资料「教育经历」分区：字段标签、占位提示、学历/学位/学习形式下拉、合成 aria-label。
 *
 * 三个下拉的 `value`（以及表单默认值 `degree: "本科"`）是提交给后端的协议值，还要与
 * 网申表单的下拉选项逐字匹配，全部保留中文；只把 `label` 换成 t()。
 */
const educationSection = {
  "educationSection.itemLabel": "教育经历 {index}",
  "educationSection.field.school": "学校",
  "educationSection.field.department": "院系",
  "educationSection.field.major": "专业",
  "educationSection.field.degree": "学历",
  "educationSection.field.studyMode": "学习形式",
  "educationSection.field.degreeType": "学位",
  "educationSection.field.startDate": "开始时间",
  "educationSection.field.endDate": "结束时间",
  "educationSection.field.gpa": "绩点/排名",
  "educationSection.field.cet4": "英语四级分数",
  "educationSection.field.cet6": "英语六级分数",
  "educationSection.field.courses": "核心课程",
  "educationSection.field.achievements": "在校成果",
  "educationSection.placeholder.school": "如：天津工业大学",
  "educationSection.placeholder.department": "如：计算机科学与技术学院",
  "educationSection.placeholder.major": "如：软件工程",
  "educationSection.placeholder.gpa": "如：3.8/4.0 或 前10%",
  "educationSection.placeholder.cet4": "如：520",
  "educationSection.placeholder.cet6": "如：512",
  "educationSection.placeholder.courses": "每行一门课程",
  "educationSection.placeholder.achievements": "奖学金、竞赛、论文等，每行一条",
  "educationSection.degree.highSchool": "高中",
  "educationSection.degree.juniorCollege": "大专",
  "educationSection.degree.bachelor": "本科",
  "educationSection.degree.master": "硕士",
  "educationSection.degree.doctor": "博士",
  "educationSection.studyMode.fullTime": "全日制",
  "educationSection.studyMode.partTime": "非全日制",
  "educationSection.degreeType.bachelor": "学士",
  "educationSection.degreeType.master": "硕士学位",
  "educationSection.degreeType.doctor": "博士学位",
  "educationSection.degreeType.other": "其他",
  "educationSection.aria.startDate": "教育经历{index}开始时间",
  "educationSection.aria.endDate": "教育经历{index}结束时间",
} as const;

export default educationSection;
