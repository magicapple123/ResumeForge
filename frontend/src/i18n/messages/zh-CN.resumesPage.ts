// SPDX-License-Identifier: Apache-2.0
/**
 * 简历中心页（`pages/ResumesPage.tsx`）及其受控弹窗：筛选工具栏、排序复位、批量删除、
 * 「全选全部简历」的提示与重命名 / 备注 / 版本对比三个弹窗的文案。
 *
 * 表格视图与卡片视图自身的文案在 `zh-CN.resumes.ts` / `zh-CN.responsive.ts`；
 * 批量操作条（`BatchActionBar`）属于别的批次。
 * 批量删除的正文用 `{note}` 占位符引用 `common.note.trashRecovery`（删除后果的共用 key），
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

  // ── 岗位筛选下拉（远程搜索 + 深链回填）───────────────────
  "resumesPage.jobFilter.label": "按岗位筛选",

  // ── 排序复位 ────────────────────────────────────────────
  "resumesPage.sort.reset": "恢复默认排序",

  // ── 批量操作 ────────────────────────────────────────────
  "resumesPage.selectAll.tooltip": "按当前筛选，一键选中全部 {count} 份简历（跨页，不止当前页）",
  "resumesPage.selectAll.button": "全选全部简历（共 {count} 个）",
  "resumesPage.selectAll.empty": "当前筛选下没有简历",
  "resumesPage.selectAll.tooMany":
    "当前筛选下共 {count} 份简历，超出单次批量上限 5000 份；请先用筛选或搜索缩小范围",
  "resumesPage.selectAll.done": "已选中当前筛选下的全部 {count} 份简历（所有页）",
  "resumesPage.batchDelete.button": "批量删除",
  "resumesPage.batchDelete.title": "删除选中的简历？",
  "resumesPage.batchDelete.body": "这 {count} 份简历{note}",
  "resumesPage.batchDelete.done": "已删除 {count} 份简历，可在「回收站」里恢复",

  // ── 重命名 / 备注 / 版本对比弹窗 ─────────────────────────
  "resumesPage.rename.title": "重命名简历",
  "resumesPage.rename.namePlaceholder": "简历名称",
  "resumesPage.note.title": "编辑备注",
  "resumesPage.note.placeholder": "备注会显示在简历列表里（选填）",
  "resumesPage.diff.title": "版本对比",
  "resumesPage.diff.baseLabel": "基准版本：",
  "resumesPage.diff.againstLabel": "对比：",
  "resumesPage.diff.againstPlaceholder": "选择要对比的版本",
  "resumesPage.diff.emptyHint": "选择一份其它简历后展示三态差异。",

  // ── 成功提示与失败兜底 ───────────────────────────────────
  "resumesPage.toast.movedToTrash": "已移入回收站，可在「回收站」里恢复",
  "resumesPage.error.deleteFailed": "删除失败",
  "resumesPage.error.favoriteUpdateFailed": "更新收藏状态失败",
  "resumesPage.error.batchDeleteFailed": "批量删除失败，请重试",
  "resumesPage.error.listFetchFailed": "获取简历列表失败",
  "resumesPage.rename.required": "简历名称不能为空",
  "resumesPage.rename.done": "已重命名",
  "resumesPage.rename.failed": "重命名失败",
  "resumesPage.diff.failed": "版本对比失败",
  "resumesPage.note.saved": "备注已保存",
  "resumesPage.note.saveFailed": "保存备注失败",
} as const;

export default resumesPage;
