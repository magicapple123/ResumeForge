// SPDX-License-Identifier: Apache-2.0
/**
 * "Custom template" editor dialog: title, form labels, hints, preview and save feedback.
 *
 * The dialog lost its UI entry point in November 2026 (the file stays for historical
 * tests and rollback), but its copy lives here so the component has no second source of
 * truth. The `{{ resume.* }}` / `{% include "..." %}` tokens in `hint.starter` are
 * template syntax, not message placeholders: they contain spaces, so the `{name}`
 * substitution in `translate()` never matches them.
 */
const styleTemplateEditor = {
  "styleTemplateEditor.title.edit": "Edit template",
  "styleTemplateEditor.title.create": "Custom template",
  "styleTemplateEditor.action.save": "Save template",
  "styleTemplateEditor.action.refreshPreview": "Refresh preview",
  "styleTemplateEditor.field.name": "Template name",
  "styleTemplateEditor.placeholder.name": "e.g. My deep blue template",
  "styleTemplateEditor.field.description": "Description (optional)",
  "styleTemplateEditor.placeholder.description": "One line on where it fits",
  "styleTemplateEditor.field.styleControls": "Visual and typography fine-tuning",
  "styleTemplateEditor.field.html": "Template HTML",
  "styleTemplateEditor.hint.starter":
    'A template is a complete HTML page. Available variables: {{ resume.* }} (resume content), {{ page_limit }} (page count), {{ base_px }} (base font size in pixels), {{ csp_nonce }}. You can include the body structure directly: {% include "_resume_sections.j2" %}',
  "styleTemplateEditor.hint.export":
    "HTML preview and HTML export use the full custom styling; PDF / Word go through the backend layout engine, which carries over generic parameters such as accent color, font size, line height and page margins, but does not fully reproduce custom two-column layouts, decorative images or arbitrary CSS.",
  "styleTemplateEditor.hint.sampleResume":
    "The preview uses the built-in sample resume; scripts and external links are stripped automatically on import.",
  "styleTemplateEditor.preview.title": "Template preview",
  "styleTemplateEditor.preview.empty": 'No preview yet - click "Refresh preview" to see one.',
  "styleTemplateEditor.error.load": "Could not load the template",
  "styleTemplateEditor.error.preview": "Could not render the preview",
  "styleTemplateEditor.error.save": "Could not save the template",
  "styleTemplateEditor.error.renderTitle": "Template rendering failed",
  "styleTemplateEditor.toast.needName": "Enter a template name",
  "styleTemplateEditor.toast.htmlTooShort":
    "The template content is too short - provide the complete HTML",
  "styleTemplateEditor.toast.updated": "Template updated",
  "styleTemplateEditor.toast.created":
    "Template created - you can pick it when generating a resume",
} as const;

export default styleTemplateEditor;
