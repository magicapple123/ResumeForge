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
} as const;

export default enumsResumeCatalog;
