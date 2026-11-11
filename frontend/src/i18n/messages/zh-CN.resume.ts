// SPDX-License-Identifier: Apache-2.0
/**
 * 简历详情/预览这一层的界面文案：详情弹窗（标题兜底、关联岗位链接行、错误提示）、
 * 底部动作条、版面诊断卡片、行距控件、生成弹窗里的「本次使用」摘要，以及事实来源面板、
 * 基本信息页签、未收录资料提示、AI 修改弹窗、字段级差异、列表排序提示与字号档位兜底。
 *
 * 与 `zh-CN.workbench.ts` 的分工：制作台外壳、左栏参数与「自动一页」的即时反馈仍在那边；
 * 这一层**已经在用**的 key 一律继续在原处取——`workbench.close.*`、`resume.preview.close.body`、
 * `resume.measure.hintTemplate`、`resume.detail.group-usage.*` 与 `common.action.cancel` /
 * `common.action.save` 都**不在本包重复定义**：重名会被 spread 静默覆盖，是最难发现的
 * 一类文案回退。
 *
 * key 前缀按区块分：`resume.detail.*`（详情弹窗）、`resume.footer.*`（底部动作条）、
 * `resume.diagnosis.*`（版面诊断）、`resume.lineHeight.*`（行距控件）、
 * `resume.evidence.*`（事实来源面板）、`resume.basicInfo.*`（基本信息页签）、
 * `resume.coverage.*`（未收录资料提示）、`resume.revise.*`（AI 修改弹窗）、
 * `resume.fieldDiff.*`（字段级差异）、`resume.sort.*`（列表排序提示）、
 * `resume.fontScale.*`（字号档位兜底）、
 * `resume.generate.groupSummary`（生成弹窗的组摘要；它的同族 `resume.generate.*` 仍在
 * `zh-CN.workbench.ts`，并入时不要重复定义）。
 */
const resume = {
  // ── 简历详情弹窗（ResumeDetailModal）────────────────────────────
  /** 记录还没取回来时的兜底标题（有记录时用记录自己的名字）。 */
  "resume.detail.titleFallback": "简历预览",
  /** 取详情/HTML 失败时的兜底错误（接口自己的报错优先）。 */
  "resume.detail.loadFailed": "加载失败",
  /** 换版式后重新排版失败（后端报错优先）。 */
  "resume.detail.relayoutFailed": "按新设置重新排版失败",
  /** 关联岗位链接行：跳到岗位列表。 */
  "resume.detail.link.job": "查看关联岗位",
  /** 关联岗位链接行：跳到该岗位的投递进度。 */
  "resume.detail.link.progress": "该岗位的投递进度",
  /** 关联岗位链接行：跳到该岗位的模拟面试。 */
  "resume.detail.link.interview": "模拟面试",

  // ── 详情顶部「诊断与说明」一行（ResumeDiagnosticsBar，问题 8）──────────
  /** 入口文案：版面诊断（弹出原诊断卡）。 */
  "resume.diagnostics.entry.diagnosis": "版面诊断",
  /** 入口文案：未收录资料条数（与 `resume.coverage.title` 同一件事的短标签）。 */
  "resume.diagnostics.entry.coverage": "未收录",
  /** 入口文案：内容来源说明条数。 */
  "resume.diagnostics.entry.evidence": "来源",
  /** 入口文案：生成说明。 */
  "resume.diagnostics.entry.rationale": "生成说明",
  /** 无障碍名：版面诊断入口（{label} 是"偏空 · 占用 81%"这类状态，没算出来时为空）。 */
  "resume.diagnostics.aria.diagnosis": "版面诊断详情：{label}",
  /** 无障碍名：未收录入口，必须带条数（视觉徽标读屏拿不到）。 */
  "resume.diagnostics.aria.coverage": "这些资料内容没有写进这份简历，共 {count} 条",
  /** 无障碍名：内容来源入口，必须带条数。 */
  "resume.diagnostics.aria.evidence": "内容来源说明，共 {count} 条",
  /** 无障碍名：生成说明入口。 */
  "resume.diagnostics.aria.rationale": "为什么是这样一份简历（生成说明）",

  // ── 制作台左栏的版面状态条（#24 24A，WorkbenchLayoutStatusBar）──────
  /**
   * 还没量到版面时那一行（首帧 / iframe 尚未排版完）。
   * 这几条挂在 `resume.*` 包里是因为它们与上面「版面诊断」是同一件事的两种形态：
   * 数字与句式的来源在 `components/resume/layoutStatusSummary.ts`，与诊断条共用。
   */
  "workbench.layoutStatus.measuring": "正在测量版面…",
  /** 放得下时的整行：占用率 + 需要几页 + 页数上限。 */
  "workbench.layoutStatus.summary": "占用 {percent}% · 需要 {pages} 页 / 上限 {limit} 页",
  /** 超出上限时多一段"超出几页"。 */
  "workbench.layoutStatus.summaryOverflow":
    "占用 {percent}% · 需要 {pages} 页 / 上限 {limit} 页 · 超出 {over} 页",
  /** 「不限篇幅」（page_limit = 0）时没有上限可比、也没有占用率可比，只报页数。 */
  "workbench.layoutStatus.summaryUnlimited": "需要 {pages} 页（篇幅不限）",
  /** 未保存标记：制作台按草稿量，预览卡按已保存的记录量，两边数字可能不同。 */
  "workbench.layoutStatus.unsaved": "未保存",
  /** 未保存标记的悬停说明：把"为什么两边数字不一样"说清楚，别让用户当成 bug。 */
  "workbench.layoutStatus.dirtyHint": "数字按当前未保存的改动测量；保存后与预览卡一致。",

  // ── 「结构」页签的未收录资料组（#24 24D，CoverageStructureGroup）──────
  /** 常驻说明：清单按**已保存**的版本统计，与中栏草稿无关。 */
  "workbench.coverage.savedHint":
    "按已保存的版本统计；「补进简历」会写回记录，请先保存制作台里的改动。",
  /** 「AI 补上这段」在制作台没有修订弹窗：如实指路，不假装能做。 */
  "workbench.coverage.reviseHint": "这类内容请在中间一栏对应板块里直接改写。",

  // ── 中栏字段的来源徽标（#24 24E，FactSourceBadge）────────────────────
  /**
   * 三档来源词：把后端的五种 `origin` 收成用户看得懂的三种。
   * `grounded` / `restored` = 来自资料库；`enhanced_kept` / `ai_rewrite` = AI 生成；
   * `user_added` = 用户手动补的。映射表在 `factAnnotationMeta.ts`，与色板同源。
   */
  "resume.factSource.profile": "资料库",
  "resume.factSource.ai": "AI 生成",
  "resume.factSource.manual": "手动",
  /** 读屏名：{source} 是上面三个来源词之一（徽标上的字很小，读屏必须说清含义）。 */
  "resume.factSource.aria": "内容来源：{source}，点开看来源原文",

  // ── 底部动作条（ResumeDetailFooter）────────────────────────────
  /** 打开「手动调整简历内容」弹窗；中栏有未保存内容时禁用。 */
  "resume.footer.edit": "手动调整",
  /** 打开 AI 修改 / 重新生成弹窗。 */
  "resume.footer.revise": "AI 修改 / 重新生成",
  /** 还没生成过岗位优化建议时的按钮文案。 */
  "resume.footer.suggestionsGenerate": "生成岗位优化建议",
  /** 已生成过：同一颗按钮变成「查看」。 */
  "resume.footer.suggestionsView": "查看岗位优化建议",
  /** 打开关联岗位详情；没有关联岗位时禁用。 */
  "resume.footer.openJob": "查看对应岗位",
  /** 打开求职助手。 */
  "resume.footer.assistant": "咨询求职助手",
  /** 打开质量检测（风险扫描 + ATS 检测同用一个面板）。 */
  "resume.footer.quality": "质量检测",
  /** 打开离线分享包。 */
  "resume.footer.share": "离线分享",
  /** 导出按钮上的琥珀点说明：{count} 条核对项还没展开看过（问题 8 的配套）。 */
  "resume.footer.exportPending": "还有 {count} 条内容待人工核对",

  // ── 版面诊断（ResumeLayoutDiagnosisCard）───────────────────────
  /** 面板标题。 */
  "resume.diagnosis.title": "版面诊断",
  /** 当前版面占用比例；{percent} 是 0~100 的整数。 */
  "resume.diagnosis.fill": "占用 {percent}%",
  /** 「自动一页」：诊断判定溢出、且有可试的候选版式时才出现。 */
  "resume.diagnosis.autofit": "自动一页",
  "resume.diagnosis.expand": "展开详情",
  "resume.diagnosis.collapse": "收起详情",
  /** 逐档试时的进度；{label} 是后端给出的这一档名字。 */
  "resume.diagnosis.fitting": "正在试第 {index}/{total} 档：{label}",
  /** 收到最紧仍放不下：必须如实说，并把用户指向下一条真正有用的建议。 */
  "resume.diagnosis.tightest":
    "排版参数已经收到最紧了，还是放不下。接下来只能精简内容或增加页数——上面「版面诊断」里列了具体怎么做。",
  /** 诊断接口不可用、但已经判定溢出时的兜底提示；{pages} 是页数上限。 */
  "resume.diagnosis.overflowNoAnalysis":
    "内容超出了 {pages} 页：字号按你设定的值渲染，超出的部分不会显示。暂时读不到详细诊断，可以稍后重试。",
  /** 页数还不到 3 页时给的下一条出路；{pages} 是加一页之后的页数。 */
  "resume.diagnosis.addPage": "增加到 {pages} 页",

  // ── 行距控件（LineHeightControl）───────────────────────────────
  /** 行首标签（双击 / 回车复位；它的 Tooltip 与读屏名见下面两条）。 */
  "resume.lineHeight.label": "行距",
  /** 行首标签的复位提示：原生 title 键盘用户拿不到，所以走 Tooltip。 */
  "resume.lineHeight.resetTooltip": "双击或按回车恢复默认行距",
  /** 行首标签的无障碍名（读屏拿不到 Tooltip）。 */
  "resume.lineHeight.resetLabel": "行距（双击或按回车恢复默认）",
  /** 滑杆的无障碍名。 */
  "resume.lineHeight.sliderLabel": "行距（拖动调整）",
  /** 减号按钮的无障碍名。 */
  "resume.lineHeight.decrease": "减小行距",
  /** 加号按钮的无障碍名。 */
  "resume.lineHeight.increase": "增大行距",

  // ── 生成弹窗的「本次使用」摘要（GenerationGroupSummary）─────────
  /** 整句：组名 + 参与板块数。全角括号属于句子本身，不能拆到 JSX 里（中英括号不同形）。 */
  "resume.generate.groupSummary": "{group}（{count} 个板块）",

  // ── 事实来源面板（EvidencePanel）────────────────────────────────
  /** 折叠面板标题：{count} 是这份简历的标注总数。 */
  "resume.evidence.title": "内容来源说明 · {count} 条",
  /** 面板说明：讲清内容来源与 AI 改写的展示口径。 */
  "resume.evidence.hint":
    '这些内容来自你的个人资料；AI 改写过的部分永远不显示为"已确认"，建议导出前过目。',
  /** 单条标注的原文依据；{fact} 是资料原文。 */
  "resume.evidence.basis": "依据：{fact}",
  /** 单条标注的个人边界；{boundary} 是用户写的边界说明。 */
  "resume.evidence.boundary": "个人边界：{boundary}",
  /** 来源 Tag：锚定到资料原文。 */
  "resume.evidence.origin.grounded": "资料原文",
  /** 来源 Tag：匹配失败后回填原文。 */
  "resume.evidence.origin.restored": "回填原文",
  /** 来源 Tag：AI 美化改写被保留。 */
  "resume.evidence.origin.enhancedKept": "AI 改写保留",
  /** 来源 Tag：AI 改写。 */
  "resume.evidence.origin.aiRewrite": "AI 改写",
  /** 来源 Tag：用户补充。 */
  "resume.evidence.origin.userAdded": "用户补充",

  // ── 简历微调 · 基本信息页签（ResumeBasicInfoTab）───────────────
  /** 城市字段的标签：比 `editor.field.city` 多"所在"，与手工建简历弹窗一致。 */
  "resume.basicInfo.city": "所在城市",
  /** GitHub 字段的占位符：示例里用户名那一段是中文。 */
  "resume.basicInfo.githubPlaceholder": "https://github.com/用户名",
  /** 从「我的资料」带入个人总结的按钮。 */
  "resume.basicInfo.fillSummary": "从我的资料填入个人总结",
  /** 按钮的悬停说明：说清会覆盖当前内容、可用撤销恢复。 */
  "resume.basicInfo.fillSummaryHint":
    "把「我的资料」里的个人总结写到这一栏（会覆盖当前内容，可再用撤销前的原文改回）",

  // ── 未写进简历的资料提示（ResumeCoverageNotes）─────────────────
  /** 提示块标题。 */
  "resume.coverage.title": "这些资料内容没有写进这份简历",
  /** 折叠头的条数徽标：{count} 是各分区 total 之和（不是 names 的条数）。 */
  "resume.coverage.summary": "共 {count} 条",
  /** 说明这是岗位导向筛选的正常结果，资料本身没有丢。 */
  "resume.coverage.intro":
    "这是岗位导向筛选的正常结果：与岗位关键词交集不足的内容不会进入生成，资料本身没有任何丢失。",
  /** 分组标题：{label} 是分区名（后端下发），{count} 是条数（5-A：`分区名 · N 条`）。 */
  "resume.coverage.sectionCount": "{label} · {count} 条",
  /** 单个资料名：引号口径与提示块正文一致（一条一行，见 CoverageItemRow）。 */
  "resume.coverage.item": "「{name}」",
  /** 多个资料名之间的分隔符（修订指令与旧版拼接文案共用）。 */
  "resume.coverage.itemSeparator": "、",
  /** 按分区补写的按钮（把指令交给修订弹窗）。 */
  "resume.coverage.revise": "AI 补上这段",
  /** 打开手动调整的按钮。 */
  "resume.coverage.openEditor": "打开手动调整",
  /** 5-A 原因名：与岗位关键词交集不足，没进候选资料。 */
  "resume.coverage.reason.filtered": "与岗位无关",
  /** 5-A 原因名：单栏目条数上限裁掉，不是不相关。 */
  "resume.coverage.reason.capacity": "超出名额",
  /** 5-A 原因名：进了候选，模型没采用。 */
  "resume.coverage.reason.model": "模型未采用",
  /** 5-A 原因名：三轴都不命中（旧记录或后端未说明），宁可不解释也不硬猜。 */
  "resume.coverage.reason.unknown": "未说明",
  /** 组头原因汇总里各原因之间的分隔符。 */
  "resume.coverage.reasonSeparator": " · ",
  /** 组头里单个原因 + 条数：{label} 是原因名，{count} 是条数。 */
  "resume.coverage.reasonCount": "{label} {count}",
  /** 展开该组剩余条目的按钮：{count} 是该组总条数。 */
  "resume.coverage.expandAll": "展开全部 {count} 条",
  /** 收起回到默认的前 5 条。 */
  "resume.coverage.collapse": "收起",
  /** 3-A：把资料条目确定性补进简历（不调模型）。 */
  "resume.coverage.append": "补进简历",
  /** 3-A：需要新增条目/分区的分区只能去制作台手动添加。 */
  "resume.coverage.goWorkbench": "去制作台添加",
  /** 3-A：「去制作台添加」的悬停说明（说清 AI 修订的能力边界）。 */
  "resume.coverage.goWorkbenchHint": "AI 修改只能改写已有内容，不能新增条目",
  /** 补入成功的 Toast：{count} 是实际写进正文的条数。 */
  "resume.coverage.appended": "已补入 {count} 条",
  /** 有重复条目被跳过时的提示：{count} 是已在正文里的条数。 */
  "resume.coverage.skipped": "已存在 {count} 条，未重复添加",
  /** 补入失败的兜底文案（后端报错优先）。 */
  "resume.coverage.appendFailed": "补入失败，请稍后重试",

  // ── AI 修改简历弹窗（ResumeReviseModal）────────────────────────
  /** 弹窗标题。 */
  "resume.revise.title": "AI 修改简历",
  /** 主按钮：填了修改要求。 */
  "resume.revise.okTargeted": "按要求修改",
  /** 主按钮：没填要求，整体重写。 */
  "resume.revise.okFull": "整体重新生成",
  /** 填了要求时的说明：只改明确提出的部分。 */
  "resume.revise.hintTargeted": "AI 只会修改你明确提出的内容，其余部分逐字保留。",
  /** 没填要求时的说明：整体重写但事实不变。 */
  "resume.revise.hintFull":
    "没有填写修改要求时，AI 会整体重新生成：事实与经历保持不变，表达与结构重新组织。",
  /** 输入框占位符：{max} 是字数上限。 */
  "resume.revise.placeholder":
    "可选。例：把个人总结改得更突出数据分析能力；项目经历里补充量化结果。留空则整体重新生成。最多 {max} 字。",
  /** 按需修改成功的 Toast。 */
  "resume.revise.successTargeted": "已按你的要求修改简历",
  /** 整体重写成功的 Toast。 */
  "resume.revise.successFull": "已重新生成简历内容",
  /** 修订失败的兜底（后端报错优先）。 */
  "resume.revise.failed": "修订简历失败，请稍后重试",
  /** 模型没有执行这条要求时的标题（正文一个字都没改）。 */
  "resume.revise.notAppliedTitle": "这条要求没有被执行",
  /** 逐条列出被事实锁挡下的字段。 */
  "resume.revise.notAppliedFields": "涉及的事实字段：",
  /** 单条被挡下的字段：{label} 是字段名，{value} 是当前值。 */
  "resume.revise.blockedField": "{label}：{value}",
  /** 没执行时的下一步。 */
  "resume.revise.notAppliedAction":
    "改写表达的要求可以直接重试；要改事实，先在事实锁里解锁对应字段",

  // ── 版本对比的字段级差异（resumeFieldDiff）─────────────────────
  /** 照片字段的占位：不把 base64 展示给用户。 */
  "resume.fieldDiff.photoPlaceholder": "[图片]",
  /** 列表条目的一行：{label} 是字段名，{value} 是值或已拼好的列表。 */
  "resume.fieldDiff.line": "{label}：{value}",
  /** 列表值之间的分隔符。 */
  "resume.fieldDiff.listSeparator": "、",

  // ── 简历列表排序（resumeSort）──────────────────────────────────
  /** 「恢复默认排序」按钮在默认态下的悬停说明。 */
  "resume.sort.resetHintDefault": "当前已是默认排序：最近修改在前",
  /** 已改过排序时的悬停说明：说清点了会发生什么。 */
  "resume.sort.resetHint": "恢复默认排序：最近修改在前",

  // ── 字号档位兜底（resumeFontScale）─────────────────────────────
  /** 后端目录缺 base_px 时，内置最小档的名字。 */
  "resume.fontScale.small": "小字号",
  /** 内置标准档的名字。 */
  "resume.fontScale.standard": "标准字号",
  /** 内置最大档的名字。 */
  "resume.fontScale.large": "大字号",
} as const;

export default resume;
