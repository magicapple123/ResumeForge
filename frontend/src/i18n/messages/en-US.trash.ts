// SPDX-License-Identifier: Apache-2.0
/** 回收站页（与 zh-CN.trash.ts 一一对应）。 */
const trash = {
  "trash.page.title": "Trash",
  "trash.page.subtitle":
    "Deleted items land here first and never disappear immediately; restoring takes one click. Only Delete permanently actually erases them, and that cannot be undone.",
  "trash.selectMode": "Select",
  "trash.exitSelect": "Exit select mode",
  "trash.action.restore": "Restore",
  "trash.action.purge": "Delete permanently",
  "trash.action.clear": "Clear",
  "trash.batch.restore": "Restore selected ({count})",
  "trash.batch.purge": "Delete selected permanently",

  "trash.column.type": "Type",
  "trash.column.name": "Name",
  "trash.column.deletedAt": "Deleted",
  "trash.column.actions": "Actions",
  "trash.untitled": "(Untitled)",

  "trash.confirm.purgeOne": "“{title}” will be permanently deleted and cannot be recovered.",
  "trash.confirm.purgeOneTitle": "Delete permanently?",
  "trash.confirm.confirmAria": "Confirm permanent deletion of {title}",
  "trash.confirm.cancelAria": "Cancel permanent deletion of {title}",
  "trash.aria.restore": "Restore {title}",
  "trash.aria.purge": "Delete {title} permanently",

  "trash.batch.confirmTitle": "Permanently delete the selected records?",
  "trash.batch.confirmDescription":
    "These {count} items will be permanently deleted and cannot be recovered.",
  "trash.batch.confirmAria": "Confirm permanent deletion of the selection",
  "trash.batch.cancelAria": "Cancel permanent deletion of the selection",

  "trash.emptyOut.titleAll": "Empty the Trash?",
  "trash.emptyOut.titleType": "Empty this category?",
  "trash.emptyOut.description":
    "{count} items will be permanently deleted and cannot be recovered.",
  "trash.emptyOut.confirmAria": "Confirm emptying the Trash",
  "trash.emptyOut.cancelAria": "Cancel emptying the Trash",
  "trash.emptyOut.actionAll": "Empty Trash",
  "trash.emptyOut.actionType": "Empty this category",

  "trash.filter.all": "All ({count})",
  "trash.filter.labeled": "{label} ({count})",
  "trash.filters.aria": "Trash categories",

  "trash.toast.restored": "Restored {count} items",
  "trash.toast.restoredOne": "Restored “{title}”",
  "trash.toast.restoredPartial": "Restored {ok}; {failed} failed — try again",
  "trash.toast.restoreFailed": "Could not restore",
  "trash.toast.purged": "Permanently deleted {count} items",
  "trash.toast.purgedOne": "Permanently deleted “{title}”",
  "trash.toast.purgedPartial": "Permanently deleted {ok}; {failed} failed — try again",
  "trash.toast.purgeFailed": "Could not delete permanently",
  "trash.toast.emptied": "Trash emptied",
  "trash.toast.emptyFailed": "Could not empty the Trash",

  "trash.tip.title": "Items in the Trash do not appear anywhere else",
  "trash.tip.description":
    "Jobs, Resumes, applications, fact-ledger entries, files in the Profile library and assistant sessions — once deleted they disappear from their own lists, the home statistics and search, and are visible only here.",
  "trash.emptyState.description":
    "The Trash is empty. Deleted items will appear here and can be restored at any time.",
} as const;

export default trash;
