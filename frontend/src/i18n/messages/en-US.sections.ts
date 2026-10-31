// SPDX-License-Identifier: Apache-2.0
/**
 * Resume template controls, structural group: template, layout preset, section order
 * and page limit (components/resume/ResumeTemplateControls.tsx).
 */
const sections = {
  "sections.templateControls.templateLabel": "Template",
  "sections.templateControls.templateTooltip":
    "Open the template preview to see how each template really renders",
  "sections.templateControls.templateTooltipWithDescription":
    "{description}. Click to open the preview and see how each template really renders",
  "sections.templateControls.templateAriaLabel": "Choose a Resume template and preview it",
  "sections.templateControls.customSuffix": " (custom)",
  "sections.templateControls.formatLabel": "Layout preset",
  "sections.templateControls.formatHint":
    "Layout presets control line height, page margins and accent color; you can create more in the Resume Workbench",
  "sections.templateControls.followTemplate": "Follow template",
  "sections.templateControls.sectionsLabel": "Sections",
  "sections.templateControls.orderTitle": "Reorder sections",
  "sections.templateControls.orderReset": "Restore default order",
  "sections.templateControls.orderListAriaLabel": "Resume section order",
  "sections.templateControls.orderTriggerAriaLabel": "Reorder Resume sections",
  "sections.templateControls.orderSyncProfile": "Sync with profile order",
  "sections.templateControls.orderTriggerHint":
    "Reorder Summary, Education, Projects and other sections within this Resume",
  "sections.templateControls.orderTrigger": "Order",
  "sections.templateControls.orderTriggerAdjusted": "Order (adjusted)",
  "sections.templateControls.orderMoveUp": "Move up",
  "sections.templateControls.orderMoveUpAria": "Move {label} up",
  "sections.templateControls.orderMoveDown": "Move down",
  "sections.templateControls.orderMoveDownAria": "Move {label} down",
  "sections.templateControls.orderHint":
    "The order applies to the preview, PDF, Word and text export; the header (name, target role, contact information) always stays first.",
  "sections.templateControls.customFixedTag": "Fixed at end",
  "sections.templateControls.customFixedHint":
    "Custom sections always render after system sections",
  "sections.templateControls.orderEmpty": "This Resume has no content sections to reorder yet",
  "sections.templateControls.pageLimitLabel": "Page limit",
  "sections.templateControls.pageLimitHint":
    "Maximum number of A4 pages for the Resume; short content leaves natural whitespace instead of stretching",
  "sections.templateControls.pageLimitPages": "{count} pages",
} as const;

export default sections;
