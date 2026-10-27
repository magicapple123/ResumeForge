// SPDX-License-Identifier: Apache-2.0
/**
 * 收藏夹页：标题与说明、两个页签、岗位与简历表格的列名、来源、行操作、空态与分页总数。
 */
const favorites = {
  "favorites.page.title": "收藏夹",
  "favorites.page.subtitle": "集中查看你关注的招聘信息和简历版本。",
  "favorites.tab.jobs": "招聘信息",
  "favorites.tab.resumes": "简历",
  "favorites.column.job": "岗位",
  "favorites.column.company": "公司",
  "favorites.column.location": "地点",
  "favorites.column.postedAt": "发布时间",
  "favorites.column.actions": "操作",
  "favorites.column.resume": "简历",
  "favorites.column.targetJob": "目标岗位",
  "favorites.column.source": "来源",
  "favorites.column.createdAt": "创建时间",
  "favorites.source.manual": "用户编写",
  "favorites.source.ai": "AI 生成",
  "favorites.action.unfavorite": "取消收藏",
  "favorites.action.openJob": "打开岗位详情",
  "favorites.action.previewExport": "预览 / 导出",
  "favorites.tooltip.importedAt": "导入于 {time}",
  "favorites.empty.jobs": "暂无收藏岗位",
  "favorites.empty.resumes": "暂无收藏简历",
  "favorites.pagination.total": "共 {total} 项收藏",
  "favorites.error.unfavoriteFailed": "取消收藏失败",
} as const;

export default favorites;
