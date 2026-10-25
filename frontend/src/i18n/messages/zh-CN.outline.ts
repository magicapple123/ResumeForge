// SPDX-License-Identifier: Apache-2.0
/**
 * 「文档大纲」（W06 / P1-01、D01）这一批**新增**的界面文案。
 *
 * 为什么单独成文件：`messages/zh-CN.ts` 已接近 500 行硬预算，拆法与
 * `zh-CN.workbench.ts` / `zh-CN.fonts.ts` 完全一致——扁平点分 key、一个默认导出、
 * `as const`；`zh-CN.ts` 末尾 `...outline` 展开合并，`MessageKey` 自动包含新 key。
 *
 * ## 边界
 *
 * - **只放本批新增的 key**。已有的「教育」「实习/工作」「板块顺序」「条目间距」等 key 一律复用，
 *   本文件不重复定义（重复定义会被 spread 静默覆盖）。
 * - 术语按 `docs/ui-copy-guide.md` 与 plan：**板块**（简历分区）→ **条目**（一段经历/项目）→
 *   **要点**（条目里的一条 bullet）。「排版参数」是左栏另一页的名字，不在这里叫「版式」。
 * - 按钮写具体动作：不写「确定」「是」「否」；标题 ≤7 字、正文 ≤30 字，不用感叹号与句号。
 *
 * ## 与后端字段的对应（文件内注释，不是文案）
 *
 * `hidden` / `lock_content` / `lock_layout` 是条目上的可选布尔字段（W06-BE）。取消时
 * **删除键**而不是写 `false`：旧记录的内容指纹必须逐字节不变（W00 §3 的兼容前提）。
 */

const outline = {
  // ── 面板与分组 ─────────────────────────────────────────────
  /** 面板标题，也是左栏切换页签的名字（wb-core 挂载时直接复用这一条，避免两份）。 */
  "outline.panel.title": "文档大纲",
  /** 大纲树的读屏区域名（`role="tree"`）。 */
  "outline.tree.label": "简历文档大纲",
  /** 面板右上角的总体计数。 */
  "outline.count.summary": "{entries} 个条目 · {points} 条要点",
  /** 整份简历一个条目都没有时的空态。 */
  "outline.empty": "这份简历还没有条目，先在中栏添加内容",
  /** 某个板块没有条目时的行内说明（不摆大空态）。 */
  "outline.section.empty": "暂无条目",
  /** 条目没有任何可用标题时的占位（用户数据为空，不是让用户改文案）。 */
  "outline.entry.untitled": "未命名条目",
  /** 条目行尾的要点数量。 */
  "outline.entry.lineCount": "{count} 条要点",
  /** 条目在规则边界内还没有要点时的行内说明。 */
  "outline.point.empty": "暂无要点",
  /** 只读宿主（生成流程预览）里显示：结构操作不可用。 */
  "outline.readonly": "只读：当前不能修改结构",
  /** 个人信息板块的条目名（板块标题已写「个人信息」，这里是被选中的对象类型）。 */
  "outline.section.personal": "个人信息",
  "outline.section.education": "教育经历",
  "outline.section.experience": "工作经历",
  "outline.section.campus_experience": "校园经历",
  "outline.section.projects": "项目经历",
  "outline.section.skills": "专业技能",
  "outline.section.awards": "荣誉奖项",

  // ── 行项的无障碍名与徽标 ─────────────────────────────────────
  /** 展开/收起按钮的读屏名。 */
  "outline.expand": "展开「{name}」",
  "outline.collapse": "收起「{name}」",
  /** 要点的可访问名前缀（后面接用户原文）。 */
  "outline.point.label": "要点",
  /** 排序手柄的读屏名：说清「移动哪一条」。 */
  "outline.sort.handle": "移动「{name}」",
  /** 排序手柄的 Tooltip/提示句：鼠标与键盘两种方式各说一句。 */
  "outline.sort.handle.hint": "拖动排序，或按 Enter 用键盘排序",
  /** 要点排序手柄的读屏名。 */
  "outline.sort.pointHandle": "移动这条要点",
  /** 已隐藏条目的行内徽标。 */
  "outline.hidden.badge": "已隐藏",
  /** 隐藏语义的说明：编辑态保留原文、正式导出排除（只说一次，徽标 Tooltip 用）。 */
  "outline.hidden.hint": "已隐藏：编辑区仍保留原文，正式导出会排除",
  /** 锁正文的行内徽标。 */
  "outline.lock.content.badge": "内容锁定",
  /** 锁排版的行内徽标。 */
  "outline.lock.layout.badge": "排版锁定",
  /** 锁正文的范围说明（属性区 Tooltip）：锁正文仍可调排版。 */
  "outline.lock.content.hint": "锁正文：AI 与改写不能修改这段内容，排版仍可调整",
  /** 锁排版的说明：锁排版仍可改正文。 */
  "outline.lock.layout.hint": "锁排版：不能拖动排序，正文仍可修改",

  // ── 结构操作（属性区按钮）─────────────────────────────────────
  "outline.action.hide": "隐藏",
  "outline.action.show": "显示",
  "outline.action.clone": "复制条目",
  "outline.action.lock-content": "锁定内容",
  "outline.action.unlock-content": "解除内容锁定",
  "outline.action.lock-layout": "锁定排版",
  "outline.action.unlock-layout": "解除排版锁定",
  /** 被锁挡住时的原因：给出路（先解锁），不说「操作失败」。 */
  "outline.blocked.locked-layout": "排版已锁定，先解除「锁定排版」再排序",
  "outline.blocked.locked-content": "内容已锁定，先解除「锁定内容」再复制",
  /** 命令指向的对象已不存在（极端并发/旧数据）：说清下一步。 */
  "outline.blocked.not-found": "这条内容已经不存在，刷新页面后再试",

  // ── 键盘排序 ───────────────────────────────────────────────
  /** 进入排序模式后的操作说明（读屏与 Tooltip 共用）。 */
  "outline.sort.hint": "方向键移动，Home/End 到首尾，Enter 确认，Esc 取消",
  /** 排序模式中每次移动的播报。 */
  "outline.sort.active": "正在移动「{name}」：第 {position} 位，共 {total} 位",
  /** 确认后的播报。 */
  "outline.sort.committed": "已把「{name}」移到第 {position} 位",
  /** 取消后的播报。 */
  "outline.sort.cancelled": "已取消移动「{name}」",

  // ── 要点级显隐与复制（W06）─────────────────────────────────
  /** 要点行内"隐藏这条要点"按钮的读屏名（可见形态是图标按钮）。 */
  "outline.point.hide": "隐藏这条要点",
  "outline.point.show": "显示这条要点",
  /** 要点行内"复制这条要点"按钮的读屏名。 */
  "outline.point.clone": "复制要点",
  /** 被隐藏要点的行内徽标。 */
  "outline.point.hiddenBadge": "要点已隐藏",
  /** 条目行尾：该条目下有多少条要点被单独隐藏。 */
  "outline.hiddenPoints.badge": "{count} 条要点已隐藏",
  /** 操作后的播报（带数量，读屏可确认这次生效了）。 */
  "outline.point.hidden": "已隐藏 {count} 条要点",
  "outline.point.shown": "已显示 {count} 条要点",
  "outline.point.cloned": "已复制这条要点",
  /** 要点级隐藏的说明（Tooltip）：编辑区保留原文、正式导出排除。 */
  "outline.point.hiddenHint": "已隐藏：编辑区仍保留原文，正式导出会排除",

  // ── 大纲搜索与定位（D01）─────────────────────────────────────
  /** 搜索框的读屏名。 */
  "outline.search.label": "搜索大纲",
  "outline.search.placeholder": "搜姓名、板块、条目或要点",
  /** 有查询时清空按钮的读屏名。 */
  "outline.search.clear": "清除搜索",
  /** 命中计数（当前 / 总数）。 */
  "outline.search.count": "第 {current} / {total} 条命中",
  /** 没有命中时的行内说明（不摆大空态）。 */
  "outline.search.noMatch": "没有匹配的内容",
  /** 搜索框旁的键盘说明（Tooltip + 常驻小字）。 */
  "outline.search.navigateHint": "↑↓ 选择，Enter 定位，Esc 清除",
  /** 命中列表的上一条/下一条（鼠标等价物；键盘用 ↑↓）。 */
  "outline.search.prev": "上一条命中",
  "outline.search.next": "下一条命中",
  /** "定位后恢复原滚动位置"的恢复按钮。 */
  "outline.search.restore": "回到之前位置",
  "outline.search.restored": "已回到之前的位置",
  /** 定位完成后的播报（对象名是用户数据）。 */
  "outline.search.located": "已定位「{name}」",
  /** 点画布字段跳进大纲后，复原入口的说明。 */
  "outline.search.restoreHint": "刚才是从纸面点进来的，可以回到原来的滚动位置",

  // ── 多选与批量显隐 ──────────────────────────────────────────
  /** 多选工具栏的读屏区域名。 */
  "outline.batch.toolbar": "大纲多选操作",
  /** 已选数量的表述。 */
  "outline.batch.selected": "已选 {count} 项",
  /** 批量隐藏按钮。 */
  "outline.batch.hide": "隐藏所选",
  /** 批量显示按钮。 */
  "outline.batch.show": "显示所选",
  /** 清空多选。 */
  "outline.batch.clear": "取消选择",
  /** 批量显隐后的播报。 */
  "outline.batch.hidden": "已隐藏 {count} 个条目",
  "outline.batch.shown": "已显示 {count} 个条目",
  /** 多选的操作提示（Tooltip）：键盘等价必须可发现。 */
  "outline.batch.hint": "按住 Ctrl 点击或按空格可多选",

  // ── 属性区（最小版；完整属性面板归 W07）─────────────────────
  /** 属性区标题。 */
  "outline.inspector.title": "所选对象",
  /** 属性区里对象类型的三种取值。 */
  "outline.inspector.kind.personal": "个人信息",
  "outline.inspector.kind.entry": "条目",
  "outline.inspector.kind.point": "要点",
  /** 没有选中对象时的说明。 */
  "outline.inspector.empty": "在大纲里选一个条目，查看可用设置",
  /** 属性区分组标题。 */
  "outline.inspector.visibility": "可见性",
  "outline.inspector.locks": "锁定",
  "outline.inspector.actions": "操作",
  /** 要点文本的标签。 */
  "outline.inspector.pointText": "要点文本",
  /** 选中要点时说明它属于哪条条目。 */
  "outline.inspector.parentEntry": "所属条目：{name}",
  /** 选中个人信息时的说明：编辑入口在中栏，不在这里重复实现一套表单。 */
  "outline.inspector.personalHint": "个人信息的编辑入口在中栏「基本信息」",
  /** 锁定开关的读屏名（Switch 没有可见文字时用它）。 */
  "outline.inspector.toggleContent": "锁定内容",
  "outline.inspector.toggleLayout": "锁定排版",
  /** 隐藏开关的读屏名。 */
  "outline.inspector.toggleHidden": "在导出中隐藏",
  /** 画布高亮的说明：精确预览是 PDF，没有可高亮的 DOM。 */
  "outline.canvas.exact": "精确预览是 PDF，纸面上暂时无法高亮",

  // ── 画布高亮（注入 iframe 的样式，不是界面文案；集中在这里便于审计）──
  // 注意：iframe 文档里没有应用的 --rf-* 变量（它是独立的简历 HTML），所以高亮用
  // currentColor 派生透明度，跟纸面文字色走，深浅主题都不需要第二套值。
  "outline.canvas.highlight.style":
    "background: color-mix(in srgb, currentColor 14%, transparent); box-shadow: 0 0 0 1px color-mix(in srgb, currentColor 45%, transparent); border-radius: 2px",
} as const;

export default outline;
