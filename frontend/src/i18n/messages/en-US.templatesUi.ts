// SPDX-License-Identifier: Apache-2.0
/**
 * Copy for the layout-preset workbench batch: the built-in template gallery, the layout
 * preset editor, the custom preset table, the preset preview, the visual controls and the
 * workbench card.
 *
 * Terminology follows the existing packs: "layout preset" for the parameter presets and
 * "template" for the visual skeleton. The assistant prompts and the persisted badge alt text
 * stay in their source language on purpose (marked `i18n-ok` in the components), because they
 * are model input and stored data rather than UI copy.
 */
const templatesUi = {
  // ── Built-in template thumbnail wall (BuiltinStyleGallery) ─────
  "templatesUi.gallery.thumbAria": 'Preview the "{label}" style',
  "templatesUi.gallery.thumbTitle": "{label} style thumbnail",
  "templatesUi.gallery.modalTitle": "Built-in template preview",
  "templatesUi.gallery.modalTitleWithLabel": "Built-in template preview · {label}",
  "templatesUi.gallery.previewTitle": "Built-in template full-size preview",

  // ── Layout preset editor (FormatTemplateEditorModal) ───────────
  "templatesUi.formatEditor.title.edit": "Edit layout preset",
  "templatesUi.formatEditor.title.create": "Create layout preset",
  "templatesUi.formatEditor.action.save": "Save layout preset",
  "templatesUi.formatEditor.field.name": "Name",
  "templatesUi.formatEditor.placeholder.name": "e.g. My compact layout",
  "templatesUi.formatEditor.field.description": "Description (optional)",
  "templatesUi.formatEditor.placeholder.description": "One line on what problem it solves",
  "templatesUi.formatEditor.value.unset": "Not set",
  "templatesUi.formatEditor.action.clear": "Clear",
  "templatesUi.formatEditor.hint.blank":
    "Leave a field blank to inherit the template's settings; only filled-in items take effect.",
  "templatesUi.formatEditor.error.save": "Could not save",
  "templatesUi.formatEditor.toast.needName": "Enter a name",
  "templatesUi.formatEditor.toast.needValue":
    "Set at least one parameter, or this layout preset has no effect",
  "templatesUi.formatEditor.toast.updated": "Layout preset updated",
  "templatesUi.formatEditor.toast.created":
    "Layout preset created - pick it when generating or previewing a resume",

  // ── Custom layout preset table (TemplateCustomTable) ───────────
  "templatesUi.table.column.template": "Template",
  "templatesUi.table.source": "From {name}",
  "templatesUi.table.noDescription": "(No description)",
  "templatesUi.table.column.actions": "Actions",
  "templatesUi.table.action.preview": "Preview",
  "templatesUi.table.action.edit": "Edit",
  "templatesUi.table.action.ask": "Ask the assistant to change this template",
  "templatesUi.table.action.delete": "Delete",
  "templatesUi.table.confirm.delete":
    'Delete template "{name}"? Resumes using it fall back to the default template.',

  // ── Layout preset preview (TemplatePreviewModal) ───────────────
  "templatesUi.preview.title": "Template preview",
  "templatesUi.preview.titleWithName": "Template preview · {name}",
  "templatesUi.preview.fontScale.small": "Small",
  "templatesUi.preview.fontScale.standard": "Standard",
  "templatesUi.preview.fontScale.large": "Large",
  "templatesUi.preview.followTemplate": "Follow template",
  "templatesUi.preview.demoNote": "The preview uses the built-in sample resume",
  "templatesUi.preview.errorTitle": "Could not render the preview",
  "templatesUi.preview.error": "Could not load the preview",

  // ── Visual controls (TemplateStyleControls) ────────────────────
  "templatesUi.styleControls.label": "Custom badges / images",
  "templatesUi.styleControls.action.add": "Add",
  "templatesUi.styleControls.action.upload": "Upload image",
  "templatesUi.styleControls.placeholder.label": "Badge text (optional)",
  "templatesUi.styleControls.placeholder.inherit": "Follow template",
  "templatesUi.styleControls.colorHexAria": "{label} hex value",
  "templatesUi.styleControls.removeAria": "Remove custom badge {count}",
  "templatesUi.styleControls.hint":
    "Add personal brand, certificate, language or work tags; images must be PNG / JPG / WEBP up to 300 KB and are embedded in the template, so no external URLs are requested.",
  "templatesUi.styleControls.error.imageTooLarge":
    "A badge image cannot exceed 300 KB - shrink or compress it first",
  "templatesUi.styleControls.error.readImage": "Could not read the image",

  // ── Layout preset workbench (TemplateWorkbench) ────────────────
  "templatesUi.workbench.title": "Layout presets",
  "templatesUi.workbench.action.askAssistant": "Ask the Job assistant to build one",
  "templatesUi.workbench.action.create": "Create layout preset",
  "templatesUi.workbench.builtinLabel": "Built-in layout presets:",
  "templatesUi.workbench.empty":
    "No custom layout presets yet. To fit one page, adjusting line height and margins here is fastest.",
  "templatesUi.workbench.error.loadTemplates": "Could not load custom layout presets",
  "templatesUi.workbench.error.loadCatalog": "Could not load the layout preset catalog",
  "templatesUi.workbench.error.delete": "Could not delete",
  "templatesUi.workbench.toast.deleted":
    'Deleted "{name}"; resumes using it fall back to the default layout preset',
} as const;

export default templatesUi;
