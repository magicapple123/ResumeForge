// SPDX-License-Identifier: Apache-2.0
/**
 * Display names the resume template catalog (`GET /api/resumes/templates`) sends in
 * Chinese: the built-in format presets. Section names and font size tiers reuse keys
 * from their own domains (`editor.section.*`, `resume.fontScale.*`).
 */
const enumsResumeCatalog = {
  "enumsResumeCatalog.formatPreset.standard": "Standard",
  "enumsResumeCatalog.formatPreset.compact": "Compact",
  "enumsResumeCatalog.formatPreset.spacious": "Spacious",
  "enumsResumeCatalog.formatPreset.mono_accent": "Monochrome accent",
  "enumsResumeCatalog.formatPresetDescription.standard":
    "Leaves the template's own layout unchanged",
  "enumsResumeCatalog.formatPresetDescription.compact":
    "Tighter line height and spacing with smaller margins - good for fitting one page",
  "enumsResumeCatalog.formatPresetDescription.spacious":
    "Larger line height and whitespace for a more relaxed look",
  "enumsResumeCatalog.formatPresetDescription.mono_accent":
    "A quiet dark-grey accent for formal, conservative applications",
  // Built-in resume templates (`RESUME_TEMPLATES[].name`); a user-imported template carries
  // its own name and must never be translated.
  "enumsResumeCatalog.template.classic": "Classic",
  "enumsResumeCatalog.template.modern": "Modern",
  "enumsResumeCatalog.template.compact": "Compact",
  "enumsResumeCatalog.template.elegant": "Elegant",
  "enumsResumeCatalog.template.technical": "Technical",
  "enumsResumeCatalog.template.minimal": "Minimal",
  "enumsResumeCatalog.template.scholar": "Academic",
  "enumsResumeCatalog.template.editorial": "Editorial",
  "enumsResumeCatalog.template.split": "Two-column",
  // Same templates' one-line descriptions (`RESUME_TEMPLATES[].description`).
  "enumsResumeCatalog.templateDescription.classic":
    "Deep-blue headings with a left colour bar; a steady, general-purpose layout",
  "enumsResumeCatalog.templateDescription.modern":
    "Teal accents and rounded tags; suits internet-industry roles",
  "enumsResumeCatalog.templateDescription.compact":
    "Thin separators and tight spacing; for content-heavy resumes that must fit one page",
  "enumsResumeCatalog.templateDescription.elegant":
    "Centred headings with serif type and generous whitespace; suits humanities, business and management roles",
  "enumsResumeCatalog.templateDescription.technical":
    "Colour-block headings with monospaced meta; high density, built for engineering roles",
  "enumsResumeCatalog.templateDescription.minimal":
    "Black and grey only, with hierarchy carried by type size; no colour blocks or decoration",
  "enumsResumeCatalog.templateDescription.scholar":
    "Pure black and white, bold headings with hairline rules, short entries in three columns; for research and academic roles",
  "enumsResumeCatalog.templateDescription.editorial":
    "Serif type with hairline dividers; suits humanities, content and management roles",
  "enumsResumeCatalog.templateDescription.split":
    "Two-column body with high density; for resumes with many roles and skills",
} as const;

export default enumsResumeCatalog;
