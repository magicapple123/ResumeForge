// SPDX-License-Identifier: Apache-2.0
/**
 * Profile section forms (awards, campus experience, work experience, projects, skills), the
 * shared entry-list container, the sortable section shell and the recognition review checklist.
 *
 * Display copy only: entry object keys (`name` / `organization` / `start_date`), section keys
 * (`basic_info`) and `data-profile-section-key` values are protocol data and stay in the
 * components.
 */
const profileUi = {
  /** Awards section (AwardSection). */
  "profileUi.award.itemLabel": "Award {index}",
  "profileUi.award.field.name": "Award name",
  "profileUi.award.placeholder.name": "e.g. First prize, National Mathematical Modeling Contest",
  "profileUi.award.field.date": "Date received",
  "profileUi.award.dateAria": "Award {index} date received",
  "profileUi.award.field.description": "Notes",
  "profileUi.award.placeholder.description": "Optional, e.g. top 1% nationwide",

  /** Campus experience section (CampusExperienceSection). */
  "profileUi.campus.itemLabel": "Campus experience {index}",
  "profileUi.campus.field.organization": "Organization",
  "profileUi.campus.placeholder.organization": "e.g. Student union, youth league branch, club",
  "profileUi.campus.field.role": "Role",
  "profileUi.campus.placeholder.role": "e.g. Youth league secretary, department head, lead",
  "profileUi.campus.field.startDate": "Start date",
  "profileUi.campus.startDateAria": "Campus experience {index} start date",
  "profileUi.campus.field.endDate": "End date",
  "profileUi.campus.endDateAria": "Campus experience {index} end date",
  "profileUi.campus.field.description": "Description",
  "profileUi.campus.placeholder.description":
    "What you handled, what you organized and what came of it - one per line",

  /** Work experience section (ExperienceSection). */
  "profileUi.experience.itemLabel": "Work experience {index}",
  "profileUi.experience.field.company": "Company",
  "profileUi.experience.placeholder.company": "e.g. ByteDance",
  "profileUi.experience.field.role": "Title",
  "profileUi.experience.placeholder.role": "e.g. Marketing intern",
  "profileUi.experience.startDateAria": "Work experience {index} start date",
  "profileUi.experience.endDateAria": "Work experience {index} end date",
  "profileUi.experience.field.description": "Responsibilities",
  "profileUi.experience.placeholder.description":
    "One line per item - what you did, the method or tool you used, and the result (numbers are better)",

  /** Start / end labels shared by the work experience and project sections. */
  "profileUi.field.start": "Start",
  "profileUi.field.end": "End",

  /** Project section (ProjectSection). */
  "profileUi.project.itemLabel": "Project {index}",
  "profileUi.project.field.name": "Project name",
  "profileUi.project.placeholder.name": "e.g. AI resume builder",
  "profileUi.project.field.role": "Your role",
  "profileUi.project.placeholder.role": "e.g. Project lead",
  "profileUi.project.startDateAria": "Project {index} start date",
  "profileUi.project.endDateAria": "Project {index} end date",
  "profileUi.project.field.techStack": "Stack / tools / methods",
  "profileUi.project.placeholder.techStack": "Comma separated, e.g. Excel, SQL, user research",
  "profileUi.project.field.description": "Description",
  "profileUi.project.placeholder.description":
    "Background and the problem it solved - one per line",
  "profileUi.project.field.highlights": "Highlights",
  "profileUi.project.placeholder.highlights":
    "Quantified results first, e.g. 40% faster API - one per line",

  /** Skills section (SkillSection). */
  "profileUi.skill.itemLabel": "Skill {index}",
  "profileUi.skill.field.name": "Skill name",
  "profileUi.skill.placeholder.name": "e.g. Python / deep learning / React",
  "profileUi.skill.field.level": "Proficiency",
  "profileUi.skill.placeholder.level": "Proficient / working / basic",

  /** Entry-list container (ProfileSection): accessible names of the drag handle and delete button. */
  "profileUi.entry.drag": "Drag to reorder {label}",
  "profileUi.entry.delete": "Delete {label}",

  /**
   * Sortable section shell (ProfileSectionShell).
   *
   * Tooltip titles keep the quoted form of the Chinese copy; aria-labels stay unquoted so the
   * rendered strings match the migrated source exactly.
   */
  "profileUi.section.moveUpTooltip": "Move {label} up",
  "profileUi.section.moveUpAria": "Move {label} up",
  "profileUi.section.moveDownTooltip": "Move {label} down",
  "profileUi.section.moveDownAria": "Move {label} down",
  "profileUi.section.expandAria": "Expand {label}",
  "profileUi.section.collapseAria": "Collapse {label}",
  "profileUi.section.movedTo": "{label} moved to position {order}",
  "profileUi.section.dragTooltip": "Drag to reorder {label}",
  "profileUi.section.dragAria": "Drag to reorder {label}",

  /** Recognition review checklist (RecognitionReviewList): group counts and the new-field tag. */
  "profileUi.review.selectAria": "Use {label}",
  "profileUi.review.fieldNameAria": "Field name {label}",
  "profileUi.review.newFieldTag": "New field",
  "profileUi.review.itemCount": " ({count} items)",
} as const;

export default profileUi;
