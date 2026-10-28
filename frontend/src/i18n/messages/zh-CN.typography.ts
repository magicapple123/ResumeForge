// SPDX-License-Identifier: Apache-2.0
/**
 * 「局部排版」（W07 / P1-02、D02、D03、D06）这一批**新增**的界面文案。
 *
 * 为什么单独成文件：`messages/zh-CN.ts` 已到 500 行零豁免硬预算，拆法与
 * `zh-CN.workbench.ts` / `zh-CN.outline.ts` 完全一致——扁平点分 key、一个默认导出、
 * `as const`；`zh-CN.ts` 末尾 `...typography` 展开合并，`MessageKey` 自动包含新 key。
 *
 * ## 边界
 *
 * - **只放本批新增的 key**：既有「行距」「页边距」等词条继续复用（`resume.measure.*`、
 *   `workbench.param.*`），本文件不重复定义（重复定义会被 spread 静默覆盖）。
 * - 术语按 `docs/ui-copy-guide.md`：**模板**（外观骨架）/ **版式**（参数预设）/
 *   **排版参数**（整份简历的范围）/ **版面**（排出来的效果）。四层不许混写。
 * - 来源标签用三种用户能区分的说法：来自模板 / 来自版式 / 本条已调整；角色级多一档
 *   「同类段落已调整」——它不是"整份简历"，也不是"这一条"，混进任一侧都会说错作用范围。
 * - 按钮写具体动作：不写「确定」「确认」；标题 ≤7 字、正文 ≤30 字，不用感叹号与句号。
 */

const typography = {
  // ── 分组与面板 ─────────────────────────────────────────────
  /** 参数栏新增分组的标题（wb-core 挂载时直接复用这一条）。 */
  "typography.group.title": "局部排版",
  /** 分组标题下的一句话：说明三个作用范围的关系。 */
  "typography.panel.hint": "只影响所选范围，未设置时随模板",
  /** 说明"整份简历"的范围仍在既有排版参数里，避免用户在这里找全局滑杆。 */
  "typography.panel.globalHint": "整份简历的范围用上方排版参数调整",
  /** 旧后端 / 目录未下发 template_role_defaults 时的说明：滑杆起点不代表模板真实值。 */
  "typography.catalog.missing": "目录暂未提供模板基准，滑杆起点为中性值",
  /** 角色分组的区域名（读屏用）。 */
  "typography.role.groupAria": "同类段落排版",

  // ── 来源标签（三态 + 角色一档）──────────────────────────────
  "typography.source.template": "来自模板",
  /** 扁平键层（L2 版式与 L3 记录覆盖已被调用方合成，后端统一报 resume；这里说"已调整"）。 */
  "typography.source.resume": "已调整",
  "typography.source.role": "同类段落已调整",
  "typography.source.object": "本条已调整",
  /** 来源胶囊的 Tooltip：模板档。 */
  "typography.source.template.title": "未单独设置，随模板渲染",
  /** 来源胶囊的 Tooltip：扁平键档（版式预设或记录覆盖）。 */
  "typography.source.resume.title": "已按整份简历的排版参数调整",
  /** 来源胶囊的 Tooltip：角色档。 */
  "typography.source.role.title": "同类段落统一改过，这条跟随",
  /** 来源胶囊的 Tooltip：对象档。 */
  "typography.source.object.title": "只改了这一条",

  // ── 六个段落角色 ───────────────────────────────────────────
  "typography.role.name": "姓名",
  "typography.role.section_title": "板块标题",
  "typography.role.entry_title": "条目标题",
  "typography.role.body": "正文",
  "typography.role.meta": "日期与元信息",
  "typography.role.emphasis": "重点文字",
  /** 角色 header 上的覆盖计数胶囊：不写裸数字（读屏与视觉都要能自解释）。 */
  "typography.role.ownCount": "{count} 项已调整",
  /** 恢复某个角色的全部覆盖。 */
  "typography.role.clear": "恢复这个段落类型",
  "typography.role.clearAria": "把「{role}」全部属性恢复到继承",

  // ── 十二个属性名 ───────────────────────────────────────────
  "typography.prop.font_scale": "字号比例",
  "typography.prop.color": "颜色",
  "typography.prop.bold": "加粗",
  "typography.prop.italic": "斜体",
  "typography.prop.space_before": "段前距",
  "typography.prop.space_after": "段后距",
  "typography.prop.line_height": "行距",
  "typography.prop.indent": "缩进",
  "typography.prop.bullet": "项目符号",
  "typography.prop.align": "对齐",
  "typography.prop.meta_align": "日期位置",
  "typography.prop.letter_spacing": "字距",

  // ── 枚举值 ─────────────────────────────────────────────────
  "typography.enum.bullet.dot": "圆点",
  "typography.enum.bullet.dash": "短横",
  "typography.enum.bullet.none": "不显示",
  "typography.enum.align.left": "左对齐",
  "typography.enum.align.center": "居中",
  "typography.enum.align.right": "右对齐",
  "typography.enum.align.justify": "两端对齐",
  "typography.enum.metaAlign.right": "日期靠右",
  "typography.enum.metaAlign.inline": "日期紧随标题",

  // ── 一行控件的交互（D02：直接输入 + 步进 + 临时放大步进 + 恢复继承）──
  /** 标签双击/回车的提示。 */
  "typography.row.resetHint": "双击标签或点恢复按钮回到继承",
  /** 恢复按钮的 Tooltip。 */
  "typography.row.reset": "恢复继承",
  /** 恢复按钮的读屏名。 */
  "typography.row.resetAria": "把「{label}」恢复到继承值",
  /** 步进按钮的临时放大说明。 */
  "typography.row.stepHint": "Shift 单击步进五倍",
  /** 直接输入框的无障碍名。 */
  "typography.row.directInputAria": "直接输入{label}",
  /** 滑杆的无障碍名。 */
  "typography.row.sliderAria": "{label}（拖动调整）",
  "typography.row.decreaseAria": "减少{label}",
  "typography.row.increaseAria": "增加{label}",
  /** 输入越界被夹回区间时的提示（不静默吞掉用户的输入）。 */
  "typography.row.invalid": "数值超出范围，已回到允许区间",
  /** 字号的 pt 对照读数（只显示，不换算落库值）。 */
  "typography.value.pt": "约 {pt}pt",

  // ── 对象级面板（选中一条内容后的最小属性区）──────────────────
  "typography.object.title": "这条的排版",
  "typography.object.empty": "先在大纲或纸面选中一条内容",
  "typography.object.close": "收起这条排版",
  "typography.object.clear": "恢复这一条的全部继承",
  /** 面板头部的对象名：范围说清。 */
  "typography.object.scope": "只作用于「{name}」",
  "typography.object.untitled": "未命名条目",

  // ── 格式刷 ─────────────────────────────────────────────────
  "typography.painter.title": "格式刷",
  /** 复制源对象的局部调整。 */
  "typography.painter.copy": "复制局部调整",
  /** 源对象没有局部调整时的禁用说明。 */
  "typography.painter.empty": "这条没有局部调整，先改一处",
  /** 已复制差异、等待目标时的状态说明。 */
  "typography.painter.armed": "已复制，选中目标后应用",
  "typography.painter.apply": "应用格式刷",
  "typography.painter.cancel": "退出格式刷",
  /** 把当前生效值固化成本条覆盖（显式第二动作）。 */
  "typography.painter.freeze": "固化为局部调整",
  /** 固化的代价：这是用户必须看见的语义变化。 */
  "typography.painter.freezeHint": "固化后这条不再随同类段落变化",
  /** 格式刷来源名。 */
  "typography.painter.source": "来源「{name}」",
  /** 应用成功提示（含对象数）。 */
  "typography.painter.applied": "已应用到 {count} 条",

  // ── 多选批量调整（D03）──────────────────────────────────────
  "typography.multi.title": "批量调整",
  "typography.multi.count": "已选 {count} 条",
  "typography.multi.empty":
    "在左侧「文档大纲」选中条目（或按空格多选）后，可设置文字级别与批量样式",
  "typography.multi.clear": "取消选择",
  /** 三个批量控件的空值占位：不动这项。 */
  "typography.multi.unchanged": "不改这项",
  "typography.multi.apply": "应用到所选条目",
  "typography.multi.applied": "已应用到 {count} 条",
  /** 重复条目提醒（D03：内容雷同的条目会被读成复制粘贴）。 */
  "typography.multi.duplicate": "所选条目内容重复",
  "typography.multi.duplicateDetail": "{count} 条内容相同：{names}",

  // ── 格式能力说明（不支持 ≠ 假装等价）─────────────────────────
  "typography.capability.title": "格式支持",
  /** 精确 PDF：斜体不倾斜、字距不支持；其余属性已支持。 */
  "typography.capability.pdf": "精确 PDF：斜体与字距按模板值，其余已支持",
  "typography.capability.word": "Word 与 HTML 支持全部属性",
  "typography.capability.draft": "草稿预览为 CSS 近似，以精确 PDF 为准",

  // ── 字符级标记（斜体 / 链接；加粗沿用右键菜单的既有语义）────────
  "typography.inline.groupAria": "字符格式",
  "typography.inline.bold": "加粗",
  "typography.inline.italic": "斜体",
  "typography.inline.link": "链接",
  "typography.inline.boldAria": "加粗所选文字",
  "typography.inline.italicAria": "斜体所选文字",
  "typography.inline.linkAria": "给所选文字加链接",
  /** 链接输入弹层的标题（≤7 字）。 */
  "typography.inline.linkTitle": "插入链接",
  "typography.inline.linkPlaceholder": "https://example.com",
  "typography.inline.linkApply": "插入链接",
  "typography.inline.linkCancel": "取消",
  /** 三个"没反应"的原因：说清下一步，不静默。 */
  "typography.inline.noTarget": "先点中要修改的文本框",
  "typography.inline.selectFirst": "先选要修改的文字",
  "typography.inline.invalidUrl": "链接要用 http(s) 地址",
  // ── 文字级别（W07-TL：一级/二级/三级标题、正文、次要说明）────────────
  /** 工具条标题。 */
  "typography.level.title": "文字级别",
  /** 按钮组 / 工具条的读屏名。 */
  "typography.level.groupAria": "把选中的内容设为固定文字级别",
  /** 一句口径：级别作用在段落上，不是整份缩放，且可撤销。 */
  "typography.level.hint": "级别只改选中段落的字号层级与段距，每次应用可撤销",
  /** 没有选中任何内容时的去处。 */
  "typography.level.empty": "先在大纲或纸面选中一条内容",
  "typography.level.count": "作用于 {count} 条",
  "typography.level.current": "当前：{level}",
  /** 反推结果：对象上没有任何级别覆盖。 */
  "typography.level.currentInherit": "跟随模板",
  /** 反推结果：有级别属性但和任一固定级别都对不上（在对象面板手改过）。 */
  "typography.level.currentCustom": "自定义",
  /** 反推结果：多选的目标级别不一致。 */
  "typography.level.currentMixed": "多个级别",
  "typography.level.heading1": "一级标题",
  "typography.level.heading2": "二级标题",
  "typography.level.heading3": "三级标题",
  "typography.level.body": "正文",
  "typography.level.caption": "次要说明",
  /** 删掉级别管理的四项覆盖，回到跟随模板。 */
  "typography.level.restore": "恢复跟随模板",
  /** 应用成功提示（含对象数；Toast ≤20 字）。 */
  "typography.level.applied": "已设为「{level}」，共 {count} 条",
  "typography.level.restored": "已恢复 {count} 条为跟随模板",
} as const;

export default typography;
