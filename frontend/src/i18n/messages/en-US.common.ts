// SPDX-License-Identifier: Apache-2.0
const common = {
  "common.action.cancel": "Cancel",
  "common.action.save": "Save",
  "common.action.confirm": "Confirm",
  "common.action.delete": "Delete",
  "common.action.close": "Close",
  "common.action.back": "Back",
  "common.action.refresh": "Reload",
  "common.action.discard": "Discard changes",
  "common.action.keep-editing": "Keep editing",
  "common.action.batchSelect": "Select multiple",
  "common.retry": "Retry",
  "common.errorBoundary.title.moduleLoad": "Part of the page code could not be loaded",
  "common.errorBoundary.title.generic": "This page is temporarily unavailable",
  "common.errorBoundary.body.moduleLoad":
    "This usually means the page code could not be fetched: a network blip, the frontend dev server just restarted, or it cached a renamed or moved file. Click Retry first - it fetches the code again. If it still fails, reload the page or restart the frontend dev server (close the window and run start.cmd again).",
  "common.errorBoundary.body.generic":
    "Something went wrong while rendering the interface. Reload the page and try again.",
  "common.errorBoundary.reason": "Reason: {message}",
  "common.required": "Required",
  "common.placeholder.select": "Select",

  // ── Shared interaction components (batch bar / quit app / file drop / loading / detail / row actions / collapsed list) ──
  /** Confirmation action of the quit button and its confirm dialog (`ExitAppButton`). */
  "common.action.exit": "Quit",
  /** Accessible name of the batch action bar (`BatchActionBar`). */
  "common.batchBar.aria": "Batch actions",
  /** Selected-item count in the batch action bar. */
  "common.batchBar.selected": "{count} selected",
  /** "Select this page" in card grids: checkbox label, title and accessible name share one key. */
  "common.batchBar.selectPage": "Select this page",
  /** Leave multi-select mode. */
  "common.batchBar.exit": "Exit selection mode",
  /** Batch delete button (`BatchDeleteButton`). */
  "common.batchBar.deleteSelected": "Delete selected",
  /** Title of the quit confirmation. */
  "common.exitApp.title": "Quit ResumeForge?",
  /** Desktop shell: the only way back is the desktop shortcut. */
  "common.exitApp.confirm.desktop":
    "The app will quit completely and the background services will stop too. To use it again, start ResumeForge from the desktop shortcut.",
  /** Browser: says what stops working right away, and how to get back. */
  "common.exitApp.confirm.browser":
    "The frontend and backend processes will stop, so queries and generation on this page will stop working immediately (browsers do not let a script close its own tab, so please close this tab yourself). To use the app again, run start.cmd in the project directory.",
  /** Result page title after quitting. */
  "common.exitApp.exited.title": "ResumeForge has quit",
  /** Result page body in the desktop shell. */
  "common.exitApp.exited.desktop":
    "The frontend, backend and desktop shell processes have all stopped. To use the app again, start ResumeForge from the desktop shortcut.",
  /** Result page body in the browser. */
  "common.exitApp.exited.browser":
    "The frontend and backend processes have stopped, so you can close this tab now. To use the app again, run start.cmd in the project directory.",
  /** Tooltip of the quit button: says what it stops. */
  "common.exitApp.tooltip": "Quit the app (stops the frontend and backend processes)",
  /** Accessible name of the quit button. */
  "common.exitApp.aria": "Quit the app",
  /** Shown when the backend returns no message of its own. */
  "common.exitApp.exiting": "The app is quitting",
  /** Quit failed without a more specific cause. */
  "common.exitApp.failed": "Quit failed. You can also close the backend window directly.",
  /** Quit failed with the API error message. */
  "common.exitApp.failedWithReason": "{message} (you can also close the backend window directly)",
  /** Default hint of the drag overlay (`FileDropZone`). */
  "common.fileDropZone.hint": "Release to import",
  /** Accessible name of a loading state (shared by `LoadingBlock` and `PageSkeleton`). */
  "common.loading.content": "Loading content",
  /** One-line hint when the input reaches its length limit (`MaxLengthHint`). */
  "common.maxLength.reached": "{count}-character limit reached",
  /** Placeholder when a detail drawer has nothing to show (`RecordDetail`). */
  "common.recordDetail.empty": "This record has no further details",
  /** Accessible name of the row "more" button (`RowActions`). */
  "common.rowActions.more": "More actions",
  /** Expand a collapsed list (`useCollapsedList`). */
  "common.collapsedList.expand": "Show all {count}",
  /** Collapse the list again. */
  "common.collapsedList.collapse": "Collapse list",
} as const;

export default common;
