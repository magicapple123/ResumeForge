// SPDX-License-Identifier: Apache-2.0
/**
 * 简历中心页（`pages/ResumesPage.tsx`）：筛选工具栏、排序复位、批量删除与
 * 列表之外的一次性提示。
 *
 * 表格视图与卡片视图自身的文案在 `zh-CN.resumes.ts` / `zh-CN.responsive.ts`；
 * 批量操作条（`BatchActionBar`）与岗位筛选下拉（`JobFilterSelect`）属于别的批次。
 * 批量删除的正文用 `{note}` 占位符引用 `TRASH_RECOVERY_NOTE`（别处共享的中文常量），
 * 不在这里另写一份。
 */
const resumesPage = {
  // ── 筛选工具栏 ──────────────────────────────────────────
  "resumesPage.page.newResume": "新建简历",
  "resumesPage.page.deliveryArchive": "交付存档",
  "resumesPage.page.jobFilterTag": "按岗位筛选：{job}",
  "resumesPage.page.clearFilter": "清除筛选",
  "resumesPage.filter.jobRelation": "岗位关联",
  "resumesPage.filter.jobRelationAria": "按岗位关联筛选",
  "resumesPage.filter.hasJob": "有目标岗位",
  "resumesPage.filter.general": "通用简历",

  // ── 排序复位 ────────────────────────────────────────────
  "resumesPage.sort.reset": "恢复默认排序",

  // ── 批量操作 ────────────────────────────────────────────
  "resumesPage.selectAll.tooltip": "按当前筛选，一键选中全部 {count} 份简历（跨页，不止当前页）",
  "resumesPage.selectAll.button": "全选全部简历（共 {count} 个）",
  "resumesPage.batchDelete.button": "批量删除",
  "resumesPage.batchDelete.title": "删除选中的简历？",
  "resumesPage.batchDelete.body": "这 {count} 份简历{note}",
  "resumesPage.batchDelete.done": "已删除 {count} 份简历，可在「回收站」里恢复",

  // ── 成功提示与失败兜底 ───────────────────────────────────
  "resumesPage.toast.movedToTrash": "已移入回收站，可在「回收站」里恢复",
  "resumesPage.error.deleteFailed": "删除失败",
  "resumesPage.error.favoriteUpdateFailed": "更新收藏状态失败",
  "resumesPage.error.batchDeleteFailed": "批量删除失败，请重试",
  "resumesPage.rename.required": "简历名称不能为空",
  "resumesPage.rename.done": "已重命名",
  "resumesPage.rename.failed": "重命名失败",
  "resumesPage.diff.failed": "版本对比失败",
  "resumesPage.note.saved": "备注已保存",
  "resumesPage.note.saveFailed": "保存备注失败",
} as const;

export default resumesPage;
