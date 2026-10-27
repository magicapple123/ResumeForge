// SPDX-License-Identifier: Apache-2.0
/**
 * Home page "first delivery" progress panel: panel title, done marker, footnote and
 * the copy of all three stages.
 *
 * Stage copy is resolved inside `useActivationProgress` function bodies; the panel
 * component owns only its title, done marker and footnote.
 */
const activationUi = {
  "activationUi.panel.title": "From zero to your first deliverable Resume",
  "activationUi.panel.done": "Done",
  "activationUi.panel.note":
    "Manual entry, local checks and export do not need a configured model; AI features can be configured in Settings anytime.",

  "activationUi.facts.title": "Prepare your facts",
  "activationUi.facts.description":
    "Fill in the key fields in My Profile (name and contact details), or start with an existing ledger entry or Resume",
  "activationUi.facts.cta.label": "Go to My Profile",
  "activationUi.facts.cta.hintReady": "Manual entry does not need a model",
  "activationUi.facts.cta.hintMissing":
    "Name and contact details are required to generate a Resume; add both first",

  "activationUi.target.title": "Choose a target Job",
  "activationUi.target.description": "Add a Job and create or link a Resume for it",
  "activationUi.target.cta.labelNoJobs": "Go to the Job board",
  "activationUi.target.cta.hintNoJobs": "Add one by hand or collect it automatically",
  "activationUi.target.cta.labelWithJob": "Create or link a Resume for the Job",
  "activationUi.target.cta.hintWithJob": "You have a Job; it just needs a Resume",

  "activationUi.deliver.title": "Confirm and deliver",
  "activationUi.deliver.description":
    "Confirm each claim in the fact ledger, then export or send a Resume once you have one",
  "activationUi.deliver.progressEmpty": "The fact ledger is empty: no claims to confirm yet",
  "activationUi.deliver.cta.labelEmpty": "Add claims in the fact ledger",
  "activationUi.deliver.cta.hintEmpty":
    "Save each statement you want in a Resume as an entry before it can be confirmed",
  "activationUi.deliver.progressVerified": "Confirmed {verified}/{total} claims",
  "activationUi.deliver.cta.labelPending": "Confirm {count} pending claims",
  "activationUi.deliver.cta.hintPending": "Unconfirmed claims never make it into a Resume",
  "activationUi.deliver.cta.labelNoResume": "Create or link a Resume in Resume Center",
  "activationUi.deliver.cta.hintNoResume":
    "All facts are confirmed; you just need a Resume for the Job",
} as const;

export default activationUi;
