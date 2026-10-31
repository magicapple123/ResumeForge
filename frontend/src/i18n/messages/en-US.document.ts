// SPDX-License-Identifier: Apache-2.0
/**
 * English copy for the v2 resume document editor.
 *
 * Positions are the same words used by the structure panel and the user guide:
 * title line / metadata / gray fields before body / body / gray fields after body / hidden.
 * Buttons name the action; no "OK" / "Confirm" / "Submit".
 */

const document = {
  // ── Positions ────────────────────────────────────────────────
  "document.placement.title": "Title line",
  "document.placement.meta": "Metadata",
  "document.placement.lead": "Gray fields before body",
  "document.placement.trail": "Gray fields after body",
  "document.placement.body": "Body",
  "document.placement.hidden": "Hidden",
  "document.placement.aria": "Field position",
  "document.placement.hiddenHint": "Hidden fields stay in the document but are never printed",

  // ── Header positions ────────────────────────────────────────
  "document.headerPlacement.name": "Name line",
  "document.headerPlacement.name_meta": "Text next to name",
  "document.headerPlacement.subtitle": "Job intent",
  "document.headerPlacement.contact": "Contact line",
  "document.headerPlacement.photo": "Photo",

  // ── Three zones ─────────────────────────────────────────────
  "document.zone.head": "Title and metadata",
  "document.zone.lead": "Before body",
  "document.zone.trail": "After body",
  "document.zone.body": "Body",
  "document.zone.detail": "Gray short fields",
  "document.zone.detailHint": "Short fields run in columns before and after the body",
  "document.zone.emptyLead": "No gray fields before the body yet",
  "document.zone.emptyTrail": "No gray fields after the body yet",
  "document.zone.emptyBody": "No body content yet",
  "document.zone.emptyTitle": "No title fields yet",
  "document.zone.emptyMeta": "No metadata fields yet",
  "document.zone.dropHere": "Drop here",
  "document.zone.hidden": "Hidden fields",

  // ── Entry card ──────────────────────────────────────────────
  "document.entry.add": "Add entry",
  "document.entry.addHint": "Add an entry to start editing",
  "document.entry.empty": "This section has no entries yet",
  "document.entry.copy": "Copy entry",
  "document.entry.remove": "Remove entry",
  "document.entry.hide": "Hide entry",
  "document.entry.show": "Show entry",
  "document.entry.moveUp": "Move entry up",
  "document.entry.moveDown": "Move entry down",
  "document.entry.hidden": "Entry hidden",
  "document.entry.headLayout": "Title layout",
  "document.entry.headLayout.split": "Side by side",
  "document.entry.headLayout.stacked": "Stacked",
  "document.entry.headLayout.meta_first": "Metadata first",
  "document.entry.lockContent": "Lock content",
  "document.entry.lockLayout": "Lock layout",

  // ── Add field / add body block ──────────────────────────────
  "document.addField.action": "Add field",
  "document.addField.custom": "Custom field",
  "document.addField.customLabel": "Field label",
  "document.addField.empty": "No fields left to add",
  "document.addField.fromProfile": "From profile",
  "document.addField.materialOnly": "Material only",
  "document.addField.materialOnlyHint": "Used for generation material only, never printed",
  "document.body.addBlock": "Add body block",
  "document.body.addFieldBlock": "Add field block",
  "document.head.addTitle": "Add title field",
  "document.head.addMeta": "Add metadata field",
  "document.detail.addLead": "Add field before body",
  "document.detail.addTrail": "Add field after body",

  // ── Item controls ───────────────────────────────────────────
  "document.item.drag": "Drag field",
  "document.item.dragHint": "Drag to reorder; keyboard arrows work too",
  "document.item.remove": "Remove field",
  "document.item.hide": "Hide field",
  "document.item.show": "Show field",
  "document.item.solo": "Full row",
  "document.item.showLabel": "Show label",
  "document.item.hideLabel": "Hide label",
  "document.item.wrap": "Wrap value in parentheses",
  "document.item.moveUp": "Move field up",
  "document.item.moveDown": "Move field down",
  "document.item.format": "Format",
  "document.item.bodyStyle": "Body style",
  "document.item.bodyStyle.bullet": "Bullet",
  "document.item.bodyStyle.paragraph": "Paragraph",
  "document.item.materialOnly": "Material only",
  "document.item.materialOnlyHint": "Never printed; generation material only",
  "document.item.hiddenBadge": "Hidden",
  "document.item.fromProfile": "From profile",
  "document.item.manual": "Added manually",
  "document.item.custom": "Custom field",
  "document.item.untitled": "Not filled in",
  "document.item.expand": "Expand editor",
  "document.item.collapse": "Collapse editor",
  "document.item.selected": "Selected",
  "document.item.placementAria": "Move field to {placement}",
  "structure.inspector.title": "Field format",

  // ── Field editors ───────────────────────────────────────────
  "document.field.value": "Value",
  "document.field.valuePlaceholder": "Enter a value",
  "document.field.label": "Label",
  "document.field.labelPlaceholder": "Field label",
  "document.field.dateStart": "Start date",
  "document.field.dateEnd": "End date",
  "document.field.datePresent": "Present",
  "document.field.enumPlaceholder": "Choose one",
  "document.field.urlPlaceholder": "Enter a link starting with https://",
  "document.field.numberPlaceholder": "Enter a number",
  "document.field.periodPlaceholder": "Start date - end date",
  "document.field.listAdd": "Add item",
  "document.field.listPlaceholder": "Enter an item",
  "document.field.listEmpty": "No items yet",
  "document.field.valueAria": "Item {index}",
  "document.field.removeValue": "Remove this item",
  "document.field.authorsAdd": "Add author",
  "document.field.authorsEmpty": "No authors yet",
  "document.field.authorName": "Name",
  "document.field.authorNamePlaceholder": "Author name",
  "document.field.authorSelf": "Me",
  "document.field.authorCorresponding": "Corresponding",
  "document.field.authorRemove": "Remove author",
  "document.field.textPlaceholder": "Enter body text",

  // ── Drag and keyboard equivalents ───────────────────────────
  "document.drag.aria": "Move field: arrow keys move, Enter confirms, Esc cancels",
  "document.drag.grabbed": "Picked up; arrow keys move, Enter confirms",
  "document.drag.invalid": "This field cannot go there",
  "document.drag.moved": "Field position updated",
  "document.drag.canceled": "Move cancelled",
  "document.drag.boundary": "Already at the edge",
  "document.drag.unsupported": "This field cannot be placed here",
  "document.drag.illegalTitle": "Cannot drop here",
  "document.drag.illegalBody":
    "Keep short fields in the head or grey rows; body blocks belong in the body",

  // ── Section tabs and inline/text sections ───────────────────
  "document.tabs.label": "Sections",
  "document.tabs.add": "Add section",
  "document.section.inlineEmpty": "No inline entries yet",
  "document.section.inlineAdd": "Add {name}",
  "document.section.inlineHint": "One row per entry: body text first, grey extras after",
  "document.section.textHint": "A text section prints one paragraph",
  "document.section.titleLabel": "Section title",
  "document.section.hideTitle": "Hide section title",

  // ── Basic info (header) ─────────────────────────────────────
  "document.basic.title": "Basic info",
  "document.basic.hint": "Name, contact details and other header fields",
  "document.basic.empty": "No header fields yet",
  "document.basic.add": "Add header field",
  "document.headerField.name": "Name",
  "document.headerField.gender": "Gender",
  "document.headerField.birth_year": "Birth year",
  "document.headerField.phone": "Phone",
  "document.headerField.email": "Email",
  "document.headerField.city": "City",
  "document.headerField.job_intent": "Objective",
  "document.headerField.github": "GitHub",
  "document.headerField.personal_website": "Personal site",
  "document.headerField.photo": "Photo",
  "document.headerField.unknown": "Custom field",

  // ── Toasts and accessibility ────────────────────────────────
  "document.toast.fieldAdded": "Field added",
  "document.toast.fieldRemoved": "Field removed",
  "document.toast.hidden": "Field hidden",
  "document.toast.shown": "Field shown",
  "document.toast.entryAdded": "Entry added",
  "document.toast.entryRemoved": "Entry removed",
  "document.toast.entryCopied": "Entry copied",
  "document.toast.materialOnly": "Material-only fields are never printed",
  "document.editor.region": "Resume document editor",
  "document.editor.readOnly": "Read only",
  "document.editor.empty": "No sections yet",
  "document.editor.selectHint": "Click the page or the structure tree to locate a field",

  // ── Old resume conversion notice (v1 → v2, converted on read) ──
  "document.conversion.title": "Resume converted",
  "document.conversion.body": "Reorganized into fields; all text and entries kept",
  "document.conversion.summary": "View conversion summary",
  "document.conversion.dismiss": "Dismiss notice",
  "document.conversion.toast": "Resume converted; you can keep editing",

  // ── Catalog fallback labels ─────────────────────────────────
  "document.field.period": "Date range",
  "document.field.publicUrl": "Public link",
  "document.field.customContent": "Content",
} as const;

export default document;
