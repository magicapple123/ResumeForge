// SPDX-License-Identifier: Apache-2.0
/** Append-only exceptions for values whose spelling is independent of locale. */
export const EQUALITY_EXEMPT_KEYS = {
  // A language selector displays the language's native self-name in every locale.
  "resume.language.en-US": "The native language name is English",
  // This is a separator between user-provided values, not a sentence.
  "jobs.candidate.import.preview-meta": "Company and filename interpolation format",
  // Existing consumers use this value as CSS, not as rendered text.
  "outline.canvas.highlight.style": "Canvas highlight CSS declaration",
  // A DOI example is an identifier with an invariant syntax.
  "research.publications.doiPlaceholder": "DOI example identifier",
  // This is a conventional bibliography volume and page-range example.
  "research.publications.volumePagesPlaceholder": "Bibliography volume and pages syntax",
  // A sample URL must remain a valid URL in both languages.
  "typography.inline.linkPlaceholder": "Example URL",
  // These placeholders concatenate labels that have already been translated.
  "versions.variants.exportOption": "Translated variant label interpolation format",
  // The middle dot is a separator before a user-provided job title.
  "versions.variants.exportOption.job": "Job title interpolation separator",
  // Model usage uses the technical accounting unit, rather than English prose.
  "provenance.usage.tokens": "Model accounting unit token",
  // These are official export format names separated by slashes.
  "trial.export.all": "Official export format names",
  // Chinese recruiting says "Offer" too; the label is the same word in both languages.
  "trackerForm.status.offer": "Recruiting loanword spelled identically in both languages",
  // Provider brand names are spelled the same in every locale.
  "appConfig.preset.minimax": "Provider brand name, identical in both languages",
  "appConfig.preset.openai": "Provider brand name, identical in both languages",
  "appConfig.preset.xai": "Provider brand name spelled identically",
  "appConfig.preset.mistral": "Provider brand name spelled identically",
  // The API key label is the same technical term in Chinese UI (original copy used "API Key").
  "userGuide.setupProfile.step1.point9.lead":
    "Technical term used verbatim in the original Chinese copy",
} as const satisfies Readonly<Record<string, string>>;

export function isEqualityExempt(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(EQUALITY_EXEMPT_KEYS, key);
}
