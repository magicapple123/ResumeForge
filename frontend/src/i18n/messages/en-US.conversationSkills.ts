// SPDX-License-Identifier: Apache-2.0
/** Conversation skills (T14): chips, menu, injection budget and the used-skills line. */
const conversationSkills = {
  "conversationSkills.action.add": "Skills",
  "conversationSkills.action.manage": "Open workbench",
  "conversationSkills.menu.hint":
    "Applies to this conversation only; each conversation has its own set",
  "conversationSkills.menu.budget": "This conversation: {count} · {used} / {limit} chars",
  "conversationSkills.menu.budgetPending":
    "This conversation: {count} · budget starts after the first message",
  "conversationSkills.menu.budgetOver": "{over} chars over budget; later skills will be truncated",
  "conversationSkills.menu.empty": "No skills yet — create one in the workbench first",
  // #31D/#31F: auto-generated skills stay disabled until the user validates them
  "conversationSkills.menu.pendingBadge": "[Pending validation]",
  "conversationSkills.menu.pendingHint":
    "Pending validation: confirm it on the skills page before enabling",
  "conversationSkills.chip.disable": "Turn off the skill “{name}”",
  "conversationSkills.chip.truncatedHint":
    "The prompt exceeds this conversation's budget and was not fully loaded; shorten it or turn off other skills to load it fully",
  "conversationSkills.chip.truncatedCount":
    "The prompt exceeds this conversation's budget: only the first {loaded} of {requested} chars were loaded",
  "conversationSkills.chip.skippedHint":
    "Nothing from this skill was loaded; turn off other skills to load it",
  "conversationSkills.row.aria": "Skills enabled in this conversation",
  "conversationSkills.error.tooMany": "A conversation can enable at most 8 skills",
  "conversationSkills.message.used": "Skills this turn: {names}",
  "conversationSkills.message.separator": ", ",
  "conversationSkills.page.intro":
    "Skills are enabled inside a conversation, not globally in the library; tick them in the skill menu of the assistant composer.",
} as const;

export default conversationSkills;
