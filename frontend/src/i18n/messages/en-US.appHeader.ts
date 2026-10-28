// SPDX-License-Identifier: Apache-2.0
/**
 * Header "current dataset + user avatar": the dataset chip's accessible name, the sample
 * badge and its tooltip, the dataset dropdown's current/return/create entries, the
 * create-dataset prompt and failure feedback, and the avatar entry.
 */
const appHeader = {
  "appHeader.dataset.sampleTag": "Sample",
  "appHeader.dataset.sampleTagTooltip": "Sample data, independent of your real information",
  "appHeader.dataset.chipAria": "Current dataset: {name}",
  "appHeader.dataset.chipAriaSample": "Current dataset: {name}, sample data",
  "appHeader.dataset.menuCurrent": "{name} (current)",
  "appHeader.dataset.menuBackToMine": "Back to my data",
  // Display name of the built-in main dataset (fixed at creation; the backend refuses to
  // rename it). User-created and imported datasets always show their own name.
  "appHeader.dataset.mainName": "My data",
  "appHeader.dataset.menuCreate": "New dataset...",
  "appHeader.dataset.switchFailed": "Could not switch the dataset",
  "appHeader.dataset.createNameRequired": "Enter a dataset name",
  "appHeader.dataset.createSucceeded": 'Created "{name}"',
  "appHeader.dataset.createSwitchPrompt": "Switch to this dataset now?",
  "appHeader.dataset.createSwitchNow": "Switch now",
  "appHeader.dataset.createSwitchLater": "Later",
  "appHeader.dataset.createFailed": "Could not create the dataset",
  "appHeader.avatar.openProfile": "Open My Profile",
  "appHeader.avatar.altWithName": "{name}'s avatar",
  "appHeader.avatar.altFallback": "User avatar",
} as const;

export default appHeader;
