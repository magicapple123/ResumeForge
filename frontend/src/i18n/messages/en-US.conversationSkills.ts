// SPDX-License-Identifier: Apache-2.0
/** Conversation skills (T14→T24): pending chips, picker and the used-skills line on user messages. */
const conversationSkills = {
  "conversationSkills.action.add": "Skills",
  "conversationSkills.action.manage": "Open workbench",
  "conversationSkills.menu.hint": "Applies to your next message only; cleared after sending",
  "conversationSkills.menu.budget": "This message: {count} · {used} / {limit} chars",
  "conversationSkills.menu.budgetPending": "This message: {count} · loaded within budget on send",
  "conversationSkills.menu.budgetOver": "{over} chars over budget; later skills will be truncated",
  "conversationSkills.menu.empty": "No skills yet — create one in the workbench first",
  // #31D/#31F: auto-generated skills stay disabled until the user validates them
  "conversationSkills.menu.pendingBadge": "[Pending validation]",
  "conversationSkills.menu.pendingHint":
    "Pending validation: confirm it on the skills page before enabling",
  "conversationSkills.chip.disable": "Remove the skill “{name}” from this message",
  "conversationSkills.chip.truncatedHint":
    "The prompt exceeds this message's budget and was not fully loaded; shorten it or remove other skills to load it fully",
  "conversationSkills.chip.truncatedCount":
    "The prompt exceeds this message's budget: only the first {loaded} of {requested} chars were loaded",
  "conversationSkills.chip.skippedHint":
    "Nothing from this skill was loaded; remove other skills to load it",
  "conversationSkills.row.aria": "Skills that will be used for the next message",
  "conversationSkills.error.tooMany": "A message can use at most 8 skills",
  "conversationSkills.message.usedLabel": "Used",
  "conversationSkills.legacy.notice":
    "This conversation used to have skills enabled: {names}. Skills now apply to the next message only; tick them again in the composer when needed.",
  "conversationSkills.legacy.dismiss": "Got it",
  "conversationSkills.page.intro":
    "Pick skills in the assistant composer: they apply to your next message only and clear after sending. They are not enabled globally in the library.",
} as const;

export default conversationSkills;
