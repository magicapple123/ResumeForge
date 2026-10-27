// SPDX-License-Identifier: Apache-2.0
/**
 * 面试深挖页：统计卡、历史列表、状态与批量删除。
 *
 * 批量删除的确认正文引用 `HARD_DELETE_NOTE`（硬删除的共用常量，与
 * `TRASH_RECOVERY_NOTE` 成对），那一行保持中文，等常量收口时一起改。
 */
const drill = {
  "drill.error.loadRecords": "Could not load records",
  "drill.error.load": "Could not load",
  "drill.toast.deletedOne": "Deleted this deep-dive record",
  "drill.error.deleteFailed": "Could not delete",
  "drill.confirm.deleteTitle": "Delete the selected deep-dive records?",
  "drill.toast.deletedMany": "Deleted {count} deep dives",
  "drill.toast.deletedPartial": "Deleted {ok}; {failed} failed — try again",
  "drill.selectMode": "Select",
  "drill.action.delete": "Delete",
  "drill.confirm.deleteOne": "Delete this deep dive?",
  "drill.action.back": "Back to the fact ledger",
  "drill.page.title": "Interview deep dive",
  "drill.page.subtitle":
    "Takes each confirmed claim from the fact ledger and stress-tests it: can you explain it clearly, and where does it still not hold up. The bar for each question is set before you see it, and no overall score is given.",
  "drill.stat.asked": "Asked",
  "drill.stat.clear": "Explained clearly",
  "drill.stat.partial": "Partly verified",
  "drill.stat.unverified": "Unverified",
  "drill.stat.contradiction": "Contradictions",
  "drill.status.finished": "Finished",
  "drill.status.active": "In progress",
  "drill.mode.simulated": "Simulation",
  "drill.mode.training": "Practice",
  "drill.section.history": "History",
  "drill.action.refresh": "Refresh",
  "drill.batch.delete": "Delete selected",
  "drill.empty":
    "No deep dives yet. Confirm a few claims in the fact ledger first, then come back and start one.",
  "drill.aria.select": "Select the deep dive {title}",
  "drill.action.continue": "Continue",
  "drill.action.review": "View retrospective",
  "drill.progress": "{current}/{total} questions",
  "drill.table.total": "{count} total",
} as const;

export default drill;
