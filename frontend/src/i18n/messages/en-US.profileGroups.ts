// SPDX-License-Identifier: Apache-2.0
const profileGroups = {
  // Display name of the default Plan while it still carries the built-in name; once the
  // user renames it the backend stops sending `name_is_default` and the real name shows.
  "profileGroups.defaultName": "Default Plan",
  "profileGroups.control.label": "Current Plan",
  "profileGroups.control.manage": "Manage Plans",
  "profileGroups.control.locked": "Save or cancel your edits before switching Plans",
  "profileGroups.control.switchFailed": "Could not switch Plans: {detail}",
  "profileGroups.manager.title": "Plans and Sections",
  "profileGroups.manager.groupsTab": "Plans",
  "profileGroups.manager.sectionsTab": "Sections and Fields",
  "profileGroups.manager.close": "Close",
  "profileGroups.manager.back": "Back",
  "profileGroups.manager.create": "New Plan",
  "profileGroups.manager.createHint": "Plan names must contain 1-40 characters",
  "profileGroups.manager.nameLabel": "Plan name",
  "profileGroups.manager.namePlaceholder": "e.g. Technical Jobs",
  "profileGroups.manager.saveName": "Save name",
  "profileGroups.manager.membersTitle": "Included Sections",
  "profileGroups.manager.membersHint":
    "Basic information is always included; select a Section to show it in this Plan",
  "profileGroups.manager.saveMembers": "Save Section list",
  "profileGroups.manager.setCurrent": "Set as current Plan",
  "profileGroups.manager.current": "Current Plan",
  "profileGroups.manager.default": "Default Plan",
  "profileGroups.manager.editTitle": "Edit Plan",
  "profileGroups.manager.rename": "Edit",
  "profileGroups.manager.membersVisibilityHint":
    "Deselect a Section to hide it from this Plan's Profile page; hidden Sections are excluded from generation and application forms",
  "profileGroups.manager.createVisibilityHint":
    "New Plans show only basic information by default; enable other Sections individually",
  "profileGroups.manager.createdSwitched":
    'Created and switched to "{name}"; only basic information is shown by default, and other Sections can be enabled on the Profile page',
  "profileGroups.manager.createdKeepEditing":
    'Created Plan "{name}"; save or cancel your edits before setting it as the current Plan',
  "profileGroups.manager.delete": "Delete Plan",
  "profileGroups.manager.defaultProtected": "The default Plan cannot be deleted",
  "profileGroups.manager.groupCount": "Up to 20 Plans",
  "profileGroups.manager.membersRequired": "Basic information must remain included",
  "profileGroups.manager.saveFailed": "Could not save the Plan: {detail}",
  "profileGroups.manager.conflict":
    "This content was changed in another window; refresh and compare",
  "profileGroups.manager.deleteTitle": 'Delete Plan "{name}"?',
  "profileGroups.manager.deleteBody":
    "The Plan will leave the list. Its Section list is retained for recovery, and no Profile Entries will be deleted.",
  "profileGroups.manager.deleteConfirm": 'Delete "{name}"',
  "profileGroups.manager.deleteRestore": "Restore it from Trash",
  "profileGroups.manager.undo": "Undo",
  "profileGroups.manager.deleted": 'Deleted Plan "{name}"',
  "profileGroups.manager.restoreFailed": "Could not restore the Plan: {detail}",
  "profileGroups.notice.fallback": "The current Plan is unavailable; switched to the default Plan",
  "profileGroups.notice.ack": "Got it",
  "profileGroups.summary.label": "Using: {name} ({count} Sections)",
  "profileGroups.summary.loading": "Loading the current Plan",
  "profileGroups.summary.fields": "Included Sections",
  "profileGroups.summary.empty": "The current Plan does not include any Sections yet",
  "profileGroups.summary.separator": ", ",
  "profileGroups.leave.title": "Unsaved changes",
  "profileGroups.leave.body.navigate": "Your changes will be lost if you leave this page.",
  "profileGroups.leave.body.cancel": "Canceling editing will discard your changes.",
  "profileGroups.leave.body.switchGroup": "Switching the current Plan will discard your changes.",
  "profileGroups.leave.discard": "Discard changes",
  "profileGroups.leave.keep": "Keep editing",
} as const;

export default profileGroups;
