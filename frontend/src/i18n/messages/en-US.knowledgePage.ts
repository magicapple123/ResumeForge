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

  // Filters and export (#29A/#29D/#29G)
  "knowledgePage.filter.company.aria": "Filter by company",
  "knowledgePage.filter.company.all": "All companies",
  "knowledgePage.filter.uncategorized": "Uncategorized only",
  "knowledgePage.filter.category.uncategorized": "Uncategorized",
  "knowledgePage.filter.semantic": "Semantic search",
  "knowledgePage.filter.semantic.aria": "Toggle semantic search",
  "knowledgePage.filter.semantic.hint": "Find by meaning; results show the summary first",
  "knowledgePage.action.export": "Export Markdown",
  "knowledgePage.toast.exported": "Exported {count} entries",
  "knowledgePage.error.exportFailed": "Export failed: {error}",
  "knowledgePage.error.exportEmpty": "There are no entries to export yet",

  // Semantic search (#29A)
  "knowledgePage.semantic.title": "Semantic search results",
  "knowledgePage.semantic.hint": "Matched by meaning; select a result to open the entry",
  "knowledgePage.semantic.empty": "No matching entries",
  "knowledgePage.semantic.loading": "Searching…",
  "knowledgePage.semantic.error": "Semantic search failed: {error}",
  "knowledgePage.semantic.fallback":
    "Vector search unavailable; fell back to keyword matching: {reason}",
  "knowledgePage.semantic.vectorTag": "Vector",
  "knowledgePage.semantic.keywordTag": "Keyword",
  "knowledgePage.semantic.score": "Relevance {score}",

  // Cards (#29C/#29D/#29E)
  "knowledgePage.card.reason": "Why keep this: {reason}",
  "knowledgePage.card.summary": "Summary",
  "knowledgePage.card.keyPoints": "Key points",
  "knowledgePage.card.company": "Company: {company}",
  "knowledgePage.card.job": "Related job #{id}",
  "knowledgePage.card.updated": "Updated {time}",

  // Review prompt (#29F)
  "knowledgePage.review.title": "{count} entries have not been revisited for 30 days",
  "knowledgePage.review.description":
    "A quick review helps retention; you can also skip it — the prompt returns next week.",
  "knowledgePage.review.dismiss": "Don't remind me this week",
  "knowledgePage.review.dismissed": "Review reminder muted for this week",

  "knowledgePage.pagination.total": "Total {count} entries",
  // #29B knowledge capture: interview report / apply failure / resume diagnosis -> entry
  "knowledgePage.capture.interview": "Save to knowledge base",
  "knowledgePage.capture.experience": "Turn into an experience note",
  "knowledgePage.capture.saved": "Saved “{title}” to the knowledge base",
  "knowledgePage.capture.exists":
    "“{title}” is already in the knowledge base; nothing was duplicated",
  "knowledgePage.capture.failed": "Could not save to the knowledge base. Please try again.",
} as const;

export default knowledgePage;
