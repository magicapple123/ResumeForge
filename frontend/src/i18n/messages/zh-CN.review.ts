// SPDX-License-Identifier: Apache-2.0
/**
 * 「离线对象批注」（W18 / D17）与「离线分享包」弹窗（R-18）的界面文案。
 *
 * `sharePackage.*` 是同一个弹窗里的分享/脱敏/评论回传文案：与批注无关，但同属
 * 分享包这一屏，放同一个命名空间比再开一个文件更省一次注册。
 *
 * 拆法与现有命名空间一致：扁平点分 key、一个默认导出、`as const`；由 lead 在
 * `zh-CN.namespaces.ts` 聚合。术语口径：
 * - **评审包** = 分享包里附带的 `annotations.json` sidecar（不是一种新的分享包类型）；
 * - **批注** = 一条对象定位的评论；状态用「待解决 / 已解决 / 已失联 / 已忽略」；
 * - 「重新关联」是 stale 批注唯一的恢复动作（绝不自动/按下标挂到别的对象）。
 *
 * 按钮写具体动作、被拒绝时给出路；标题 ≤7 字、正文 ≤30 字、Toast ≤20 字，不用感叹号与句号。
 */

const review = {
  // ── 面板 ──────────────────────────────────────────────────
  "review.panel.title": "对象批注",
  /** 面板头计数：总数与待解决数。 */
  "review.panel.summary": "共 {total} 条 · 待解决 {open} 条",
  /** 失联批注的顶部提醒：必须说清"要用户显式确认"，不能自动挂。 */
  "review.panel.staleWarning": "{count} 条批注的对象已变更，需确认后重新关联",
  /** 加载失败（ErrorState 正文）：给重试出路。 */
  "review.panel.loadFailed": "批注加载失败，请重试",
  /** 空态：说明批注从哪来、下一步做什么。 */
  "review.panel.empty": "还没有回传批注",
  "review.panel.emptyHint": "把评审包发给对方，收件人填写后交回导入",
  /** 有批注但当前筛选为空。 */
  "review.panel.filterEmpty": "当前筛选没有批注",
  /** 只读宿主/只读权限下的说明。 */
  "review.panel.readOnly": "只读：不能修改批注状态",
  /** 分享包权限不足时（read_only）：说明需要什么权限。 */
  "review.share.permissionNeeded": "这份分享包是只读权限，不能回传批注；重新生成时选择「可评论」",

  // ── 状态与筛选 ────────────────────────────────────────────
  "review.status.open": "待解决",
  "review.status.resolved": "已解决",
  "review.status.stale": "已失联",
  "review.status.dismissed": "已忽略",
  /** 失联的原因与唯一的恢复动作（不自动重挂）。 */
  "review.status.staleHint": "批注指向的对象或要点已变更，不能自动定位；请确认后重新关联或忽略",
  /** 已忽略的语义：不再提示，但记录保留。 */
  "review.status.dismissedHint": "已忽略：不再提示，记录保留",
  "review.filter.all": "全部",
  "review.filter.open": "待解决",
  "review.filter.resolved": "已解决",
  "review.filter.stale": "已失联",
  "review.filter.dismissed": "已忽略",
  /** 筛选条的无障碍名。 */
  "review.filter.label": "按批注状态筛选",

  // ── 列表行 ────────────────────────────────────────────────
  /** 批注人（收件人自填，可能与真实身份无关）。 */
  "review.annotation.reviewer": "批注人：{name}",
  /** 当时看到的原文引用。 */
  "review.annotation.quote": "引用：{text}",
  /** 条目/要点在当前文档里的定位结果。 */
  "review.annotation.target": "对象：{name}",
  /** 兼容锚点（旧包）定位时的说明。 */
  "review.annotation.legacyAnchor": "按旧路径定位",
  /** 无法定位时的说明（不提供定位按钮）。 */
  "review.annotation.unlocatable": "对象已变更，暂时无法定位",
  /** 定位按钮：跳到画布/大纲里的该对象。 */
  "review.action.locate": "定位",
  /** 状态时间。 */
  "review.annotation.resolvedAt": "解决于 {time}",
  "review.annotation.statusLabel": "批注状态",

  // ── 状态操作 ──────────────────────────────────────────────
  "review.action.resolve": "标记已解决",
  "review.action.reopen": "重新打开",
  "review.action.dismiss": "忽略这条",
  "review.action.reattach": "重新关联",
  /** 成功文案必须含对象/数量。 */
  "review.toast.resolved": "已标记一条批注为解决",
  "review.toast.reopened": "已重新打开一条批注",
  "review.toast.dismissed": "已忽略一条批注",
  "review.toast.statusFailed": "批注状态没保存上，请重试",

  // ── 重新关联（stale 唯一恢复路径）───────────────────────────
  "review.reattach.title": "重新关联到当前对象",
  "review.reattach.hint": "先在画布或大纲里选中一个对象，再点「重新关联」",
  "review.reattach.noTarget": "还没有选中对象，先在画布或大纲里选一个",
  "review.reattach.success": "已把批注重新关联到当前对象",
  "review.reattach.failed": "重新关联失败，请重试",

  // ── 导入回传 ──────────────────────────────────────────────
  "review.action.import": "导入回传批注",
  "review.action.export": "导出评审包",
  "review.import.title": "导入回传批注",
  "review.import.hint": "选择或粘贴收件人交回的 annotations.json（JSON，最大 512 KB）",
  /** 只支持 JSON 的原因（Markdown 没有对象锚点）。 */
  "review.import.formatHint": "只支持 JSON；Markdown 无法承载对象定位",
  "review.import.file": "选择文件",
  "review.import.pasteLabel": "回传文件内容",
  "review.import.placeholder": "粘贴 annotations.json 的内容",
  "review.import.submit": "导入批注",
  "review.import.cancel": "收起",
  "review.import.empty": "请先选择文件或粘贴内容",
  "review.import.fileTooLarge": "文件超过 512 KB，请精简后重试",
  "review.import.readFailed": "读取文件失败，请重试",
  "review.import.failed": "导入失败，请检查文件后重试",
  "review.import.success": "已导入 {imported} 条，跳过重复 {duplicates} 条",
  "review.import.staleNotice": "其中 {stale} 条因对象已变更标为「已失联」",
  "review.import.rejected": "有 {count} 条批注格式不正确，已忽略",
  /** 去重口径说明：重复导入不覆盖已解决状态。 */
  "review.import.dedupHint": "重复导入同一批会自动跳过，不覆盖已解决状态",
  "review.import.previewTitle": "导入结果",

  // ── 导出评审包 ────────────────────────────────────────────
  "review.export.success": "评审包已下载",
  "review.export.failed": "导出评审包失败，请重试",

  // ── 解析错误（`annotations.json` v1 fail-closed）──────────────
  "review.error.too-large": "文件超过 512 KB，请精简后重试",
  "review.error.not-json": "内容不是有效的 JSON",
  "review.error.bad-format": "不是 ResumeForge 评审包",
  "review.error.bad-version": "评审包版本不受支持，请升级后重试",
  "review.error.bad-token": "评审包缺少有效的分享码",
  "review.error.bad-snapshot": "评审包缺少分享包快照指纹",
  "review.error.bad-reviewer": "批注人名称过长",
  "review.error.bad-annotations": "批注列表格式不正确",
  /** 逐条错误：点出第几条、哪个字段（一次列全）。 */
  "review.error.bad-annotation": "第 {index} 条批注的「{field}」不正确",
  "review.error.duplicate-external-id": "第 {index} 条批注的编号与包内其它批注重复",
  /** 未知字段名的兜底（不显示英文键名）。 */
  "review.field.unknown": "字段",
  "review.field.external_id": "编号",
  "review.field.object_id": "对象",
  "review.field.point_id": "要点",
  "review.field.path": "路径",
  "review.field.text": "正文",
  "review.field.quoted_text": "引用",
  "review.field.created_at": "时间",
  "review.field.field": "字段名",
  "review.field.status": "状态",
  "review.field.id": "编号",

  // ── 离线分享包（SharePackageModal，R-18）────────────────────────
  "review.sharePackage.title": "离线分享包",
  "review.sharePackage.permission.label": "分享权限",
  "review.sharePackage.permission.readOnlyOption": "只读（不可回传评论）",
  "review.sharePackage.permission.commentOption": "可评论（附带评论回传文件）",
  "review.sharePackage.permission.readOnlyTag": "只读",
  "review.sharePackage.permission.commentTag": "可评论",
  "review.sharePackage.redaction.label": "脱敏范围",
  /** 分享包固定基于脱敏内容生成：这是隐私边界的说明，不是可选项。 */
  "review.sharePackage.redaction.hint": "分享包始终基于脱敏后的内容生成，不含真实敏感信息。",
  "review.sharePackage.photo.label": "照片",
  "review.sharePackage.photo.include": "包含照片",
  "review.sharePackage.photo.hint":
    "分享包固定包含 HTML 与 PDF；取消勾选后这两个文件都不再绘制照片。",
  "review.sharePackage.action.generate": "生成分享包",
  "review.sharePackage.action.downloadZip": "下载离线包（zip）",
  "review.sharePackage.intro": "分享包含 HTML、PDF、脱敏快照与文件清单；生成后在这里显示实际体积。",

  // ── 生成结果 ────────────────────────────────────────────
  "review.sharePackage.field.title": "标题",
  "review.sharePackage.field.directory": "本地目录",
  "review.sharePackage.field.shareCode": "分享码",
  "review.sharePackage.field.permission": "权限",
  "review.sharePackage.field.estimatedSize": "预计体积",
  /** 体积一句：数字与文件数都走占位符，拼接在英文里语序不通。 */
  "review.sharePackage.estimatedSizeValue": "约 {size}（{count} 个文件）",
  "review.sharePackage.usage.title": "使用说明",
  "review.sharePackage.usage.body":
    "把整个文件夹发给对方，对方用浏览器打开 resume.html 即可查看；HTML 与 PDF 由同一份版式生成。",
  /** 句首空格是原渲染的一部分：它接在上一句的句号后面。 */
  "review.sharePackage.usage.commentExtra":
    " 如需评论，让对方填写 comments.md 后回传给你，你用「导入评论」导入。",
  "review.sharePackage.action.openDirectory": "打开所在文件夹",
  "review.sharePackage.action.copyPath": "复制路径",
  "review.sharePackage.files.title": "文件清单",

  // ── 评论回传 ────────────────────────────────────────────
  "review.sharePackage.comments.title": "评论回传",
  "review.sharePackage.comments.hint": "把收件人回传的评论内容粘贴进来导入（Markdown 或 JSON）。",
  "review.sharePackage.comments.empty": "（还没有评论）",
  "review.sharePackage.comments.aria": "评论回传内容",
  "review.sharePackage.comments.placeholder": "粘贴收件人回传的评论内容",
  "review.sharePackage.action.importComments": "导入评论",

  // ── Toast 与错误兜底 ────────────────────────────────────
  "review.sharePackage.zipStarted": "离线包已开始下载",
  "review.sharePackage.zipFailed": "生成离线包失败",
  "review.sharePackage.generated": "分享包已生成",
  "review.sharePackage.generateFailed": "生成分享包失败",
  "review.sharePackage.commentRequired": "请先粘贴或填写收件人回传的评论",
  "review.sharePackage.commentImported": "评论已导入",
  "review.sharePackage.commentImportFailed": "导入评论失败",
  "review.sharePackage.downloadFailed": "下载文件失败",
  "review.sharePackage.movedToTrash": "分享包已移入回收站，可在「回收站」里恢复",
  "review.sharePackage.deleteFailed": "删除分享包失败",
  "review.sharePackage.revealFailed": "打开文件夹失败",
  "review.sharePackage.pathCopied": "已复制分享包路径",
  "review.sharePackage.copyFailed": "复制失败，可以手动复制：{path}",

  // ── 行内操作（二次确认）─────────────────────────────────
  "review.sharePackage.delete.label": "删除此分享包",
  "review.sharePackage.delete.confirm": "删除此分享包？",
} as const;

export default review;
