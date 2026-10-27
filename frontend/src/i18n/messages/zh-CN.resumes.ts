// SPDX-License-Identifier: Apache-2.0
/**
 * 简历中心列表表格：列头、排序提示、行操作菜单、收藏按钮、目标岗位单元格与分页总数。
 *
 * 只覆盖 `pages/resumes/ResumeTable.tsx`。卡片视图（`ResumeCardList`）的口径在
 * `zh-CN.responsive.ts`；删除二次确认的两个按钮是两种视图共用的
 * `resumes.remove.confirm.*`（也在那边），这里都不重复。
 */
const resumes = {
  // ── 列头 ─────────────────────────────────────────────────
  "resumes.list.column.favorite": "收藏",
  "resumes.list.column.title": "简历标题",
  "resumes.list.column.job": "目标岗位",
  "resumes.list.column.source": "来源",
  "resumes.list.column.model": "模型",
  "resumes.list.column.note": "备注",
  "resumes.list.column.enhancement": "美化拓展",
  "resumes.list.column.created": "创建时间",
  "resumes.list.column.updated": "最近修改",
  "resumes.list.column.actions": "操作",
  /** 列头排序提示：`{label}` 是列名，拼出来是「按目标岗位排序」。 */
  "resumes.list.sort": "按{label}排序",

  // ── 行操作（行内主操作 + 整行右键菜单） ──────────────────────
  "resumes.list.preview": "预览 / 导出",
  "resumes.list.rename": "重命名",
  "resumes.list.note": "编辑备注",
  "resumes.list.diff": "版本对比",
  "resumes.list.favorite": "收藏",
  "resumes.list.unfavorite": "取消收藏",
  /** 删除二次确认的标题；两个按钮的文案在 `resumes.remove.confirm.*`。 */
  "resumes.list.deleteTitle": "删除这份简历？",
  /** 二次确认的正文：后果 + 可逆性（§4.4 三段式的第三段）。 */
  "resumes.list.deleteBody": "这份简历会移入回收站，之后可以在「回收站」里恢复。",

  // ── 收藏按钮（悬停提示短、无障碍名带对象） ───────────────────
  "resumes.list.favoriteAdd": "收藏简历",
  "resumes.list.favoriteRemove": "取消收藏简历",

  // ── 目标岗位单元格 ──────────────────────────────────────
  "resumes.list.general": "通用简历",
  "resumes.list.generalHint": "不关联岗位、可投递多个方向的简历",
  /** 通用简历的求职意向：`{job}` 是求职意向本身。 */
  "resumes.list.intent": "求职意向：{job}",

  // ── 来源 / 美化拓展 / 滚动区 / 分页 ────────────────────────
  "resumes.list.sourceManual": "用户编写",
  "resumes.list.sourceAi": "AI 生成",
  "resumes.list.off": "未开启",
  "resumes.list.on": "已开启",
  /** 没有记录档位时的悬停说明（只说"已开启"，不编造档位）。 */
  "resumes.list.enhancementOn": "已开启经历美化拓展",
  "resumes.list.scrollRegion": "简历列表（可横向滚动）",
  "resumes.list.total": "共 {total} 条记录",
} as const;

export default resumes;
