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

  // ── 折叠视图（按岗位分组，CR-33 / 2026-11-26）─────────────
  // 列头「岗位 / 简历」：同一列在折叠视图里既放岗位名也放通用简历的标题。
  "resumesPage.list.column.titleJob": "岗位 / 简历",
  // 组行身份的第一行尾部 chip。
  "resumesPage.list.group.versionCount": "{count} 个版本",
  // 组行身份的第二行：公司 · 最新版本 {title}。
  "resumesPage.list.group.latestVersion": "最新版本 {title}",
  "resumesPage.list.group.deliveryCount": "{count} 次",
  // 组行右键与「⋯」：只有"看"与"拿出去"两类动作（CR-33 禁止组级破坏性动作）。
  "resumesPage.list.group.expandVersions": "展开 {count} 个版本",
  "resumesPage.list.group.collapseVersions": "收起版本",
  "resumesPage.list.group.openJob": "在岗位广场打开",
  // 组行勾选框的 title：勾一行 = 勾上这一组的每一份简历（三态整组，R1 第四条）。
  "resumesPage.list.group.selectWhole": "勾选这一组的全部 {count} 份简历",
  // 版本行自己的勾选框（展开后才出现）：只想选其中一版时用。
  "resumesPage.list.group.selectVersion": "选择第 {index} 版：{title}",
  // 折叠表的选区摘要：份数 + 其中几个是整组（多版本岗位）带上来的（R1 第四条）。
  "resumesPage.list.group.selectionSummary": "已选 {count} 份（含 {groups} 个整组岗位）",
  // 没有多版本组时的纯份数版本：硬说"含 0 个整组岗位"只是噪音。
  "resumesPage.list.group.selectionSummaryPlain": "已选 {count} 份",
  // 折叠视图分页文案：`total` 是组数，必须同时说清"多少个岗位、多少份简历"。
  "resumesPage.list.totalGroups": "共 {groups} 个岗位 · {resumes} 份简历",
  // 组级列头排序提示（三态机制由箭头自解释，这里只说这一列按什么排）。
  "resumesPage.list.sort.identity": "按岗位名称排序（通用简历按标题）",
  "resumesPage.list.sort.updated": "按组内最近更新的时间排序",
  "resumesPage.list.sort.delivery": "按这个岗位被投递的次数排序",

  // ── 批量操作 ────────────────────────────────────────────
  "resumesPage.selectAll.tooltip": "按当前筛选，一键选中全部 {count} 份简历（跨页，不止当前页）",
  "resumesPage.selectAll.button": "全选全部简历（共 {count} 个）",
  "resumesPage.selectAll.empty": "当前筛选下没有简历",
  "resumesPage.selectAll.tooMany":
    "当前筛选下共 {count} 份简历，超出单次批量上限 5000 份；请先用筛选或搜索缩小范围",
  "resumesPage.selectAll.done": "已选中当前筛选下的全部 {count} 份简历（所有页）",
  "resumesPage.batch.actions": "批量操作",
  // 计数量词是「份」不是「项」：这里选中的是简历，用户与文档都说"N 份简历"（R1 决策）。
  "resumesPage.batch.selected": "已选 {count} 份",
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

  // ── 外部简历（第 21 条：原件 + 正文快照；改字另存新版本）────────────
  "resumesPage.external.title": "外部简历",
  /** 独立页的返回入口（第 1 条）。 */
  "resumesPage.external.back": "返回简历中心",
  /** 筛选栏入口按钮（数量为 0 时的可见文本）。 */
  "resumesPage.external.entry": "外部简历",
  /** 筛选栏入口按钮（有数量时的可见文本）。 */
  "resumesPage.external.entryWithCount": "外部简历 {count}",
  "resumesPage.external.subtitle":
    "原件与提取的正文都留在本机；可改字（每次另存新版本），也能选进投递台、岗位匹配与模拟面试",
  "resumesPage.external.tag": "外部",
  "resumesPage.external.upload": "上传外部简历",
  /** 岗位广场某一行右键/「⋯」里的入口（#6）：岗位由入口定好，弹窗里不再让选。 */
  "resumesPage.external.addFromJob": "添加外部简历",
  /** 成功 Toast：带上文件名与关联的岗位名，配合下面的「查看」动作。 */
  "resumesPage.external.addedToJob": "已添加「{name}」并关联到「{job}」",
  "resumesPage.external.addedToJobNoText": "已添加「{name}」并关联到「{job}」，但没有提取到文字",
  /** Toast 上的动作按钮（≤6 字）：跳到该岗位的外部简历列表。 */
  "resumesPage.external.openList": "查看",
  "resumesPage.external.empty": "还没有上传过外部简历",
  "resumesPage.external.emptyHint":
    "上传你在别处生成的 PDF / Word / TXT / Markdown 简历，可预览与改字（另存新版本）、做文本检查，也能用于投递、岗位匹配与模拟面试",
  "resumesPage.external.chars": "{count} 字",
  "resumesPage.external.noText": "未提取到文字",
  "resumesPage.external.jobTag": "关联岗位：{job}",
  /** 文件行（#3）：副行的状态排第一，「已提取」是常态，「扫描件」才是要提醒的异常。 */
  "resumesPage.external.extractedChars": "已提取 {count} 字",
  "resumesPage.external.scanStatus": "未提取到文字 · 扫描件或图片型 PDF",
  /** 类型徽标：已知类型直接用格式名（PDF / DOCX…），只有这一档需要翻译。 */
  "resumesPage.external.kindOther": "其他",
  "resumesPage.external.column.file": "文件",
  "resumesPage.external.column.job": "关联岗位",
  "resumesPage.external.column.created": "上传时间",
  /** 「最近更新」列（T28）：上传 / 改名 / 改正文 / 恢复会换它，**收藏不会**。 */
  "resumesPage.external.column.updated": "最近更新",
  "resumesPage.external.column.actions": "操作",
  /** 收藏与备注（T28 · 迁移 0031）：一级标记，列表行与详情都能切。 */
  "resumesPage.external.favorite": "收藏",
  "resumesPage.external.unfavorite": "取消收藏",
  "resumesPage.external.favoriteFailed": "收藏状态没保存成功，请重试",
  "resumesPage.external.note.label": "备注",
  "resumesPage.external.note.display": "备注：{note}",
  "resumesPage.external.note.add": "添加备注",
  "resumesPage.external.note.edit": "编辑备注",
  "resumesPage.external.note.placeholder":
    "记一句这份简历的用途，例如「给甲方的那版」「投后端岗用」",
  "resumesPage.external.note.saved": "备注已保存",
  "resumesPage.external.note.failed": "备注没保存成功，请重试",
  "resumesPage.external.note.tooLong": "备注最多 {max} 字",
  /** 重命名弹窗（T28）：校验口径与服务端一致（去空白后非空、不超列宽）。 */
  "resumesPage.external.rename.action": "重命名",
  "resumesPage.external.rename.title": "重命名外部简历",
  "resumesPage.external.rename.label": "文件名",
  "resumesPage.external.rename.empty": "名称不能为空",
  "resumesPage.external.rename.tooLong": "名称最多 {max} 个字符",
  "resumesPage.external.rename.done": "已重命名为「{name}」",
  "resumesPage.external.rename.failed": "重命名失败，请重试",
  /** 导出原件（T28）：下载的是上传时那份文件（原名 + 原扩展名 + 原字节）。 */
  "resumesPage.external.exportOriginal": "导出原件",
  /** 批量删除：先确认（进回收站可恢复），批量场景不叠 5 秒撤销条。 */
  "resumesPage.external.batchDelete.title": "删除选中的 {count} 份外部简历？",
  "resumesPage.external.batchDelete.done": "已删除 {count} 份外部简历",
  "resumesPage.external.batchDelete.partial": "已删除 {done} 份，{failed} 份没有删掉",
  "resumesPage.external.batchDelete.failed": "批量删除失败，请重试",
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
  // 深链 `?resume=<id>` 打不开（不存在 / 已进回收站 / 参数非法）：一条可关的提示。
  "resumesPage.external.deepLinkMissing": "这份外部简历打不开",
  "resumesPage.external.deepLinkMissingHint":
    "它可能已被删除或移入回收站。你可以从下面的列表里重新选一份。",
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
