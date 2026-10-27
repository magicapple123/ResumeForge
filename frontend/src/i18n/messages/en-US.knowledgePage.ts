// SPDX-License-Identifier: Apache-2.0
/**
 * Knowledge base page (`pages/KnowledgePage.tsx`): header copy, filters, card and
 * batch actions, empty and error states, toasts, card accessible names, pagination.
 *
 * Category and tag option values come from the backend and are shown as-is, so they
 * are not part of this pack; entry titles, content and sources are user data too.
 */
const knowledgePage = {
  "knowledgePage.page.title": "Knowledge base",
  "knowledgePage.page.subtitle":
    "Capture written material worth returning to: interview notes, resume tips, job search strategy, industry notes. Content supports Markdown and renders headings, lists and tables once saved.",
  "knowledgePage.action.create": "New entry",
  "knowledgePage.action.edit": "Edit",
  "knowledgePage.action.delete": "Delete",
  "knowledgePage.action.batchSelect": "Select multiple",
  "knowledgePage.batch.noun": "entries",

  "knowledgePage.filter.search.placeholder": "Search title or content",
  "knowledgePage.filter.category.aria": "Filter by category",
  "knowledgePage.filter.tag.aria": "Filter by tag",
  "knowledgePage.filter.category.all": "All categories",
  "knowledgePage.filter.tag.all": "All tags",

  "knowledgePage.empty.none": "No knowledge entries yet",
  "knowledgePage.empty.filtered": "No entries match the current filters",

  "knowledgePage.error.loadFailed": "Failed to load the knowledge base: {error}",
  "knowledgePage.error.loadEntryFailed": "Failed to load the entry",
  "knowledgePage.error.saveFailed": "Failed to save the entry",
  "knowledgePage.error.deleteFailed": "Failed to delete the entry",
  "knowledgePage.error.batchDeleteFailed": "Failed to delete the selected entries. Try again",
  "knowledgePage.toast.updated": "Entry updated",
  "knowledgePage.toast.created": "Added to the knowledge base",
  "knowledgePage.toast.batchDeleted": "Deleted {count} knowledge entries; restore them from Trash",

  "knowledgePage.card.openAria": "Open details for the knowledge entry “{title}”",
  "knowledgePage.card.selectAria": "Select knowledge entry {title}",

  "knowledgePage.pagination.total": "Total {count} entries",
} as const;

export default knowledgePage;
