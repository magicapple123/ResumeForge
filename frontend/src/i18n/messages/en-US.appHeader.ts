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
  /**
   * Desktop self-drawn title bar (issue 19): the six menus, their items and the About
   * dialog. Only rendered by the desktop shell; copy still goes through i18n so an
   * English UI is fully translated.
   */
  "appHeader.desktopMenu.aria": "Application menu",
  "appHeader.desktopMenu.file": "File",
  "appHeader.desktopMenu.edit": "Edit",
  "appHeader.desktopMenu.view": "View",
  "appHeader.desktopMenu.window": "Window",
  "appHeader.desktopMenu.help": "Help",
  "appHeader.desktopMenu.about": "About",
  "appHeader.desktopMenu.item.newResume": "New resume...",
  "appHeader.desktopMenu.item.importDataset": "Import dataset...",
  "appHeader.desktopMenu.item.openDataDir": "Open data folder",
  "appHeader.desktopMenu.item.backupRestore": "Backup and restore...",
  "appHeader.desktopMenu.item.quit": "Quit",
  "appHeader.desktopMenu.item.undo": "Undo",
  "appHeader.desktopMenu.item.redo": "Redo",
  "appHeader.desktopMenu.item.cut": "Cut",
  "appHeader.desktopMenu.item.copy": "Copy",
  "appHeader.desktopMenu.item.paste": "Paste",
  "appHeader.desktopMenu.item.selectAll": "Select all",
  "appHeader.desktopMenu.item.zoomIn": "Zoom in",
  "appHeader.desktopMenu.item.zoomOut": "Zoom out",
  "appHeader.desktopMenu.item.zoomReset": "Actual size",
  "appHeader.desktopMenu.item.fullscreen": "Full screen",
  "appHeader.desktopMenu.item.minimize": "Minimize",
  "appHeader.desktopMenu.item.maximize": "Maximize",
  "appHeader.desktopMenu.item.restore": "Restore",
  "appHeader.desktopMenu.item.closeWindow": "Close window",
  "appHeader.desktopMenu.item.guide": "User guide",
  "appHeader.desktopMenu.item.keyboardShortcuts": "Keyboard shortcuts",
  "appHeader.desktopMenu.item.openLogDir": "Open log folder",
  "appHeader.desktopMenu.item.checkUpdate": "Check for updates",
  "appHeader.desktopMenu.about.title": "About ResumeForge",
  "appHeader.desktopMenu.about.version": "Version {version}",
  "appHeader.desktopMenu.about.github": "GitHub repository",
  "appHeader.desktopMenu.about.website": "Website",
  "appHeader.desktopMenu.about.license": "Open-source license",
} as const;

export default appHeader;
