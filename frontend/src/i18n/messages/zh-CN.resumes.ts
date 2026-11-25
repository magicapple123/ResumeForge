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

  // ── 版本堆叠（CR-33）：同一岗位折成一行，展开后逐版操作 ──────────
  /** 组行标题：`{job}` 是岗位名，`{count}` 是版本数。 */
  "resumes.list.group.title": "{job} · {count} 个版本",
  /** 折叠行的投递次数列头（值仍由 `group.delivery` 渲染）。 */
  "resumes.list.column.delivery": "投递次数",
  /** 折叠行的「最近更新」列头（平铺表格仍用 `column.updated`）。 */
  "resumes.list.column.lastUpdated": "最近更新",
  /** 多版本组行上的展开 / 收起动作。 */
  "resumes.list.group.expand": "展开版本",
  "resumes.list.group.collapse": "收起版本",
  /** 组行没有岗位名时的兜底标题（岗位被删或历史数据缺标题）。 */
  "resumes.list.group.titleFallback": "未命名岗位 · {count} 个版本",
  /** 组行上的「最近更新」：`{time}` 是组内最新一版的更新时间。 */
  "resumes.list.group.updated": "最近更新 {time}",
  /** 组行上的投递次数：`{count}` 是整个岗位的投递记录条数。 */
  "resumes.list.group.delivery": "投递过 {count} 次",
  /** 展开区的无障碍名（`{job}` = 岗位名）。 */
  "resumes.list.versionListRegion": "{job} 的版本列表",
  /** 展开后每个版本的序号：`{index}` 从 1 开始、越大越新。 */
  "resumes.list.versionLabel": "第 {index} 版",
  "resumes.list.latestVersion": "最新",
  /** 组行上只读的收藏星标：说明"组内至少一版收藏过"，本身不可点。 */
  "resumes.list.group.favoriteHint": "组内有收藏的版本",
  /** 折叠态禁止整组批量选择时的提示。 */
  "resumes.list.groupSelectDisabled": "多版本岗位请展开后逐版操作",
  /** 折叠视图下点「全选所有简历」时的轻提示：不替用户选看不见的版本。 */
  "resumes.list.selectAllFolded": "折叠视图下不批量选择，请展开分组或先按岗位筛选",
  /** 达到 2000 条抓取上限时列表底部的说明。 */
  "resumes.list.capped": "已加载前 2000 份，可用搜索 / 岗位筛选缩小范围",
} as const;

export default resumes;
