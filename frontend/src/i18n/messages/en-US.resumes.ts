// SPDX-License-Identifier: Apache-2.0
/**
 * Resume Center table: column headers, sort hints, the row action menu, the favorite
 * button, the target job cell and the pagination total.
 *
 * Covers `pages/resumes/ResumeTable.tsx` only. The card view's wording lives in
 * `en-US.responsive.ts`, and its delete-confirmation buttons are the shared
 * `resumes.remove.confirm.*` keys there — neither is duplicated here.
 */
const resumes = {
  "resumes.list.column.favorite": "Favorite",
  "resumes.list.column.title": "Resume title",
  "resumes.list.column.job": "Target job",
  "resumes.list.column.source": "Source",
  "resumes.list.column.model": "Model",
  "resumes.list.column.note": "Note",
  "resumes.list.column.enhancement": "Enhancement",
  "resumes.list.column.created": "Created",
  "resumes.list.column.updated": "Last modified",
  "resumes.list.column.actions": "Actions",
  "resumes.list.sort": "Sort by {label}",

  "resumes.list.preview": "Preview / export",
  "resumes.list.rename": "Rename",
  "resumes.list.note": "Edit note",
  "resumes.list.diff": "Compare versions",
  "resumes.list.favorite": "Add to favorites",
  "resumes.list.unfavorite": "Remove from favorites",
  "resumes.list.deleteTitle": "Delete this Resume?",
  "resumes.list.deleteBody": "This Resume will move to the Trash, where you can restore it.",

  "resumes.list.favoriteAdd": "Favorite this Resume",
  "resumes.list.favoriteRemove": "Remove this Resume from favorites",

  "resumes.list.general": "General Resume",
  "resumes.list.generalHint": "Not tied to any Job, so it can target several directions",
  "resumes.list.intent": "Objective: {job}",

  "resumes.list.sourceManual": "Manually created",
  "resumes.list.sourceAi": "AI-generated",
  "resumes.list.off": "Off",
  "resumes.list.on": "On",
  "resumes.list.enhancementOn": "Experience enhancement is on",
  "resumes.list.scrollRegion": "Resume list (scrolls horizontally)",
  "resumes.list.total": "Total {total} records",
  "resumes.list.column.delivery": "Applications",
  "resumes.list.column.lastUpdated": "Last updated",
  "resumes.list.group.expand": "Show versions",
  "resumes.list.group.collapse": "Hide versions",
  "resumes.list.group.title": "{job} · {count} versions",
  "resumes.list.group.titleFallback": "Untitled job · {count} versions",
  "resumes.list.group.updated": "Updated {time}",
  "resumes.list.group.delivery": "Applied {count} times",
  "resumes.list.versionListRegion": "Versions of {job}",
  "resumes.list.versionLabel": "Version {index}",
  "resumes.list.latestVersion": "Latest",
  "resumes.list.group.favoriteHint": "A version in this group is favorited",
  "resumes.list.groupSelectDisabled": "Expand this job to act on one version at a time",
  "resumes.list.selectAllFolded":
    "Selecting all is off in folded view; expand a job or filter by job first",
  "resumes.list.capped":
    "Showing the first 2000 resumes; narrow the range with search or the job filter",
} as const;

export default resumes;
