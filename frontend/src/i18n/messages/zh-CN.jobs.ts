// SPDX-License-Identifier: Apache-2.0
/**
 * 备选岗位：批量选择工具条（勾选范围、计数、导出与删除动作）。
 *
 * 既有 `jobs.candidate.*` 文案在核心包里；本包只补工具条新增的展示文案。
 */
const jobs = {
  "jobs.candidate.batchToolbar.aria": "备选岗位批量工具栏",
  "jobs.candidate.batchToolbar.selectPage": "全选本页",
  "jobs.candidate.batchToolbar.selectedCount": "已选 {selected} / {total} 条",
  "jobs.candidate.batchToolbar.selectAllTooltip":
    "按当前筛选，一键选中全部 {count} 条候选（跨页，不止当前页）",
  "jobs.candidate.batchToolbar.selectAll": "全选全部",
  "jobs.candidate.batchToolbar.exportCsv": "导出 CSV",
  "jobs.candidate.batchToolbar.delete": "批量删除",
  "jobs.candidate.batchToolbar.clear": "清空选择",
  "jobs.candidate.batchToolbar.exit": "退出多选",
} as const;

export default jobs;
