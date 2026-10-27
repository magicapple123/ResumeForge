// SPDX-License-Identifier: Apache-2.0
/**
 * Knowledge entry editor: the dialog title, save action, intro, shortcut hint, field
 * labels, placeholders and the title validation message.
 *
 * The category and source fallbacks are protocol values (they are sent to the backend
 * in the payload and act as list grouping keys), so they stay in the component.
 * Category options come from the backend and from `KNOWLEDGE_CATEGORIES` and are shown
 * as-is.
 */
const knowledgeForm = {
  "knowledgeForm.title.edit": "Edit knowledge entry",
  "knowledgeForm.title.create": "New knowledge entry",
  "knowledgeForm.action.save": "Save entry",
  "knowledgeForm.intro":
    "The knowledge base holds write-ups you expect to come back to: interview notes, resume tips, job search strategy, industry notes. Content supports Markdown and renders headings, lists and tables once saved.",
  "knowledgeForm.hint.shortcut": "Ctrl / ⌘ + Enter or S to save, Esc to cancel",
  "knowledgeForm.label.title": "Title",
  "knowledgeForm.label.category": "Category",
  "knowledgeForm.label.tags": "Tags",
  "knowledgeForm.label.source": "Source",
  "knowledgeForm.label.content": "Content",
  "knowledgeForm.error.titleRequired": "Enter a title",
  "knowledgeForm.placeholder.title": "e.g. STAR method / self-introduction template",
  "knowledgeForm.placeholder.category": "Pick a category or type a new one",
  "knowledgeForm.placeholder.tags": "Type a tag and press Enter, e.g. resume, STAR, metrics",
  "knowledgeForm.placeholder.source": "e.g. Manual entry / interview notes import",
  "knowledgeForm.placeholder.content":
    "Markdown supported:\n# Heading\n- List item\n**bold**, `code`, tables and more",
} as const;

export default knowledgeForm;
