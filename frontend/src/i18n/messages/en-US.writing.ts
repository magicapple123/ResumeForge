// SPDX-License-Identifier: Apache-2.0
/**
 * Display copy for the writing tools panel and the text-selection context menu:
 * operation names, polish styles, translation directions, phrase versions, the input
 * placeholder and labels, the result block title, and the six text-action menu names.
 */
const writing = {
  // ── Writing tools: action picker (Segmented) ─────────────
  "writing.operation.star": "STAR rewrite",
  "writing.operation.phrases": "Phrase variants",
  "writing.operation.polish": "Tone polish",
  "writing.operation.translate": "Translate",

  // ── Polish style (radio group) ───────────────────────────
  "writing.style.bigTech": "Corporate",
  "writing.style.conciseTech": "Concise",
  "writing.style.campus": "Recent graduate",
  /** Accessible name for the radio group; it has no visible title. */
  "writing.style.ariaLabel": "Polish style",

  // ── Translation direction (radio group) ──────────────────
  "writing.direction.zh2en": "Chinese to English",
  "writing.direction.en2zh": "English to Chinese",
  /** Accessible name for the radio group. */
  "writing.direction.ariaLabel": "Translation direction",

  // ── Phrase versions (checkbox group and result block titles) ─
  "writing.phraseMode.star": "STAR version",
  "writing.phraseMode.resume": "Resume version",
  "writing.phraseMode.interview": "Spoken interview version",
  /** Accessible name for the checkbox group. */
  "writing.phraseMode.ariaLabel": "Phrase version options",

  // ── Input area and result block ──────────────────────────
  "writing.input.placeholder": "Paste or type a Resume passage",
  /** Accessible name for the input, which has no visible label. */
  "writing.input.ariaLabel": "Text for the writing tools",
  "writing.action.generate": "Generate",
  /** Fallback when generation fails without a more specific reason. */
  "writing.generate.failed": "Generation failed; please try again",
  /** Title of a single result block. */
  "writing.result.label": "Result",

  // ── Text-selection context menu ──────────────────────────
  /** Accessible name for the menu container. */
  "writing.contextMenu.ariaLabel": "Text actions",
  "writing.contextMenu.cut": "Cut",
  "writing.contextMenu.copy": "Copy",
  "writing.contextMenu.paste": "Paste",
  "writing.contextMenu.selectAll": "Select all",
  "writing.contextMenu.aiPolish": "AI polish",
} as const;

export default writing;
