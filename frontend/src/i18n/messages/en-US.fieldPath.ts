// SPDX-License-Identifier: Apache-2.0
/** 字段路径描述：把 `education.0.school` 说成「教育经历的第 1 条学校」。 */
const fieldPath = {
  "fieldPath.point": "Points",
  "fieldPath.outcome": "Outcome",
  "fieldPath.course": "Courses",
  "fieldPath.githubProfile": "GitHub profile",
  "fieldPath.name": "Name",
  "fieldPath.time": "Time",
  "fieldPath.unspecified": "Unspecified",
  "fieldPath.scalar": "{field} of {section}",
  "fieldPath.listItem": "{field} #{index} of {section}",
  "fieldPath.sectionWithIdentity": "{section} “{identity}”",
} as const;

export default fieldPath;
