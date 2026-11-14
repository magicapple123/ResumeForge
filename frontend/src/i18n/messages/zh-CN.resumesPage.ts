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
  "resumesPage.batch.actions": "批量操作",
  "resumesPage.batch.export": "批量导出",
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

  // ── 外部简历（第 21 条：只读快照）──────────────────────────
  "resumesPage.external.title": "外部简历",
  /** 独立页的返回入口（第 1 条）。 */
  "resumesPage.external.back": "返回简历中心",
  /** 筛选栏入口按钮（数量为 0 时的可见文本）。 */
  "resumesPage.external.entry": "外部简历",
  /** 筛选栏入口按钮（有数量时的可见文本）。 */
  "resumesPage.external.entryWithCount": "外部简历 {count}",
  "resumesPage.external.subtitle": "只读快照，不能编辑，可用于模拟面试与文本检查",
  "resumesPage.external.tag": "外部",
  "resumesPage.external.upload": "上传外部简历",
  "resumesPage.external.empty": "还没有上传过外部简历",
  "resumesPage.external.emptyHint":
    "上传你在别处生成的 PDF / Word / TXT / Markdown 简历，可预览原件、做文本检查、用于模拟面试",
  "resumesPage.external.chars": "{count} 字",
  "resumesPage.external.noText": "未提取到文字",
  "resumesPage.external.jobTag": "关联岗位：{job}",
  "resumesPage.external.preview": "预览原件",
  "resumesPage.external.viewText": "查看文本",
  "resumesPage.external.check": "文本检查",
  "resumesPage.external.useForInterview": "用于面试",
  "resumesPage.external.noTextForInterview":
    "这份简历没有提取到文字，不能在面试中直接复用；可在面试页上传原件由识别链路处理",
  "resumesPage.external.delete": "删除",
  "resumesPage.external.deleted": "已删除「{name}」",
  "resumesPage.external.deleteFailed": "删除失败，请重试",
  "resumesPage.external.restored": "已恢复「{name}」",
  "resumesPage.external.restoreFailed": "恢复失败，可到回收站里手动恢复",
  "resumesPage.external.loadFailed": "获取外部简历失败",
  "resumesPage.external.uploadTitle": "上传外部简历",
  "resumesPage.external.uploadName": "显示名称",
  "resumesPage.external.uploadNamePlaceholder": "默认取文件名",
  "resumesPage.external.uploadJob": "关联岗位（选填）",
  "resumesPage.external.uploadJobPlaceholder": "选择这份简历投递的岗位",
  "resumesPage.external.uploadDrop": "拖拽文件到这里，或点击选择",
  "resumesPage.external.uploadHint": "支持 PDF / Word / TXT / Markdown，单份不超过 10 MB",
  "resumesPage.external.uploadRequired": "先选一份简历文件",
  "resumesPage.external.uploadUnsupported":
    "这份文件不支持上传，可换成 PDF / Word / TXT / Markdown",
  "resumesPage.external.uploading": "正在上传并提取文字…",
  "resumesPage.external.uploaded": "已上传「{name}」",
  "resumesPage.external.uploadedNoText": "已保存「{name}」，但没有提取到文字",
  "resumesPage.external.uploadFailed": "上传失败，请重试",
  "resumesPage.external.detailTitle": "外部简历",
  "resumesPage.external.tabOriginal": "原件",
  "resumesPage.external.tabText": "文本",
  "resumesPage.external.tabCheck": "文本检查",
  "resumesPage.external.originalUnsupported": "这种格式不能在线预览，可下载后用本地程序打开",
  "resumesPage.external.downloadOriginal": "下载原件",
  "resumesPage.external.textEmpty": "这份文件没有提取到文字",
  "resumesPage.external.textTruncated": "只存了前一部分正文，超出部分没有保存",
  "resumesPage.external.checkHint": "只做文本级检查，不检查版式与字段完整性，也不提供总分",
  "resumesPage.external.checkStatusOk": "正常",
  "resumesPage.external.checkStatusWarn": "需注意",
  "resumesPage.external.checkStatusInfo": "参考",
  "resumesPage.external.checkNoText": "未提取到文字，无法做文本检查",
  "resumesPage.external.checkLoading": "正在检查…",
  "resumesPage.external.checkFailed": "文本检查失败",
  "resumesPage.external.checkPlaceholder": "待补占位符",
  "resumesPage.external.checkQuantification": "量化描述",
  "resumesPage.external.checkContact": "联系方式",
  "resumesPage.external.checkLength": "长度与篇幅",
  "resumesPage.external.checkWeakWording": "弱表述",
  "resumesPage.external.checkKeywords": "关键词覆盖",
  "resumesPage.external.checkPlaceholderDetail": "发现 {count} 处未完成标记",
  "resumesPage.external.checkPlaceholderOk": "没有发现待补标记",
  "resumesPage.external.checkQuantificationDetail": "{count}/{total} 行含数字或百分比（{ratio}%）",
  "resumesPage.external.checkContactDetail": "找到 {count} 处联系方式",
  "resumesPage.external.checkContactMissing": "没有找到手机号或邮箱",
  "resumesPage.external.checkLengthDetail": "{chars} 字 / {lines} 行，约 {pages} 页",
  "resumesPage.external.checkWeakWordingDetail":
    "{count}/{total} 行以「负责了」等弱表述开头（{ratio}%）",
  "resumesPage.external.checkWeakWordingOk": "没有发现弱表述开头",
  "resumesPage.external.checkKeywordsDetail": "覆盖 {matched}/{target} 个目标词（{ratio}%）",
  "resumesPage.external.checkKeywordsMissing": "未覆盖：{words}",
  "resumesPage.external.lineWithText": "第 {line} 行：{text}",
  "resumesPage.external.searchPlaceholder": "搜索名称、岗位或公司",
  "resumesPage.external.total": "共 {count} 份",
  "resumesPage.external.filteredTotal": "筛选后 {count} 份",
  "resumesPage.external.noMatches": "没有匹配的外部简历",
  "resumesPage.external.clearFilters": "清除筛选",
  "resumesPage.external.limited": "仅显示最近 {count} 份，可搜索其他简历",
  "resumesPage.external.uploadFiltersCleared": "已清除筛选，显示上传的简历",
} as const;

export default resumesPage;
