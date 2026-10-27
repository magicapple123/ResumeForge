// SPDX-License-Identifier: Apache-2.0
/**
 * Shortcut settings card: action names, scope names, rejection reasons, the
 * "why not a more convenient key" hints, and the copy inside the card.
 *
 * Action ids and scope values are protocol values stored in localStorage (see
 * `features/shortcuts/registry.ts`); this file only provides display names.
 */
const shortcutSettings = {
  "shortcutSettings.card.title": "Shortcuts",
  "shortcutSettings.card.intro":
    "Choose Change, then press the combination you want; press Esc to cancel. A shortcut must include Ctrl / ⌘ or Alt. Combinations reserved by the browser (such as Ctrl+W) and ones already used by another action are rejected. Changes are stored on this device and take effect immediately.",

  "shortcutSettings.action.undo": "Undo",
  "shortcutSettings.action.redo": "Redo",
  "shortcutSettings.action.save": "Save current edit",
  "shortcutSettings.action.search": "Search",
  "shortcutSettings.action.assistant": "Open or close the assistant",
  "shortcutSettings.action.newJob": "New job",
  "shortcutSettings.action.toggleTheme": "Toggle dark or light theme",
  "shortcutSettings.action.openSettings": "Open settings",
  "shortcutSettings.action.openSkills": "Open assistant skills",
  "shortcutSettings.action.exportPdf": "Open export (in resume preview)",
  "shortcutSettings.action.newResume": "New resume",
  "shortcutSettings.action.switchDataset": "Switch dataset",
  "shortcutSettings.action.prevPage": "Previous page (lists)",
  "shortcutSettings.action.nextPage": "Next page (lists)",
  "shortcutSettings.action.focusAssistant": "Open the assistant and focus the input",
  "shortcutSettings.action.commandPalette": "Open the command palette (studio)",

  "shortcutSettings.scope.form": "Form",
  "shortcutSettings.scope.page": "Page",
  "shortcutSettings.scope.global": "Global",
  "shortcutSettings.scope.jobs": "Job board",

  "shortcutSettings.reject.empty": "Did not catch that, press the shortcut again",
  "shortcutSettings.reject.modifierOnly": "Also needs a non-modifier key (for example Z or K)",
  "shortcutSettings.reject.reserved": "That is reserved by the browser or window, choose another",
  "shortcutSettings.reject.noModifier": "A shortcut must include Ctrl / ⌘ or Alt",

  "shortcutSettings.hint.toggleTheme":
    "Ctrl+Shift+L is taken by some browsers or extensions, so Ctrl/⌘+Alt+D is used instead.",
  "shortcutSettings.hint.openSettings":
    "Ctrl/⌘+, belongs to the browser and system settings and never reaches the page, so Ctrl/⌘+Alt+S is used instead.",
  "shortcutSettings.hint.openSkills":
    "Ctrl+Shift+K collides with browser dev tools and search, so Ctrl/⌘+Alt+K is used instead.",
  "shortcutSettings.hint.exportPdf":
    "Ctrl/⌘+E is reserved for the address bar search, so Ctrl/⌘+Shift+E is used instead.",
  "shortcutSettings.hint.newResume":
    "Ctrl/⌘+Alt+R collides with input methods and extensions, so Ctrl/⌘+Shift+N is used instead.",
  "shortcutSettings.hint.pageOnly":
    "Applies to the current list pagination, not to paging inside the resume preview; it lands on the pager and never turns pages in the preview.",

  "shortcutSettings.column.action": "Action",
  "shortcutSettings.column.scope": "Scope",
  "shortcutSettings.column.keys": "Current shortcut",
  "shortcutSettings.column.actions": "Actions",

  "shortcutSettings.recording": "Press the new combination, Esc to cancel",
  "shortcutSettings.unbound": "Unbound",
  "shortcutSettings.action.edit": "Change",
  "shortcutSettings.action.clear": "Clear",
  "shortcutSettings.action.restore": "Restore default",
  "shortcutSettings.action.resetAll": "Restore all defaults",

  "shortcutSettings.conflict": 'Already used by "{label}"',
  "shortcutSettings.changed": '"{label}" is now {keys}',
  "shortcutSettings.unboundDone":
    '"{label}" is unbound; this combination no longer triggers anything',
  "shortcutSettings.restoredDone": '"{label}" is back to its default',
  "shortcutSettings.resetAllDone": "All shortcuts are back to their defaults ({count} actions)",

  "shortcutSettings.clearConfirm.title": 'Unbind "{label}"?',
  "shortcutSettings.clearConfirm.body":
    "After unbinding, this combination no longer triggers anything; you can always choose Restore default.",
  "shortcutSettings.clearConfirm.ok": "Unbind",
  "shortcutSettings.resetAllConfirm.title": "Restore all default shortcuts?",
  "shortcutSettings.actionHelp": "{label} help",
} as const;

export default shortcutSettings;
