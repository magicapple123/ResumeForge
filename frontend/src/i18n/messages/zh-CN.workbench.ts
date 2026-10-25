// SPDX-License-Identifier: Apache-2.0
/**
 * 「简历制作台」这一批**新增**的界面文案。
 *
 * 为什么单独成文件：`messages/zh-CN.ts` 只剩几十行余量（单文件 500 行零豁免），而本轮
 * 一次要加四十来条。拆法保持"扁平点分 key、一个默认导出、`as const`"三件事不变——
 * `zh-CN.ts` 末尾 `...workbench` 展开合并，`MessageKey` 仍是`keyof` 合并后的字面量联合，
 * `t()` 调用点一行都不用改。
 *
 * ## 边界
 *
 * - **只放本次新增的 key**，既有 key 一律不动（`zh-CN.ts` 里已有的 `resume.measure.hint*`
 *   之类继续在原处，本文件不重复定义——重复定义会被 spread 静默覆盖，是最难发现的一类
 *   文案回退）。
 * - 新增文案的长度与语气按 `docs/ui-copy-guide.md`：标题 ≤7 字、正文 ≤30 字、Toast ≤20 字，
 *   不用感叹号与句号；按钮写具体动作（不写「确定」）。
 * - 弹窗标题与按钮名都是**简历制作台**（5 字）。禁用「工作台」三字——那是 `/skills`
 *   页面的名字，两者混写会让用户以为在说同一处。
 */

const workbench = {
  // ── 外壳：标题、三栏、动作 ─────────────────────────────────
  /** 按钮文案 + 弹窗标题（两处必须逐字一致，测试断言的是同一个词）。 */
  "workbench.title": "简历制作台",
  /** 中栏底部主按钮：显式保存（不是即时保存）。 */
  "workbench.action.save-content": "保存内容",
  /** 中栏底部次按钮：放弃这次未保存的修改。 */
  "workbench.action.discard-edits": "放弃修改",
  /** 中栏顶部状态条：后端正在按新参数重排。 */
  "workbench.status.relayouting": "正在按新设置重新排版…",
  /** 中栏顶部状态条：有未保存的改动。 */
  "workbench.status.unsaved": "内容还没保存",
  /** 窄屏（<1000px）提示：中栏不渲染，内容编辑回到弹窗。只在窄屏媒体查询里显示。 */
  "workbench.narrow.editor": "内容编辑已收进上方「编辑内容」",
  /** 中栏有未保存内容时，底部「手动调整」被禁用并说明原因（两个编辑器同时开会在草稿上打架）。 */
  "workbench.editor.blocked": "内容栏还有没保存的改动，先保存或放弃",

  // ── 画布 ───────────────────────────────────────────────────
  /** 画布上方浮动工具条的说明：分页虚线与页数口径。 */
  "workbench.note.canvas": "按原始尺寸显示，虚线是分页位置（与当前 {pages} 页的设置一致）",
  /** 画布工具条第二句：缩放怎么用（工具条本身不放缩放按钮，见设计 Q4）。 */
  "workbench.note.zoom": "缩放用「放大预览」「缩小预览」两个按钮，也可以按住 Ctrl 滚滚轮",

  // ── 左栏分组标题 ───────────────────────────────────────────
  /** 第一组：模板与版式（L1 / L2，既有控件）。 */
  "workbench.group.layout": "模板与版式",
  /** 第二组：排版参数（L3，既有 `ResumeMeasureControls`）。 */
  "workbench.group.measure": "排版参数",
  /** 第三组：层次与间距（L3 新增 4 项）。 */
  "workbench.group.spacing": "层次与间距",
  /** 第四组：外观（颜色 4 项）。 */
  "workbench.group.appearance": "外观",

  // ── 三个新系数的名字 ───────────────────────────────────────
  /** `name_scale`：姓名是唯一"字号只属于它自己"的元素。 */
  "workbench.param.name-scale": "姓名大小",
  /** `section_title_scale`：7–8 个区块标题各占一行，缩 10% 累计能省近半行。 */
  "workbench.param.section-title-scale": "小节标题大小",
  /** `entry_gap`：同一区块内条目之间的距离（`section_gap` 管区块之间）。 */
  "workbench.param.entry-gap": "条目间距",
  /** `section_gap`：两个区块之间的距离。标签优先取目录 `format_fields` 的同名字段，
   *  这里只是旧后端没下发时的回落（不能是空串，否则那一行的行首会空白）。 */
  "workbench.param.section-gap": "区块间距",

  // ── 参数项的通用交互文案（用 {label} 插值，避免每个参数各写三条）──
  /** 行首标签的双击/回车提示。 */
  "workbench.param.reset": "双击或按回车恢复默认",
  /** 行首标签的无障碍名（把"可双击"这条唯一可发现性说清）。 */
  "workbench.param.resetLabel": "{label}（双击或按回车恢复默认）",
  /** 滑杆的无障碍名。 */
  "workbench.param.sliderAria": "{label}（拖动调整，方向键微调）",
  /** 减号按钮的无障碍名。 */
  "workbench.param.decreaseAria": "减少{label}",
  /** 加号按钮的无障碍名。 */
  "workbench.param.increaseAria": "增加{label}",
  /** 颜色项的取色按钮无障碍名。 */
  "workbench.param.colorAria": "选择{label}",

  // ── 预设色板（避免用户从零调色）────────────────────────────
  /** 色板的区域名（读屏用）。 */
  "workbench.color.palette": "预设色板",
  "workbench.color.black": "黑",
  "workbench.color.graphite": "深灰",
  "workbench.color.navy": "深蓝",
  "workbench.color.forest": "墨绿",
  "workbench.color.wine": "暗红",

  // ── 编辑器（中栏与弹窗共用）────────────────────────────────
  /** 中栏标题。 */
  "workbench.column.editor": "简历内容",
  /** 三栏分隔条的无障碍名（参数栏那一侧）：拖动改宽，方向键微调。 */
  "workbench.resizer.params": "参数栏宽度（拖动或方向键调整，双击复位）",
  /** 三栏分隔条的无障碍名（内容栏那一侧）。 */
  "workbench.resizer.editor": "内容栏宽度（拖动或方向键调整，双击复位）",
  /** 动作条上的「一键恢复默认列宽」（参数栏 + 内容栏一起复位）。 */
  "workbench.widths.reset": "恢复默认列宽",
  /** 左栏页签条的读屏区域名（role=tablist）。 */
  "workbench.leftTabs.label": "制作台左栏面板",
  /** 自绘栏目条右侧三角按钮的无障碍名（纯图标，没有可见文字）。 */
  "workbench.tabs.more": "更多栏目",
  /** 栏目条的读屏区域名（`role="tablist"`）。 */
  "workbench.tabs.label": "简历内容栏目",
  /** 制作台顶部动作条：保存这次未保存的修改（与中栏底部「保存内容」同一件事）。 */
  "workbench.action.save-changes": "保存修改",
  /** 制作台顶部动作条：放弃这次未保存的修改（会先内联确认一次）。 */
  "workbench.action.cancel-changes": "取消修改",
  /**
   * 顶部动作条的另一种「保存」（0051）：这份记录还是**草稿**，内容与版式都没改过。
   *
   * 不能沿用「保存修改」——一个字都没改却出现"保存修改"，用户会以为按钮坏了；
   * 而这次点击真正做的事是"让这份简历出现在简历中心"。
   */
  "workbench.action.publish": "保存到简历中心",
  /** 草稿态下标题旁的浅色提示：说清"现在还看不见它"。 */
  "workbench.draft.hint": "未保存，保存后才会出现在简历中心",

  // ── 编辑器的 8 个标签页（与弹窗逐字一致）───────────────────
  "editor.tab.basic": "基本信息",
  "editor.tab.education": "教育",
  "editor.tab.experience": "实习/工作",
  "editor.tab.campus": "校园经历",
  "editor.tab.projects": "项目",
  "editor.tab.skills": "技能",
  "editor.tab.awards": "荣誉",
  "editor.tab.writing": "写作增强",
  /** 保存失败（与既有文案逐字一致，测试按同一句话断言）。 */
  "editor.save.failed": "保存简历修改失败，请重试",
  /** 「填入我的资料全部数据」成功的 Toast。 */
  "editor.fillAll.applied": "已填入「我的资料」的内容",
  /** 窄屏下岗位参考栏折成折叠块的标题（弹窗形态才有）。 */
  "editor.reference.toggle": "查看岗位要求",

  // ── 字号控件（从 `ResumeMeasureControls` 迁出后仍需同一批文案）──
  "resume.measure.fontSize": "字号",
  "resume.measure.fontSizeReset": "双击或按回车恢复默认字号",
  "resume.measure.fontSizeResetLabel": "字号（双击或按回车恢复默认）",
  "resume.measure.fontSizeDecrease": "缩小字号",
  "resume.measure.fontSizeIncrease": "放大字号",
  "resume.measure.fontSizeSliderAria": "字号（拖动调整，方向键微调）",
  /** 字号过小的打印提示：`{px}` 是最小安全字号。 */
  "resume.measure.fontTooSmall": "小于 {px}px 打印可能看不清",
  /** 「字体」这一行的标签（`ResumeFontControl` 的自有文案不动）。 */
  "resume.measure.fontLabel": "字体",

  // ── 草稿差异（「上次没提交的内容」展开区）──────────────────────
  /** 草稿条上的入口：展开/收起差异清单。 */
  "draft.diff.show": "查看差异",
  "draft.diff.hide": "收起差异",
  /** 差异行里两侧的标签。 */
  "draft.diff.before": "当前",
  "draft.diff.after": "上次未提交",
  /** 有草稿、但展开后没有任何差异行时的说明（差异字段不在 diff 覆盖范围也算"一致"）。 */
  "draft.diff.same": "草稿与当前内容一致",
  /** 标量字段为空时的占位符（两列都要写，否则一行会看起来"什么都没有"）。 */
  "workbench.draftDiff.empty": "（空）",
  /** 列表字段没有任何增减/修改时的一侧文案。 */
  "workbench.draftDiff.none": "无",
  /** 列表字段：只在这一侧存在的条目数。 */
  "workbench.draftDiff.onlyHere": "独有 {count} 条",
  /** 列表字段：草稿多了几条。 */
  "workbench.draftDiff.added": "新增 {count} 条",
  /** 列表字段：两边都有、但内容改过几条。 */
  "workbench.draftDiff.modified": "改动 {count} 条",

  // ── 精确预览的空白页 ─────────────────────────────────────
  // 精确预览不再补空白纸（2026-10-24 用户口径：多页时后面补出来的空白页要去掉），
  // 所以原来那条「第 N 页 · 空白（上限 M 页）」的标注文案一并下线。

  /** 新建简历弹窗 footer 上的入口：先建一份空白简历，再去制作台排版。 */
  "workbench.action.open-from-new": "前往简历制作台",

  // ── 预览 · 草稿模式编辑（点纸面字段直接定位输入框）────────────
  /** 工具栏复选框的文案（勾了就点纸面跳输入框）。 */
  "preview.clickToEdit.label": "草稿模式编辑",
  /** 精确模式下不可用时的原因（复选框被禁用，靠 Tooltip 解释）。 */
  "preview.clickToEdit.exact": "精确预览是一张 PDF，纸面上没有可点的字段；切回草稿才能点",
  /** 草稿模式下勾选后的用法提示。 */
  "preview.clickToEdit.hint": "勾选后，点纸面上的文字就能跳到对应的输入框",

  // ── 制作台顶部动作条（整体保存 / 取消）─────────────────────────
  /** 「取消修改」的确认句：必须说清排版参数也会一起回滚，否则用户以为只丢内容。 */
  "workbench.actionbar.discard.body": "内容与排版参数都会回到打开制作台时的样子",
  /** 「关闭制作台」（Esc / × / 遮罩）的确认句：内容与版式都还没保存。 */
  "workbench.actionbar.discard.close-body": "内容与排版参数都还没保存，关掉制作台会一并丢掉",
  /** 同一处，但**只改了版式**：必须点名排版参数，否则用户以为关掉不会丢东西。 */
  "workbench.actionbar.discard.close-layout": "排版参数还没保存，关掉制作台会一并丢掉",

  // ── 关闭前的确认卡片（2026-10-24）────────────────────────────
  //
  // 制作台与简历预览都把 × 换成"自绘按钮 + `Popconfirm`"，Esc / 遮罩走同一条判断：
  // 有未保存的改动才问，干净就直接关。标题与确认按钮两个弹窗共用，描述按"丢的是什么"
  // 分开——只说"没保存"会让用户猜不出到底丢内容还是丢排版。
  /** 两张卡片的标题：说的是状态，不是"要删什么"（用户此刻只想关掉）。 */
  "workbench.close.title": "还有未保存的修改",
  /** 确认按钮：动作 + 后果一步到位（`common.action.discard` 只说"放弃修改"，没说会关）。 */
  "workbench.close.confirm": "放弃并关闭",
  /** 只有**内容**脏（排版没动过）。 */
  "workbench.close.body-content": "内容还没保存，关掉就丢了",
  /** 简历预览弹窗：那一层唯一会脏的东西就是排版设置。 */
  "resume.preview.close.body": "排版设置还没保存，关掉会一并丢掉",
  /** 制作台草稿且什么都没改就关：丢的不是"修改"，是这份简历本身（它还没进过简历中心）。 */
  "workbench.close.body-draft": "这份简历还没保存，关掉就不会出现在简历中心",

  // ── 「自动一页」的两句即时反馈（2026-10-24）────────────────────
  /** 保存成功：不许写死"已收进一页"——重排之后才知道到底进没进。 */
  "workbench.autofit.applied": "已按「{label}」收紧，如果仍超出会继续提示",
  /** 预览还没量出高度（`measureWithProbe` 返回 null）：说清下一步，不要静默什么都不做。 */
  "workbench.autofit.no-measure": "版面还在排版，稍等一下再点「自动一页」",
  /** 重新诊断失败：这一次不收紧，也不落库（宁可不动，也不存一套没量过的参数）。 */
  "workbench.autofit.analyze-failed": "没拿到这一版的排版结论，请稍后再试",
  /** 收紧方案落库失败（`PATCH /layout` 没成）。 */
  "workbench.autofit.save-failed": "保存排版设置失败，请重试",
  /** 「保存到简历中心」成功：成功提示必须含对象（去了哪）。 */
  "workbench.draft.published": "已保存到简历中心",
  /** 同一条路失败：说清动作与去处，别让用户以为"什么都没发生"。 */
  "workbench.draft.publish-failed": "保存到简历中心失败，请重试",

  // ── F4 投影消费：新建来源面板 / 资料候选 / 编辑器新栏目（2026-10-25）──
  // 全部来自当前组投影（投影消费 DTO），不提供选组器；「去切换组」跳资料页。
  "editor.sources.title": "资料来源",
  "editor.sources.hint": "只显示当前组参与的大字段",
  "editor.sources.switch": "去切换组",
  "editor.sources.append": "追加本分区",
  "editor.sources.appended": "本分区已全部加入",
  "editor.sources.fill-basic": "带入基本信息",
  "editor.sources.fill-summary": "带入个人总结",
  "editor.sources.material-only": "仅素材",
  "editor.sources.custom": "自建栏目",
  "editor.sources.custom-hint": "在「自定义栏目」页签里编辑",
  "editor.sources.languages-hint": "语言按规则写入技能",
  "editor.sources.singleton": "单条",
  "editor.sources.entry-count": "{count} 条",
  "editor.sources.empty": "当前组还没有参与的大字段",
  "editor.tab.credentials": "证书资质",
  "editor.tab.custom-sections": "自定义栏目",
  "resume.manual.loading": "正在读取当前组资料…",
  "resume.manual.snapshot-stale": "资料已更新，请重新打开新建面板",
  "resume.manual.load-failed": "读取当前组资料失败",
  "resume.manual.retry": "重新读取",
  "resume.manual.close": "关闭",
  "resume.generate.group-title": "本次使用",
  "resume.generate.group-members": "{count} 个大字段",
  "resume.generate.group-failed": "当前组信息读取失败",
  "resume.generate.group-retry": "重试",
  "resume.generate.switch-group": "去切换组",
  // 简历详情「本次使用」追溯（R-33）：组已删除仍显示快照；资料/定义变了提示需重新生成。
  "resume.detail.group-usage.deleted": "组已删除",
  "resume.detail.group-usage.deleted-hint": "该组已删除；以下信息来自这份简历保存时的快照",
  "resume.detail.group-usage.stale-title": "资料或组定义已更新",
  "resume.detail.group-usage.stale-body": "已保存简历不会自动变化，需重新生成才会体现在纸面上",
  "editor.credentials.name-required": "请填写证照名称",
  "editor.custom-sections.empty": "还没有自建栏目",
  "editor.custom-sections.add-entry": "添加条目",
  "editor.custom-sections.remove-entry": "删除这个条目",
  "editor.custom-sections.add-line": "添加标签行",
  "editor.custom-sections.remove-line": "删除这一行",
  "editor.custom-sections.remove-section": "删除这个栏目",
  "editor.custom-sections.text": "主文本",
  "editor.custom-sections.lines": "标签行",
  "editor.custom-sections.label": "标签",
  "editor.custom-sections.value": "值",

  // ── F9（R1）：新建简历与"我的资料"当前组同步（2026-10-26）────────────
  // 初始内容 = 当前组投影内容（两种模式一致）；页签按当前组参与清单过滤；打开期间
  // 资料被别的窗口改掉时，未编辑自动重同步、已编辑给内联提示二选一。
  /** 新建简历弹窗标题：岗位模式带岗位名插值。 */
  "resume.manual.title.job": "自行编写「{title}」简历",
  "resume.manual.title.general": "从头编写通用简历",
  /** 编辑器说明行：已按当前组预填 + 可改 + 改动不回写资料（三件事都要说清）。 */
  "resume.manual.description.job": "已按当前组资料预填；可照岗位要求修改，改动不会写回我的资料",
  "resume.manual.description.general": "已按当前组资料预填；可在此基础上修改，改动不会写回我的资料",
  /** 简历名称输入框（留空由后端按「姓名-自定义简历-时间」命名）。 */
  "resume.manual.name.aria": "简历名称",
  "resume.manual.name.placeholder": "简历名称（留空自动命名）",
  /** 保存按钮（原「保存手写简历」）。 */
  "resume.manual.save": "保存手写简历",
  /** 保存成功的 Toast：成功提示必须含对象。 */
  "resume.manual.saved.job": "手写简历已保存到简历中心",
  "resume.manual.saved.general": "通用简历已保存，可在简历中心查看",
  /** 「前往简历制作台」在有未保存修改时禁用：那条入口用初始内容建草稿，会丢当前编辑。 */
  "resume.manual.workbench-blocked": "有未保存的修改，先保存再前往制作台",

  /** 资料刷新提示（表单上方内联 Alert，不开第二个弹层、不用 modal.confirm）。 */
  "editor.profile-refresh.title": "我的资料已更新",
  "editor.profile-refresh.body": "有未保存的修改，没有自动覆盖",
  "editor.profile-refresh.apply": "用最新资料覆盖",
  "editor.profile-refresh.keep": "保留当前编辑",
} as const;

export default workbench;
