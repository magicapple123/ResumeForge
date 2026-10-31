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

  // ── 五个段落角色 ───────────────────────────────────────────
  "typography.role.name": "姓名",
  "typography.role.section_title": "板块标题",
  "typography.role.entry_title": "条目标题",
  "typography.role.body": "正文",
  "typography.role.meta": "日期与元信息",
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
  /** 细调区的分组标题（合并后不再叫「这条的排版」）。 */
  "typography.object.more": "更多参数",
  /** 级别管得住的那四项去哪儿了：不写会让用户以为功能被删。 */
  "typography.object.levelHint": "字号、加粗、段前段后由上面的「文字级别」统一管理",

  // ── 条目排版的作用范围（Q12：整条 / 条目头 / 正文 / 灰字）──────────
  /** 段控标签。 */
  "typography.entryStyle.scope.label": "作用范围",
  "typography.entryStyle.scope.aria": "选择条目排版的作用范围",
  /** 四个范围名：与文字级别的同名范围刻意用不同措辞（这里是"条目排版"的入口）。 */
  "typography.entryStyle.scope.object": "整条",
  "typography.entryStyle.scope.entry_title": "条目头",
  "typography.entryStyle.scope.body": "正文",
  "typography.entryStyle.scope.meta": "灰字",
  /** 段控下方的一句范围说明：说清这次只动哪一块。 */
  "typography.entryStyle.scopeHint.object": "整条一起改：标题、正文、灰字都跟随",
  "typography.entryStyle.scopeHint.entry_title": "只改条目标题这一行",
  "typography.entryStyle.scopeHint.body": "只改正文与要点",
  "typography.entryStyle.scopeHint.meta": "只改时间、地点等灰字",
  /** 状态行：目标 + 范围，避免"当前：跟随模板"被误读成范围。 */
  "typography.entryStyle.status": "正在调整：{name} · 范围：{scope}",
  /** 来源胶囊：这个范围当前是"已调整"还是"跟随模板"。 */
  "typography.entryStyle.source.template": "跟随模板",
  "typography.entryStyle.source.object": "整条已调整",
  "typography.entryStyle.source.entry_title": "条目头已调整",
  "typography.entryStyle.source.body": "正文已调整",
  "typography.entryStyle.source.meta": "灰字已调整",
  /** 恢复按钮：只清当前作用范围的键（整条 → objects；子范围 → object_roles）。 */
  "typography.entryStyle.restore": "恢复「{scope}」跟随模板",
  /** 无关项说明（不是隐藏得莫名其妙）。 */
  "typography.entryStyle.noMeta": "这条没有日期或灰字字段，日期位置不适用",
  "typography.entryStyle.noBullets": "这条正文没有要点，项目符号不适用",

  // ── 格式刷（Q14：说清"复制的是什么"与"下一步做什么"）──────────
  "typography.painter.title": "格式刷",
  /** 格式刷区的一句话说明：只复制局部排版，不动正文。 */
  "typography.painter.hint": "把一条的局部排版复制到其它条目",
  /** 复制按钮：带上条目名，并说明可复制多少项（属性名由宿主拼进 copyProps）。 */
  "typography.painter.copy": "复制「{name}」的排版",
  /** 可复制项数与属性名（Q14：按钮下面一行，避免"点了才知道复制了什么"）。 */
  "typography.painter.copyProps": "可复制 {count} 项：{props}",
  /** 属性名之间的分隔符（放在语言包里，组件里不写中文标点）。 */
  "typography.painter.propSeparator": "、",
  /** 源对象没有局部调整时的禁用说明。 */
  "typography.painter.empty": "这条没有局部调整，先改一处",
  /** 已复制差异、等待目标时的状态说明。 */
  "typography.painter.armed": "已复制这条的排版，在上方选择目标条目",
  "typography.painter.apply": "应用到 {count} 条",
  "typography.painter.cancel": "退出格式刷",
  /** 把当前生效值固定成本条覆盖（显式第二动作；按钮在条目排版面板底部，与恢复成对）。 */
  "typography.painter.freeze": "固定这条的当前样式",
  /** 固定的代价：这是用户必须看见的语义变化（Q12 起按当前作用范围执行）。 */
  "typography.painter.freezeHint": "固定后这个范围不再随模板变化",
  /** 应用成功提示（含对象数）。 */
  "typography.painter.applied": "已应用到 {count} 条",
  /** 固定当前样式的成功提示（按作用范围执行）。 */
  "typography.painter.frozen": "已固定当前范围的样式",

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
  /** 作用范围（W3）：整个条目 = 既有行为；其余只作用于该字段/角色。 */
  "typography.level.scope.label": "作用范围",
  "typography.level.scope.aria": "选择文字级别的作用范围",
  "typography.level.scope.object": "整个条目",
  "typography.level.scope.entry_title": "条目标题",
  "typography.level.scope.body": "正文",
  /** Q13：与术语表统一为「元信息（灰字）」，不再叫「说明」。 */
  "typography.level.scope.meta": "元信息（灰字）",
  /** 段控下方的一句范围说明（Q13）：四个范围各一句，说清这次只动哪一块。 */
  "typography.level.scopeHint.object": "整条一起改：标题、正文、灰字都跟随",
  "typography.level.scopeHint.entry_title": "只改条目标题这一行",
  "typography.level.scopeHint.body": "只改正文与要点",
  "typography.level.scopeHint.meta": "只改时间、地点等灰字",
  /** 一句口径：级别作用在段落上，不是整份缩放，且可撤销。 */
  "typography.level.hint": "级别只改选中段落的字号层级与段距，每次应用可撤销",
  /** 没有选中任何内容时的去处。 */
  "typography.level.empty": "先在大纲或纸面选中一条内容",
  /** 状态行（Q13）：先说在改哪一条，再说级别；不再写"作用于 N 条"这种不指名的说法。 */
  "typography.level.status": "正在调整：{name}",
  "typography.level.statusMany": "{count} 条内容",
  "typography.level.current": "级别：{level}",
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
  // ── 条目字段排版（W4：承载区补充字段分行/位置可调）────────────
  /** 参数栏分组标题。 */
  "typography.fieldLayout.groupTitle": "条目字段排版",
  /** 分组说明：只说作用范围，不写操作步骤。 */
  "typography.fieldLayout.hint": "调整补充字段的列数与顺序，只影响所选分区",
  "typography.fieldLayout.sectionLabel": "分区",
  "typography.fieldLayout.columnsLabel": "每行字段数",
  "typography.fieldLayout.columns.1": "1 列",
  "typography.fieldLayout.columns.2": "2 列",
  "typography.fieldLayout.columns.3": "3 列",
  "typography.fieldLayout.alignLabel": "对齐方式",
  "typography.fieldLayout.align.equal": "等宽对齐",
  "typography.fieldLayout.align.flow": "按内容",
  "typography.fieldLayout.alignHint": "等宽对齐自动隐藏「·」分隔符，各行列对齐更整齐",
  "typography.fieldLayout.gapLabel": "列间距",
  /** 滑杆读数与气泡（{value} 是字号倍数，保留 1 位小数）。 */
  "typography.fieldLayout.gapValue": "{value}×",
  /** 列间距滑杆两侧的加减按钮（读屏标签：只有图标，没有可见文案）。 */
  "typography.fieldLayout.gapDecrease": "减小列间距",
  "typography.fieldLayout.gapIncrease": "增大列间距",
  /** 补充字段整体在正文之前 / 之后（七个承载分区都提供这个开关）。 */
  "typography.fieldLayout.metaPositionLabel": "短字段位置",
  "typography.fieldLayout.metaPosition.below": "正文后",
  "typography.fieldLayout.metaPosition.above": "正文前",
  "typography.fieldLayout.metaPositionAwardsSectionOnly": "奖项的短字段位置只按分区设置",
  "typography.fieldLayout.metaPositionHint": "置顶后补充字段排在要点/描述上面；长字段建议独占一行",
  "typography.fieldLayout.fieldsTitle": "字段顺序",
  /** 字段可见性：隐藏后不上纸面，但内容仍保留在正文里。 */
  "typography.fieldLayout.hideField": "隐藏{label}",
  "typography.fieldLayout.showField": "显示{label}",
  "typography.fieldLayout.hiddenHint": "隐藏的字段不上纸面，内容仍保留",
  "typography.fieldLayout.moveUp": "上移{label}",
  "typography.fieldLayout.moveDown": "下移{label}",
  "typography.fieldLayout.solo": "独占一行",
  "typography.fieldLayout.soloAria": "{label}独占一行",
  "typography.fieldLayout.reset": "恢复默认",
  /** 条目级：`entryLabel` 是下拉标题，`entryAll` = 分区级（整栏统一）。 */
  "typography.fieldLayout.entryLabel": "条目",
  "typography.fieldLayout.entryAll": "全部条目",
  /** 条目模式提示：{label} 是条目标题（学校 / 公司 / 项目名）。 */
  "typography.fieldLayout.entryEditing": "正在单独设置：{label}（未改的项继承分区默认）",
  "typography.fieldLayout.entryRestore": "恢复继承",
  /** 条目上移 / 下移（{label} 是条目标题）。与字段的上移 / 下移分开：改的是条目顺序。 */
  "typography.fieldLayout.entryMoveUp": "上移条目{label}",
  "typography.fieldLayout.entryMoveDown": "下移条目{label}",
  "typography.fieldLayout.entryNone": "该分区还没有可单独设置的条目",
  "typography.fieldLayout.summary": "当前：{columns} 列，{solo} 个字段独占一行",

  // ── 简历结构示例（制作台只读对照弹窗）──────────────────────────
  // 示意图里的文字也是给人看的，所以一并放进语言包：组件里不留中文字面量，
  // 切到英文界面时示例简历与图例一起换。
  /** 弹窗标题（也用作入口按钮文案，≤6 字）。 */
  "typography.structureExample.title": "简历结构示例",
  /** 顶部一句话：这是一张示意图，不是用户数据。 */
  "typography.structureExample.hint": "这是一张示例简历，只用于对照，不会改动你的简历",
  /** 示意图的无障碍名（纸内都是示意内容，读屏只需要这一句）。 */
  "typography.structureExample.paperAria": "简历结构示例示意图",
  /** 图例列表的无障碍名。 */
  "typography.structureExample.legendAria": "结构示例图例",
  /** 图例上方的操作提示：悬停或点击会高亮纸面对应位置。 */
  "typography.structureExample.legendHint": "悬停或点击图例，纸上会高亮对应位置",
  // 四边页边距在示意图边缘上的短标注。
  "typography.structureExample.margin.top": "上",
  "typography.structureExample.margin.right": "右",
  "typography.structureExample.margin.bottom": "下",
  "typography.structureExample.margin.left": "左",
  // 示意简历的内容：虚构样本，纸面上不出现任何真实资料。
  "typography.structureExample.sample.name": "林晓",
  "typography.structureExample.sample.contact": "138-0000-0000 · linxiao@example.com",
  "typography.structureExample.sample.photo": "照片",
  "typography.structureExample.sample.sectionExperience": "工作经历",
  "typography.structureExample.sample.company": "星河科技 · 后端工程师",
  "typography.structureExample.sample.dateExperience": "2022.03 – 至今",
  "typography.structureExample.sample.bullet1": "负责订单服务重构，接口耗时下降 40%",
  "typography.structureExample.sample.bullet2": "主导缓存治理，命中率提升到 95%",
  "typography.structureExample.sample.companySecond": "明州科技 · 前端工程师",
  "typography.structureExample.sample.dateSecond": "2019.07 – 2022.02",
  "typography.structureExample.sample.sectionEducation": "教育经历",
  "typography.structureExample.sample.school": "明州大学 · 计算机科学",
  "typography.structureExample.sample.dateEducation": "2018.09 – 2022.06",
  "typography.structureExample.sample.paragraph": "GPA 3.8 / 4.0，专业排名前 5%",
  "typography.structureExample.sample.courses": "主修课程：数据结构、操作系统、数据库系统",
  "typography.structureExample.sample.sectionSkills": "专业技能",
  "typography.structureExample.sample.skills": "后端开发 · 数据库 · 缓存 · 分布式系统",
  // 1..16 号标注：标题是「这一处是什么」，说明是「在左栏哪里调、影响什么」。
  // 引用左栏控件时与界面上的名字逐字一致，用户才能按图索骥。
  "typography.structureExample.item.1.title": "页边距",
  "typography.structureExample.item.1.desc":
    "纸面四边的留白；在左栏「排版参数」的「页边距」里调，可四边一起或分边调",
  "typography.structureExample.item.2.title": "照片大小",
  "typography.structureExample.item.2.desc":
    "页眉右侧的照片；在左栏「排版参数」的「照片」里拖滑杆改大小，没上传照片时不生效",
  "typography.structureExample.item.3.title": "字体与字号",
  "typography.structureExample.item.3.desc":
    "整份简历的字体和基准字号；在左栏「排版参数」里选「字体」、拖「字号」",
  "typography.structureExample.item.4.title": "板块标题",
  "typography.structureExample.item.4.desc":
    "如「工作经历」这样的标题；在左栏「局部排版」的「板块标题」里调字号与加粗",
  "typography.structureExample.item.5.title": "板块",
  "typography.structureExample.item.5.desc":
    "简历按板块分区；顺序在左栏「模板与版式」里调，是否新起一页在「分页」里设",
  "typography.structureExample.item.6.title": "条目",
  "typography.structureExample.item.6.desc": "板块里的每条记录；两条之间的距离用「条目间距」调",
  "typography.structureExample.item.7.title": "条目标题行",
  "typography.structureExample.item.7.desc":
    "标题在左、日期在右；在左栏「局部排版」的「日期位置」里改日期靠右还是紧跟标题",
  "typography.structureExample.item.8.title": "正文与要点",
  "typography.structureExample.item.8.desc":
    "条目标题下的描述与要点；在左栏「局部排版」的「正文」里调字号、加粗与对齐",
  "typography.structureExample.item.9.title": "项目符号",
  "typography.structureExample.item.9.desc":
    "要点前的圆点；在左栏「局部排版」的「正文」里切换「项目符号」：圆点、短横或不显示",
  "typography.structureExample.item.10.title": "行距",
  "typography.structureExample.item.10.desc":
    "正文行与行之间；整份简历在左栏「排版参数」的「行距」里调，也可按段落类型单独调",
  "typography.structureExample.item.11.title": "段前距与段后距",
  "typography.structureExample.item.11.desc":
    "段落上下的空白；在左栏「局部排版」里按段落类型调，套用「文字级别」也会改这两项",
  "typography.structureExample.item.12.title": "缩进",
  "typography.structureExample.item.12.desc":
    "正文左边往里缩多少；在左栏「局部排版」的「缩进」里调",
  "typography.structureExample.item.13.title": "对齐",
  "typography.structureExample.item.13.desc":
    "左对齐、居中、右对齐或两端对齐；在左栏「局部排版」的「对齐」里选",
  "typography.structureExample.item.14.title": "区块间距",
  "typography.structureExample.item.14.desc":
    "两个板块之间的空白；在左栏「层次与间距」的「区块间距」里调",
  "typography.structureExample.item.15.title": "条目间距",
  "typography.structureExample.item.15.desc":
    "两条记录之间的空白；在左栏「层次与间距」的「条目间距」里调",
  "typography.structureExample.item.16.title": "分页线",
  "typography.structureExample.item.16.desc":
    "一页纸的边界，内容装不下就从这里分页；页面四周的留白由「页边距」决定",
  // ── v2 局部排版工具容器（2026-10-30 第二批）──────────────────
  /** 选择列表标题：容器自己提供条目多选，不依赖结构面板。 */
  "typography.tools.selectionTitle": "选择条目",
  /** 多选控件的无障碍名。 */
  "typography.tools.selectionAria": "选择要批量调整的条目",
  "typography.tools.selectionPlaceholder": "选择条目后可批量调整",
  "typography.tools.selectionEmpty": "这份简历还没有条目",
  "typography.tools.focused": "当前条目：{name}",
  "typography.tools.noFocused": "先在纸面或结构面板点选一条内容",
  "typography.tools.targets": "格式刷目标：{count} 条",
  "typography.tools.targetsHint": "先在上方选择目标条目，再应用格式刷",
  "typography.tools.sectionObject": "条目排版",
  "typography.tools.sectionLevel": "文字级别",
  "typography.tools.sectionPainter": "格式刷",
  "typography.tools.sectionBatch": "批量调整",
  "typography.tools.sectionRole": "同类段落",
  "typography.tools.roleHint": "同类段落默认按条目正文继承",
} as const;

export default typography;
