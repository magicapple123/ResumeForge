// SPDX-License-Identifier: Apache-2.0
/**
 * The composer's left-hand "+" entry (R06-A): one panel holds attachments, the related job,
 * the related resume and the skills list.
 *
 * Only copy that belongs to this panel lives here. The controls inside reuse existing keys:
 * the two selects use `assistantComposer.placeholder.*` / `assistantComposer.aria.*`, the
 * skills row and its second level use `assistantComposer.skills.*` and
 * `conversationSkills.*`, and the back button uses `common.action.back`.
 */
const composerAddMenu = {
  "composerAddMenu.aria.trigger": "Add attachments, links or skills",
  "composerAddMenu.tooltip": "Add attachments / link a job or resume / skills",
  "composerAddMenu.section.job": "Related job",
  "composerAddMenu.section.resume": "Related resume",
  "composerAddMenu.section.skills": "Skills",
  "composerAddMenu.action.attach": "Add attachment",
  "composerAddMenu.skills.search": "Search skills",
  "composerAddMenu.skills.noMatch": "No matching skills",
} as const;

export default composerAddMenu;
