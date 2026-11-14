// SPDX-License-Identifier: Apache-2.0
/**
 * The Toutou floating orb layer: the assistant card shell, the clipboard snippet folder,
 * the orb button's tooltip, the "edit your Profile" prompt card, the save card, the
 * low-interruption tip bubble, and the six #27 pieces (page awareness, selection
 * actions, the action panel, the interruption budget, side questions and proposals).
 *
 * What the assistant card *contains* belongs to `assistantUi`; this pack only covers the
 * TouTou shell itself. Actions and signals store keys and resolve them at render time.
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
  "touTou.orb.tooltip":
    "Click: open the job assistant; double-click: open the Toutou clipboard; long-press: open the action panel; with text selected, {shortcut} opens the selection actions",
  "touTou.orb.ariaLabel": "Open the Job assistant",
  "touTou.orb.signals": "{count} things Toutou can help with here",

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

  // ── Action catalogue (#27A/#27C: page actions and search-all) ─
  "touTou.action.openAssistant": "Open the Toutou assistant",
  "touTou.action.sideAsk": "Ask a side question",
  "touTou.action.openClipboard": "Open the Toutou clipboard",
  "touTou.action.goJobs": "Pick a job in Job Square",
  "touTou.action.goApply": "Go to the apply queue",
  "touTou.action.goResumes": "Go to the resume workbench",
  "touTou.action.goProfile": "Go to My Profile",
  "touTou.action.goMaterials": "Go to the material box",
  "touTou.action.goKnowledge": "Go to the knowledge base",
  "touTou.action.goFavorites": "Go to favorites",
  "touTou.action.goInterview": "Go to interview prep",
  "touTou.action.goClaims": "Go to the claims ledger",
  "touTou.action.goTracker": "Go to application tracking",
  "touTou.action.searchAll": "Search all actions",

  // ── Action panel (#27C) ─────────────────────────────────────
  "touTou.panel.title": "Toutou action panel",
  "touTou.panel.pageSection": "Actions here",
  "touTou.panel.allSection": "All actions",
  "touTou.panel.selectionSection": "Selected text",
  "touTou.panel.searchPlaceholder": "Search actions",
  "touTou.panel.empty": "No matching actions",
  "touTou.panel.close": "Close the action panel",
  "touTou.panel.sideAskPlaceholder": "Ask a side question, Alt+Enter to send",
  "touTou.panel.sideAskSend": "Send side question",
  "touTou.panel.sideAskHint":
    "A side question is answered once: it does not enter the conversation, write history or call tools",
  "touTou.panel.sideAskEmpty": "Type your question first",
  "touTou.panel.answerTitle": "Toutou's answer",
  "touTou.panel.asking": "Toutou is thinking…",
  "touTou.panel.failed": "No answer this time: {reason}",
  "touTou.panel.back": "Back to actions",
  "touTou.panel.muted": "{count} tip kinds muted",
  "touTou.panel.restoreMuted": "Restore tips",

  // ── Selection actions (#27A) ────────────────────────────────
  "touTou.selection.bar": "Selected text actions",
  "touTou.selection.regionResume": "Resume experience",
  "touTou.selection.regionJob": "Job description",
  "touTou.selection.regionClipboard": "Clipboard",
  "touTou.selection.regionText": "Page text",
  "touTou.selection.rewrite": "Rewrite this passage",
  "touTou.selection.star": "Add STAR structure",
  "touTou.selection.numbers": "Find quantifiable numbers",
  "touTou.selection.checkDuplicates": "Check duplicate entries",
  "touTou.selection.jdMatch": "Do I meet this requirement",
  "touTou.selection.keywords": "Extract keywords",
  "touTou.selection.explain": "Explain this passage",
  "touTou.selection.copy": "Copy",
  "touTou.selection.saveMaterial": "Save to material box",
  "touTou.selection.recognize": "Recognize into Profile",
  "touTou.selection.asking": "Toutou is reading this passage…",
  "touTou.selection.copied": "Copied the selected text",
  "touTou.selection.copyFailed": "Copy failed — copy it manually",
  "touTou.selection.saved": "Saved to the material box: “{title}”",
  "touTou.selection.saveFailed": "Saving to the material box failed: {reason}",
  "touTou.selection.duplicateNone": "No duplicate entries found",
  "touTou.selection.duplicateFound": "Found {count} probable duplicates",
  "touTou.selection.duplicateCriteria":
    "Criteria: same section, anchor equal or a prefix, and no date or role conflict (reuses #20)",
  "touTou.section.educations": "Education",
  "touTou.section.experiences": "Work experience",
  "touTou.section.campusExperiences": "Campus experience",
  "touTou.section.projects": "Projects",

  // ── Page signals (#27B) ─────────────────────────────────────
  "touTou.signal.layoutOverflow.title": "This won't fit: about {needed} pages, limit {limit} pages",
  "touTou.signal.layoutOverflow.action": "See how to fit {limit} pages",
  "touTou.signal.queueUnsupported.title":
    "{count} queued Jobs come from sources that cannot be auto-applied",
  "touTou.signal.queueUnsupported.action": "Review those Jobs",
  "touTou.signal.profileMissing.title": "Profile is missing {count} key details",
  "touTou.signal.profileMissing.action": "Fill in the Profile",
  "touTou.signal.resumeUnsaved.title": "You have unsaved changes",
  "touTou.signal.resumeUnsaved.action": "Save now",
  "touTou.signal.mute": "Don't suggest this kind again",
  "touTou.signal.muted": "This kind of tip is muted",
  "touTou.signal.openPanel": "Open the action panel",

  // ── Proposals and undo (#27F, depends on #13D) ──────────────
  "touTou.proposal.ariaLabel": "Toutou proposal",
  "touTou.proposal.title": "Toutou suggests this change",
  "touTou.proposal.writeTitle": "Toutou requests these changes",
  "touTou.proposal.diffAdded": "Added",
  "touTou.proposal.diffRemoved": "Removed",
  "touTou.proposal.before": "Now",
  "touTou.proposal.after": "Change to",
  "touTou.proposal.apply": "Apply this change",
  "touTou.proposal.reject": "Not now",
  "touTou.proposal.applied": "Change applied",
  "touTou.proposal.undo": "Undo this change",
  "touTou.proposal.undoHint":
    "The whole resume returns to version {version}, not just this one field",
  "touTou.proposal.undone": "Restored to version {version}",
  "touTou.proposal.failed": "The change failed: {reason}",
  "touTou.proposal.undoFailed": "Undo failed: {reason}",
  "touTou.proposal.unsupported": "This action cannot be undone",
  "touTou.proposal.pending":
    "Preview and undo wiring lands after the assistant write actions merge",
} as const;

export default touTou;
