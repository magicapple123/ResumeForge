// SPDX-License-Identifier: Apache-2.0
const conflict = {
  "workbench.conflict.title": "This Resume was changed elsewhere",
  "workbench.conflict.body":
    "Saving now would overwrite other changes; choose how to proceed first",
  "workbench.conflict.action.use-latest": "Use latest",
  "workbench.conflict.action.compare": "Compare changes",
  "workbench.conflict.action.save-copy": "Save a copy",
  "workbench.conflict.compare.local": "Your version",
  "workbench.conflict.compare.latest": "Latest saved version",
  "workbench.conflict.compare.empty":
    "The content is identical; only typography settings may differ",
  "workbench.conflict.use-latest.done": "Replaced with the latest saved version",
  "workbench.conflict.use-latest.failed": "Could not load the latest saved version; try again",
  "workbench.conflict.copy.title": "{title} (copy)",
  "workbench.conflict.copy.done": 'Saved a copy as "{title}"',
  "workbench.conflict.copy.failed": "Could not save a copy; try again",
  "workbench.conflict.copy-sync.failed":
    "The copy was saved, but the original did not sync; close and reopen it",
  "workbench.conflict.save-failed":
    "Saving did not succeed; your changes are still here, so you can try again",
  "workbench.save.content-saved": "Resume changes saved",
  "workbench.save.layout-saved": "Typography settings saved",
  "workbench.save.layout-failed": "Could not save typography settings; try again",
  "workbench.save.no-record": "This Resume has not finished loading and cannot be saved yet",
  "workbench.history.title": "History",
  "workbench.history.undo": "Undo",
  "workbench.history.redo": "Redo",
  "workbench.history.empty": "No actions to undo yet",
  "workbench.history.preview.hint": "Select a step to view its summary at that time",
  "workbench.history.preview.label": "At that time:",
  "workbench.history.past": "Completed",
  "workbench.history.future": "Available to redo",
  "workbench.history.label.text": "Edit content",
  "workbench.history.label.layout": "Adjust typography",
  "workbench.history.label.structure": "Change structure",
  "workbench.history.label.bold": "Bold text",
  "workbench.history.summary": "{name} · {entries} entries · {pages} pages",
  "workbench.history.current": "Current state",
  "workbench.history.undo.hint": "Nothing to undo",
  "workbench.history.redo.hint": "Nothing to redo",
  "workbench.history.jumpTo": "Go back to this step",
  "workbench.history.backToCurrent": "Back to current",
  "workbench.history.jumpTo.confirm":
    "Going back to this step discards every change after it. Continue?",
  "workbench.selection.entry": "Entry",
} as const;

export default conflict;
