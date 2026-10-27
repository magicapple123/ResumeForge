// SPDX-License-Identifier: Apache-2.0
/**
 * Favorites page: title and intro, both tabs, the job and resume table columns and
 * sources, row actions, empty states and the pagination total.
 */
const favorites = {
  "favorites.page.title": "Favorites",
  "favorites.page.subtitle": "Keep the jobs you care about and every resume version in one place",
  "favorites.tab.jobs": "Jobs",
  "favorites.tab.resumes": "Resumes",
  "favorites.column.job": "Job",
  "favorites.column.company": "Company",
  "favorites.column.location": "Location",
  "favorites.column.postedAt": "Posted",
  "favorites.column.actions": "Actions",
  "favorites.column.resume": "Resume",
  "favorites.column.targetJob": "Target job",
  "favorites.column.source": "Source",
  "favorites.column.createdAt": "Created",
  "favorites.source.manual": "User-written",
  "favorites.source.ai": "AI-generated",
  "favorites.action.unfavorite": "Remove from favorites",
  "favorites.action.openJob": "Open job details",
  "favorites.action.previewExport": "Preview / export",
  "favorites.tooltip.importedAt": "Imported at {time}",
  "favorites.empty.jobs": "No saved jobs yet",
  "favorites.empty.resumes": "No saved resumes yet",
  "favorites.pagination.total": "{total} favorites in total",
  "favorites.error.unfavoriteFailed": "Could not remove this favorite",
} as const;

export default favorites;
