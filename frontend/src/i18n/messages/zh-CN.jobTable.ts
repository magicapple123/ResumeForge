// SPDX-License-Identifier: Apache-2.0
/**
 * 岗位列表表格：列名、排序提示、岗位名单元格、行操作菜单与分页总数。
 *
 * `STATUS_LABELS` 的值（「开放中」）是落库的数据值，也是 `JOB_STATUS_META` 的查找键，
 * 不是界面文案：翻成语言包里的 key 会让 Tag 查不到颜色与显示名（静默掉成 default）。
 * 那一处的归一化留在组件里，状态显示名的本地化需要先把 `types/job.ts` 的
 * `JOB_STATUS_META` 改成 labelKey（另起一批）。
 */
const jobTable = {
  "jobTable.column.favorite": "收藏",
  "jobTable.column.title": "岗位",
  "jobTable.column.company": "公司",
  "jobTable.column.location": "城市",
  "jobTable.column.salary": "薪资",
  "jobTable.column.jobType": "类型",
  "jobTable.column.status": "状态",
  "jobTable.column.note": "备注",
  "jobTable.column.postedAt": "发布时间",
  "jobTable.column.actions": "操作",
  "jobTable.action.favorite": "收藏岗位",
  "jobTable.action.unfavorite": "取消收藏",
  "jobTable.action.detail": "详情",
  "jobTable.action.generate": "生成简历",
  "jobTable.action.write": "自行编写",
  "jobTable.action.resumes": "相关简历",
  "jobTable.action.resumeGraph": "查看简历关系图",
  "jobGraph.wide": "大屏显示",
  "jobGraph.wideExit": "退出大屏",
  "jobGraph.title": "简历关系图",
  "jobGraph.hint": "拖动平移，按住 Ctrl 或 ⌘ 滚轮缩放",
  "jobGraph.external": "外部",
  "jobGraph.internal": "内部",
  "jobGraph.limit": "仅显示最近 60 份，共 {total} 份",
  "jobGraph.empty": "该岗位还没有关联简历",
  "jobGraph.generate": "生成简历",
  "jobGraph.loadFailed": "简历关系未加载，请重试",
  "jobGraph.zoomIn": "放大关系图",
  "jobGraph.zoomOut": "缩小关系图",
  "jobGraph.reset": "适应窗口",
  "jobGraph.canvas": "简历关系图画布",
  "jobTable.action.edit": "编辑",
  "jobTable.sort.title": "按岗位名称排序",
  "jobTable.sort.company": "按公司名称排序",
  "jobTable.sort.postedAt": "按发布时间排序（没有发布时间的按导入时间）",
  "jobTable.tooltip.importedAt": "导入于 {time}",
  "jobTable.source.collected": "采集",
  "jobTable.source.manual": "手动",
  "jobTable.note.imageCount": "{count} 张图",
  "jobTable.note.imageHint": "备注里有 {count} 张图片，打开详情查看",
  "jobTable.pagination.total": "共 {total} 个岗位",
} as const;

export default jobTable;
