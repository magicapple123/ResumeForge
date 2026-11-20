// SPDX-License-Identifier: Apache-2.0
/**
 * 备选岗位：批量选择工具条（勾选范围、计数、导出与删除动作）。
 * 岗位广场：列表行的「复制」子菜单（台账第 13 条，与简历中心共用同一套机制）。
 *
 * 既有 `jobs.candidate.*` 文案在核心包里；本包只补工具条与复制菜单的展示文案。
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

  // ── 岗位列表行的「复制」子菜单 ────────────────────────────
  /** 子菜单标题（右键菜单与行内「⋯」里的同一个折叠项）。 */
  "jobs.copy.menu": "复制",
  "jobs.copy.title": "复制岗位名称",
  "jobs.copy.company": "复制公司",
  "jobs.copy.location": "复制城市",
  "jobs.copy.salary": "复制薪资",
  /** 链接是高频项：内推表单、投递入口都靠它。 */
  "jobs.copy.url": "复制链接",
  "jobs.copy.note": "复制备注",
  /** JD 全文要单独取详情，所以只在列表项标记了「有 JD」时出现。 */
  "jobs.copy.jd": "复制 JD 全文",
  "jobs.copy.row": "复制整行为一行（可直接粘进表格）",
  /** 复制成功：`{field}` 是字段名。 */
  "jobs.copy.done": "已复制{field}",
  /** 剪贴板被拒：桌面端说"手动选中后按快捷键"，不提浏览器。 */
  "jobs.copy.failed": "复制失败，请手动选中文字后按 Ctrl+C",
  /** 异步取 JD 失败或取回空内容：告诉用户下一步，不谎报成功。 */
  "jobs.copy.jdFailed": "JD 没取到，请打开详情后再复制",
  /** 提示语里的字段名（"复制了什么"，与菜单文案分开）。 */
  "jobs.copy.field.title": "岗位名称",
  "jobs.copy.field.company": "公司",
  "jobs.copy.field.location": "城市",
  "jobs.copy.field.salary": "薪资",
  "jobs.copy.field.url": "链接",
  "jobs.copy.field.note": "备注",
  "jobs.copy.field.jd": "JD 全文",
  "jobs.copy.field.row": "整行",
} as const;

export default jobs;
