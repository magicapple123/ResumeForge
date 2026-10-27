// SPDX-License-Identifier: Apache-2.0
/** 字段路径描述：把 `education.0.school` 说成「教育经历的第 1 条学校」。 */
const fieldPath = {
  "fieldPath.point": "要点",
  "fieldPath.outcome": "成果",
  "fieldPath.course": "课程",
  "fieldPath.githubProfile": "GitHub 主页",
  "fieldPath.name": "名称",
  "fieldPath.time": "时间",
  "fieldPath.unspecified": "未指定",
  "fieldPath.scalar": "{section}的{field}",
  "fieldPath.listItem": "{section}的第 {index} 条{field}",
  "fieldPath.sectionWithIdentity": "{section}「{identity}」",
} as const;

export default fieldPath;
