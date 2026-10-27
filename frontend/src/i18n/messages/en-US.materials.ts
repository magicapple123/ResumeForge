// SPDX-License-Identifier: Apache-2.0
/** 表达资产页（与 zh-CN.materials.ts 一一对应）。 */
const materials = {
  "materials.page.title": "Material library",
  "materials.page.subtitle1":
    "Keep job-search and interview material here: certificates, work samples, interview notes, company research, interview retrospectives, internship documents, links and notes.",
  "materials.page.subtitle2":
    "The assistant can read them, sort them, summarise a single item, or turn one into Profile content.",
  "materials.action.create": "Add material",
  "materials.action.edit": "Edit",
  "materials.action.delete": "Delete",
  "materials.selectMode": "Select",
  "materials.tab.materials": "Materials",
  "materials.tab.files": "My files",
  "materials.search.placeholder": "Search titles, content or notes",
  "materials.filters.aria": "Material category filter",
  "materials.filter.all": "All categories",
  "materials.noun": "materials",
  "materials.untitled": "(Untitled material)",
  "materials.link": "Link",
  "materials.attachments": "{count} attachments",
  "materials.table.total": "{count} total",
  "materials.error.loadFailed": "Could not load the material library: {error}",
  "materials.empty.none": "No materials yet",
  "materials.empty.filtered": "No materials match these filters",
  "materials.aria.open": "Open details for “{title}”",
  "materials.aria.select": "Select {title}",

  "materials.toast.updated": "Material updated",
  "materials.toast.added": "Added to the material library",
  "materials.toast.saveFailed": "Could not save",
  "materials.toast.deleteFailed": "Could not delete",
  "materials.toast.batchDeleted": "Deleted {count} materials; restore them from the Trash",
  "materials.toast.batchDeleteFailed": "Could not delete the selection — try again",
  "materials.toast.detailFailed": "Could not load material details",
  "materials.toast.loadFailed": "Could not load materials",

  "materials.detail.attachments": "Attachments",
  "materials.detail.fileCount": "{count}",
  "materials.detail.createdAt": "Created",
  "materials.detail.updatedAt": "Updated",
  "materials.detail.body": "Content",
  "materials.detail.note": "Notes",
  "materials.detail.none": "(None)",
  "materials.detail.attachmentsTitle": "Attachments ({count})",
  "materials.file.image": "Image · {size} KB",
  "materials.file.text": "{count} characters",
} as const;

export default materials;
