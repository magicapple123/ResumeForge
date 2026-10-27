// SPDX-License-Identifier: Apache-2.0
/**
 * Profile "education" section: field labels, placeholders, the degree / study-mode /
 * degree-awarded dropdowns and the synthesized aria-labels.
 *
 * The dropdown `value`s (and the form default `degree: "本科"`) are values submitted to
 * the backend and matched verbatim against web-form dropdowns, so they stay Chinese;
 * only `label` is translated.
 */
const educationSection = {
  "educationSection.itemLabel": "Education {index}",
  "educationSection.field.school": "School",
  "educationSection.field.department": "Department",
  "educationSection.field.major": "Major",
  "educationSection.field.degree": "Degree",
  "educationSection.field.studyMode": "Study mode",
  "educationSection.field.degreeType": "Degree awarded",
  "educationSection.field.startDate": "Start",
  "educationSection.field.endDate": "End",
  "educationSection.field.gpa": "GPA / class rank",
  "educationSection.field.cet4": "CET-4 score",
  "educationSection.field.cet6": "CET-6 score",
  "educationSection.field.courses": "Core courses",
  "educationSection.field.achievements": "Achievements",
  "educationSection.placeholder.school": "e.g. Tianjin Polytechnic University",
  "educationSection.placeholder.department": "e.g. School of Computer Science and Technology",
  "educationSection.placeholder.major": "e.g. Software Engineering",
  "educationSection.placeholder.gpa": "e.g. 3.8/4.0 or top 10%",
  "educationSection.placeholder.cet4": "e.g. 520",
  "educationSection.placeholder.cet6": "e.g. 512",
  "educationSection.placeholder.courses": "One course per line",
  "educationSection.placeholder.achievements": "Scholarships, competitions, papers - one per line",
  "educationSection.degree.highSchool": "High school",
  "educationSection.degree.juniorCollege": "Associate degree",
  "educationSection.degree.bachelor": "Bachelor's",
  "educationSection.degree.master": "Master's",
  "educationSection.degree.doctor": "Doctorate",
  "educationSection.studyMode.fullTime": "Full-time",
  "educationSection.studyMode.partTime": "Part-time",
  "educationSection.degreeType.bachelor": "Bachelor's degree",
  "educationSection.degreeType.master": "Master's degree",
  "educationSection.degreeType.doctor": "Doctoral degree",
  "educationSection.degreeType.other": "Other",
  "educationSection.aria.startDate": "Education {index} start date",
  "educationSection.aria.endDate": "Education {index} end date",
} as const;

export default educationSection;
