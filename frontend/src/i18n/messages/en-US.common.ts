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
} as const;

export default common;
