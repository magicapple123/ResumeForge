// SPDX-License-Identifier: Apache-2.0
/**
 * The Toutou floating orb layer: the assistant card shell, the clipboard snippet folder,
 * the orb button's tooltip, the "edit your Profile" prompt card, the save card, the
 * low-interruption tip bubble and the rotating taglines.
 *
 * What the assistant card *contains* belongs to `assistantUi`; this pack only covers the
 * TouTou shell itself. The tagline table (`touTouTips.ts`) stores keys only and resolves
 * them at render time.
 */
const touTou = {
  // ── Assistant card shell (TouTouAssistantCard) ──────────────
  "touTou.assistant.ariaLabel": "Toutou job assistant",
  "touTou.assistant.description":
    "Toutou can help with ResumeForge questions, analyze your resume and jobs, and change permitted data only when you explicitly ask.",
  "touTou.assistant.gripLabel": "Move the Toutou assistant card",
  "touTou.assistant.gripTitle": "Hold and drag to move the card",
  "touTou.assistant.close": "Close the Toutou assistant",

  // ── Clipboard snippet folder (TouTouClipboardCard) ──────────
  "touTou.clipboard.ariaLabel": "Toutou clipboard",
  "touTou.clipboard.title": "Toutou clipboard",
  "touTou.clipboard.gripLabel": "Move the Toutou clipboard",
  "touTou.clipboard.close": "Close the Toutou clipboard",
  "touTou.clipboard.hint": "Save text you paste often as snippets and copy it in one click.",
  "touTou.clipboard.add": "Add snippet",
  "touTou.clipboard.limitReached": "Snippet limit reached ({count})",
  "touTou.clipboard.empty": "No snippets yet — save what you paste often and copy it in one click.",
  "touTou.clipboard.copy": "Copy",
  "touTou.clipboard.edit": "Edit",
  "touTou.clipboard.delete": "Delete",
  "touTou.clipboard.deleteConfirm": "Delete this snippet?",
  "touTou.clipboard.untitled": "Untitled snippet",
  "touTou.clipboard.saved": "Snippet saved",
  "touTou.clipboard.deleted": "Snippet deleted",
  "touTou.clipboard.copied": "Copied “{title}”",
  "touTou.clipboard.copyFailed": "Copy failed — select the text and copy it manually",
  "touTou.clipboard.emptyContent": "Content cannot be empty",
  "touTou.clipboard.titlePlaceholder":
    "Snippet name (leave it blank to use the first 20 characters; up to {max} characters)",
  "touTou.clipboard.contentPlaceholder":
    "Snippet content (copying pastes this saved text exactly as written)",
  "touTou.clipboard.contentLimit": "Reached the {max}-character limit",
  "touTou.clipboard.cancel": "Cancel",
  "touTou.clipboard.save": "Save",

  // ── Orb button (TouTouOrbButton) ────────────────────────────
  "touTou.orb.tooltip": "Click: open the job assistant; double-click: open the Toutou clipboard",
  "touTou.orb.ariaLabel": "Open the Job assistant",

  // ── Profile prompt card (TouTouProfilePromptCard) ───────────
  "touTou.profilePrompt.ariaLabel": "Edit My Profile",
  "touTou.profilePrompt.title": "Want to add or change something?",
  "touTou.profilePrompt.close": "Close the prompt card",
  "touTou.profilePrompt.edit": "Edit Profile",

  // ── Save card (TouTouSaveCard) ──────────────────────────────
  "touTou.save.ariaLabel": "Save resume details",
  "touTou.save.title": "You have unsaved changes",
  "touTou.save.save": "Save details",
  "touTou.save.cancel": "Cancel",

  // ── Low-interruption tip bubble (TouTouTip) ─────────────────
  "touTou.tip.close": "Close the Toutou tip",

  // ── Rotating taglines (touTouTips) ──────────────────────────
  "touTou.tips.results":
    "When writing about experience, lead with the outcome, then add the actions you took and the evidence behind them.",
  "touTou.tips.verbs":
    "Verbs that keep showing up in the posting are usually the ones worth aligning with during resume screening.",
  "touTou.tips.numbers":
    "Every number on your resume needs a definition you can explain — interviewers will often follow up on it.",
  "touTou.tips.applyMatch":
    "Before applying, check that the job, resume version and attachments all match; it prevents a lot of avoidable mistakes.",
  "touTou.tips.star":
    "Draft interview answers in STAR form first, then add your trade-offs, boundaries and lessons learned.",
  "touTou.tips.facts":
    "Not sure how to describe an experience? Ask Toutou to check the facts ledger first, then suggest a conservative phrasing.",
  "touTou.tips.context":
    "The ResumeForge assistant can link jobs and resumes — include that context in your question and the advice gets more specific.",
  "touTou.tips.verify":
    "Check generated results against the facts and your personal boundaries before exporting or applying; AI cannot confirm your real experience for you.",
} as const;

export default touTou;
