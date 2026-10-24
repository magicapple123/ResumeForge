// SPDX-License-Identifier: Apache-2.0
/**
 * 「专业视图 / 检查 / 照片裁剪」这一批**新增**的界面文案（W15，fe-delivery）。
 *
 * 拆法与 `zh-CN.workbench.ts` 相同：扁平点分 key、一个默认导出、`as const`；
 * `zh-CN.ts` 末尾 `...proview` 展开合并，`MessageKey` 自动包含这些 key。
 *
 * ## 边界
 *
 * - **只放本批新增的 key**；既有 key 一律不重复定义（重复会被 spread 静默覆盖）。
 * - 长度与语气按 `docs/ui-copy-guide.md`：标题 ≤7 字、正文 ≤30 字、Toast ≤20 字，
 *   不用感叹号与句号；按钮写具体动作，不写「确定」。
 * - 「简历制作台」是既有正名（`zh-CN.workbench.ts`），本文件说「制作台」时指同一个东西；
 *   不引入「工作台」这个既有页面名。
 * - 辅助线/灰度校样/诊断都是**编辑器覆盖层**的文案：每一条都要么说明"只影响预览"，
 *   要么说明"不会改你的设置"，避免用户以为它改了导出。
 */

const proview = {
  // ── 画布工具条（专业视图）────────────────────────────────────
  /** 工具条这个区域的无障碍名。 */
  "proview.bar.label": "专业视图工具",
  /** 缩放方式分段控件的无障碍名（视觉上就是那三个选项）。 */
  "proview.zoom.label": "缩放方式",
  /** 整页：一页完整装进画布。 */
  "proview.zoom.page": "整页",
  /** 适宽：纸面按画布宽度放大（长文档横向铺满）。 */
  "proview.zoom.width": "适宽",
  /** 100%：逻辑像素 1:1。 */
  "proview.zoom.actual": "100%",
  /** 手动缩放后不再命中三个档位时的占位读数（不显示任何档位被选中）。 */
  "proview.zoom.custom": "自定义",
  /** 整页档的说明。 */
  "proview.zoom.pageHint": "让一页完整装进画布",
  /** 适宽档的说明。 */
  "proview.zoom.widthHint": "纸面按画布宽度铺满",
  /** 100% 档的说明。 */
  "proview.zoom.actualHint": "按逻辑像素 1:1 显示",
  /** 100% 的**必要**声明：屏幕尺寸受系统缩放影响，不能承诺物理尺寸。 */
  "proview.zoom.actualNote": "100% 为逻辑像素，实际大小受系统显示缩放影响",
  /** 放大按钮的无障碍名。 */
  "proview.zoom.in": "放大画布",
  /** 缩小按钮的无障碍名。 */
  "proview.zoom.out": "缩小画布",
  /** 当前缩放读数（百分比）。 */
  "proview.zoom.percent": "{value}%",

  // ── 页导航 ───────────────────────────────────────────────────
  /** 页导航区域的无障碍名。 */
  "proview.pageNav.label": "页导航",
  /** 上一页按钮。 */
  "proview.pageNav.prev": "上一页",
  /** 下一页按钮。 */
  "proview.pageNav.next": "下一页",
  /** 页码输入框的无障碍名（含总页数）。 */
  "proview.pageNav.inputAria": "输入页码，共 {total} 页",
  /** 当前页 / 总页数读法。 */
  "proview.pageNav.status": "第 {page} / {total} 页",
  /** 只有一页时隐藏翻页按钮，换成这句。 */
  "proview.pageNav.single": "只有一页",
  /** 页导航上「问题位置」标记的 Tooltip（W08 溢出定位传入）。 */
  "proview.pageNav.markerTip": "第 {page} 页有 {count} 项待处理",
  /** 键盘可达说明：焦点在工具条上时 PageUp / PageDown 翻页。 */
  "proview.pageNav.keyboardHint": "焦点在工具条时可用 PageUp / PageDown 翻页",

  // ── 辅助线（D05）────────────────────────────────────────────
  /** 辅助线开关按钮。 */
  "proview.guides.label": "辅助线",
  /** 页边距线。 */
  "proview.guides.margins": "页边距线",
  /** 列边界（分页列的中线）。 */
  "proview.guides.columns": "列边界",
  /** 基线。 */
  "proview.guides.baselines": "基线",
  /** 段落边界。 */
  "proview.guides.paragraphs": "段落边界",
  /** 全关时的读数。 */
  "proview.guides.off": "辅助线全关",
  /** 已开的条数（按钮上显示）。 */
  "proview.guides.count": "辅助线 {count} 项",
  /** **绝不导出**的说明（这是这条功能唯一的承诺，必须显眼）。 */
  "proview.guides.hint": "只在编辑画布显示，不会进入导出",
  /** 打开辅助线后纸面里那层覆盖层的无障碍名。 */
  "proview.guides.overlay": "版面辅助线",
  /** 辅助线图例：页边距线。 */
  "proview.guides.legend.margins": "页边距线",
  /** 辅助线图例：列边界。 */
  "proview.guides.legend.columns": "列边界",
  /** 辅助线图例：基线。 */
  "proview.guides.legend.baselines": "基线",
  /** 辅助线图例：段落边界。 */
  "proview.guides.legend.paragraphs": "段落边界",

  // ── 灰度校样与打印检查（D10）────────────────────────────────
  /** 灰度校样开关。 */
  "proview.proof.label": "灰度校样",
  /** 打开后的状态说明。 */
  "proview.proof.onHint": "按黑白打印效果显示，颜色设置不会被改动",
  /** 关闭时的说明。 */
  "proview.proof.offHint": "打开后按灰度显示纸面，只影响预览",
  /** 灰度校样覆盖层的无障碍名。 */
  "proview.proof.preview": "灰度校样预览",
  /** 打印检查按钮。 */
  "proview.diagnostics.label": "打印检查",
  /** 检查面板标题。 */
  "proview.diagnostics.title": "只读检查",
  /** 检查面板说明：不改用户设置、不自动改稿。 */
  "proview.diagnostics.hint": "实测纸面颜色与对比度，只提示风险，不改你的设置",
  /** 正文对比度偏低。 */
  "proview.diagnostics.textLow": "正文对比度 {ratio}:1，黑白打印可能发灰",
  /** 强调色对比度偏低。 */
  "proview.diagnostics.accentLow": "强调色对比度 {ratio}:1，灰度下可能难辨",
  /** 细线对比度偏低。 */
  "proview.diagnostics.lineLow": "细线对比度 {ratio}:1，打印后可能看不见",
  /** 全部通过。 */
  "proview.diagnostics.ok": "未发现明显对比度问题",
  /** 量不到纸面颜色（预览还没加载完）。 */
  "proview.diagnostics.unavailable": "暂时量不到纸面颜色，等预览加载后再试",
  /** 重新测量的按钮。 */
  "proview.diagnostics.refresh": "重新测量",
  /** 检查项的行内标签：正文。 */
  "proview.diagnostics.item.text": "正文",
  /** 检查项的行内标签：强调色。 */
  "proview.diagnostics.item.accent": "强调色",
  /** 检查项的行内标签：细线。 */
  "proview.diagnostics.item.line": "细线",
  /** 检查项的通过读数（对比度值）。 */
  "proview.diagnostics.item.ok": "对比度 {ratio}:1",

  // ── 命令面板（D13）──────────────────────────────────────────
  /** 动作条上打开命令面板的按钮。 */
  "proview.command.button": "命令",
  /** 按钮的无障碍名（{shortcut} 按用户当前键位实时格式化，不写死）。 */
  "proview.command.buttonAria": "打开命令面板，快捷键 {shortcut}",
  /** 面板标题（≤7 字）。 */
  "proview.command.title": "命令面板",
  /** 搜索框占位符。 */
  "proview.command.placeholder": "搜索操作",
  /** 无匹配结果。 */
  "proview.command.empty": "没有匹配的操作",
  /** 「最近使用」分组标题。 */
  "proview.command.recent": "最近使用",
  /** 「全部操作」分组标题。 */
  "proview.command.all": "全部操作",
  /** 键盘说明。 */
  "proview.command.hint": "方向键选择，回车执行，Esc 关闭",
  /** 没有最近使用记录。 */
  "proview.command.recentEmpty": "还没有用过命令",
  /** 命令行右端的快捷键列标题（视觉提示用，值由 formatShortcut 生成）。 */
  "proview.command.shortcutLabel": "快捷键",
  /** 打开命令面板这个动作在命令列表里的名字（与快捷键注册表 label 不同：这是面板文案）。 */
  "proview.command.open": "打开命令面板",
  /** 命令执行被禁用（暂时不可用）时的标注。 */
  "proview.command.unavailable": "暂不可用",
  /** 搜索框的无障碍名。 */
  "proview.command.searchAria": "搜索可用操作",

  // ── 工作区预设（D14）────────────────────────────────────────
  /** 工作区预设分段控件的无障碍名。 */
  "proview.workspace.label": "工作区预设",
  /** 全部面板（默认）。 */
  "proview.workspace.default": "全部面板",
  /** 内容撰写：只留内容栏与画布。 */
  "proview.workspace.writing": "内容撰写",
  /** 精细排版：只留参数栏与画布。 */
  "proview.workspace.typography": "精细排版",
  /** 投递检查：只看画布。 */
  "proview.workspace.delivery": "投递检查",
  /** 恢复默认布局的按钮。 */
  "proview.workspace.reset": "恢复默认布局",
  /** 预设切换后的 Toast（{name} 是预设名）。 */
  "proview.workspace.switched": "已切到{name}",
  /** 恢复默认后的 Toast。 */
  "proview.workspace.resetToast": "已恢复默认布局",
  /** 说明：只切面板可见性，不动文档。 */
  "proview.workspace.hint": "只切换面板可见性，文档内容不会变",
  /** 说明：选择会记住。 */
  "proview.workspace.persistHint": "选择会记住，下次打开继续用",

  // ── 照片裁剪（D09）──────────────────────────────────────────
  /** 打开裁剪弹窗的按钮。 */
  "proview.photo.button": "照片裁剪",
  /** 弹窗标题（5 字）。 */
  "proview.photo.title": "照片裁剪",
  /** 非破坏承诺。 */
  "proview.photo.hint": "原始照片不会被覆盖，随时可以恢复",
  /** 比例锁定控件标签。 */
  "proview.photo.aspect": "比例锁定",
  /** 原图比例。 */
  "proview.photo.aspect.original": "原图",
  /** 1:1。 */
  "proview.photo.aspect.square": "1:1",
  /** 3:4（证件照常见）。 */
  "proview.photo.aspect.portrait": "3:4",
  /** 4:3。 */
  "proview.photo.aspect.landscape": "4:5",
  /** 自由比例。 */
  /** 后端 aspect 只认 free / 1:1 / 3:4 / 4:5；"自由"即 free。 */
  "proview.photo.aspect.custom": "自由",
  /** 取景大小滑杆（缩放裁剪框）。 */
  "proview.photo.zoom": "取景大小",
  /** 取景大小滑杆的无障碍名。 */
  "proview.photo.zoomAria": "取景大小，拖动调整取景范围",
  /** 水平位置。 */
  "proview.photo.offsetX": "水平位置",
  /** 垂直位置。 */
  "proview.photo.offsetY": "垂直位置",
  /** 水平位置的无障碍名。 */
  "proview.photo.offsetXAria": "水平位置，方向键微调",
  /** 垂直位置的无障碍名。 */
  "proview.photo.offsetYAria": "垂直位置，方向键微调",
  /** 清晰度通过：裁剪后还剩多少像素。 */
  "proview.photo.clarity.ok": "裁剪后约 {width}×{height} 像素，清晰度够用",
  /** 清晰度不足。 */
  "proview.photo.clarity.warn": "裁剪后约 {width}×{height} 像素，打印可能发虚",
  /** 清晰度建议：纸面尺寸与推荐像素。 */
  "proview.photo.clarity.tip": "纸面上约 {mm} 毫米宽，建议至少 {width}×{height} 像素",
  /** 原图尺寸读数。 */
  "proview.photo.source": "原图 {width}×{height} 像素",
  /** 应用裁剪（主按钮）。 */
  "proview.photo.apply": "应用裁剪",
  /** 恢复原图（去掉裁剪参数）。 */
  "proview.photo.reset": "恢复原图",
  /** 移除照片（危险操作）。 */
  "proview.photo.remove": "移除照片",
  /** 移除确认卡标题。 */
  "proview.photo.removeTitle": "移除照片",
  /** 移除确认卡正文（说清后果与空位回收）。 */
  "proview.photo.removeBody": "照片会从这份简历删除，空位自动收回",
  /** 移除确认按钮（写具体动作，不写「确定」）。 */
  "proview.photo.removeConfirm": "移除照片",
  /** 裁剪参数保存后的 Toast。 */
  "proview.photo.saved": "裁剪参数已保存",
  /** 恢复原图后的 Toast。 */
  "proview.photo.cleared": "已恢复原图",
  /** 移除照片后的 Toast。 */
  "proview.photo.removed": "已移除照片",
  /** 没有照片时的说明。 */
  "proview.photo.noPhoto": "这份简历还没有照片",
  /** 浏览器不支持 object-view-box 的降级说明。 */
  "proview.photo.unsupported": "当前浏览器不支持实时裁剪预览，参数仍会保存",
  /** 裁剪预览的无障碍名。 */
  "proview.photo.previewAlt": "照片裁剪预览",
  /** 裁剪弹窗里那枚「上一张/原图」缩略图的说明。 */
  "proview.photo.previewLabel": "裁剪预览",
  /** 裁剪比例锁定后，拖动时保持比例的状态说明。 */
  "proview.photo.lockedHint": "比例已锁定，调整取景大小时不会变形",

  // ── 命令面板里的内置命令名（D13，与宿主动作一起参与搜索）──────
  /** 保存（宿主提供时出现）。 */
  "proview.cmd.save": "保存修改",
  /** 导出（宿主提供时出现）。 */
  "proview.cmd.export": "导出简历",
  /** 切模板（宿主提供时出现；具体打开哪个控件由宿主决定）。 */
  "proview.cmd.template": "打开模板与版式",
  /** 检查（W11 就绪后由宿主提供）。 */
  "proview.cmd.check": "检查简历",
  /** 撤销 / 重做（W03 就绪后由宿主提供）。 */
  "proview.cmd.undo": "撤销",
  "proview.cmd.redo": "重做",
  /** 整页显示。 */
  "proview.cmd.zoomPage": "整页显示",
  /** 按画布宽度显示。 */
  "proview.cmd.zoomWidth": "按宽度显示",
  /** 按 100% 逻辑像素显示。 */
  "proview.cmd.zoomActual": "按 100% 显示",
  /** 放大 / 缩小画布。 */
  "proview.cmd.zoomIn": "放大画布",
  "proview.cmd.zoomOut": "缩小画布",
  /** 一次开关全部辅助线。 */
  "proview.cmd.guides": "切换辅助线",
  /** 开关灰度校样。 */
  "proview.cmd.proof": "切换灰度校样",
  /** 上一页 / 下一页（画布）。 */
  "proview.cmd.prevPage": "上一页",
  "proview.cmd.nextPage": "下一页",
  /** 打开照片裁剪。 */
  "proview.cmd.photoCrop": "照片裁剪",
} as const;

export default proview;
