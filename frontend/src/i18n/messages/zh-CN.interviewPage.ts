// SPDX-License-Identifier: Apache-2.0
/**
 * 模拟面试页的三张卡：面试官设定、历史面试、评分报告。
 *
 * ## 枚举只翻显示名
 *
 * 面试类型 / 难度 / 面试官风格的取值是**提交给后端的协议值**（`types/interview.ts`
 * 的白名单，原样入库），一个字都没动；这里只放显示名，由 `SetupTab.tsx` 的
 * `Record<协议值, MessageKey>` 映射在渲染处 `t()`。历史列表的类型 / 难度 Tag 直接
 * 显示后端返回的值（那是数据，不是界面文案），不在本包里映射。
 *
 * ## 三条随参数变化的文案
 *
 * `history.roundsAuto` / `history.roundsProgress` 的 `{time}` 由调用方先用
 * `formatDateTime` 格式化好再传入，`{answered}` / `{total}` 是轮数；
 * `history.total` 是分页条上的「共 N 场」，`{count}` 是总条数。
 *
 * 「批量选择」沿用 `common.action.batchSelect`，本包不重复一条。
 */
const interviewPage = {
  /** 面试官头像的替代文本（设定卡与报告卡共用）。 */
  "interviewPage.avatarAlt": "面试官 Jane",
  /** 对话气泡里的面试官作者名：两种语言都写作 "Jane"（人名不翻译）。 */
  "interviewPage.interviewerName": "Jane",
  /** 对话气泡里的面试官作者名（界面文案，走语言包）。 */

  // ===== 历史面试卡 =====
  "interviewPage.history.cardTitle": "历史面试",
  "interviewPage.history.deleteOne": "删除这场面试",
  "interviewPage.history.deleteOneConfirm": "删除这场面试？删除后无法恢复。",
  "interviewPage.history.deleteSelected": "删除所选",
  "interviewPage.history.empty": "还没有做过模拟面试",
  "interviewPage.history.selectAria": "选择面试 {title}",
  "interviewPage.history.actionContinue": "继续",
  "interviewPage.history.actionViewReport": "看报告",
  "interviewPage.history.statusActive": "进行中",
  "interviewPage.history.statusFinished": "已结束",
  "interviewPage.history.roundsAuto": "{answered} 轮（自动收尾） · {time}",
  "interviewPage.history.roundsProgress": "第 {answered}/{total} 轮 · {time}",
  "interviewPage.history.total": "共 {count} 场",

  // ===== 评分报告卡 =====
  "interviewPage.report.cardTitle": "面试评分报告",
  "interviewPage.report.failedTitle": "报告没有生成成功",
  "interviewPage.report.failedBody": "可以在资料箱里找到这场面试的问答记录，重新体验一次也可以。",
  "interviewPage.report.score": "{score} 分",
  "interviewPage.report.strengths": "做得好的地方",
  "interviewPage.report.improvements": "下次可以改进",
  "interviewPage.report.saveToMaterial": "把这场面试存进资料箱",

  // ===== 面试计时器 / 准备好了 =====
  "interviewPage.timer.label": "面试用时",
  "interviewPage.thinkingFinishReport": "本场面试结束，正在生成报告…",
  "interviewPage.ready.title": "Jane 已就位，准备好了吗？",
  "interviewPage.ready.body":
    "准备好后我们再开始：计时从你点下按钮开始，中途离开会自动暂停，回来点一下就接着走。",
  "interviewPage.ready.start": "准备好了",
  "interviewPage.ready.resume": "继续面试",
  "interviewPage.ready.hint": "计时从你点下按钮开始，结束时报告里会带上这场面试的用时。",

  // ===== 面试官设定卡 =====
  "interviewPage.setup.title": "面试官设定",
  "interviewPage.setup.greeting": "你好，我是 Jane，今天由我来面试你。",
  "interviewPage.setup.jobLabel": "岗位材料",
  "interviewPage.setup.jobPlaceholder": "选中后按该岗位的 JD 提问（输入关键词搜索）",
  "interviewPage.setup.jobRequired": "请选择关联岗位",
  "interviewPage.setup.resumeLabel": "简历材料",
  "interviewPage.setup.resumePlaceholder": "该岗位关联的简历与通用简历（输入关键词搜索）",
  "interviewPage.setup.resumePlaceholderNoJob": "先选关联岗位，再来挑简历",
  "interviewPage.setup.resumeRequired": "请选择关联简历",
  "interviewPage.setup.scopeHint": "面试官只会看到你选定的这两份材料，其它资料不会进入面试。",
  "interviewPage.setup.typeLabel": "面试类型",
  "interviewPage.setup.difficultyLabel": "难度",
  "interviewPage.setup.styleLabel": "面试官风格",
  "interviewPage.setup.styleExtraIgnored": "已填写自定义人设，此项不生效。",
  "interviewPage.setup.roundsLabel": "轮数",
  "interviewPage.setup.roundsAuto": "自动",
  "interviewPage.setup.roundsModeCustom": "指定轮数",
  "interviewPage.setup.roundsOption": "{round} 轮",
  "interviewPage.setup.roundsUnit": "轮",
  "interviewPage.setup.roundsRequired": "轮数需在 3–12 之间",
  "interviewPage.setup.roundsExtra":
    "「自动」由面试官按你的表现决定何时收尾；「指定轮数」由你定 3–12 轮。",
  "interviewPage.setup.focusLabel": "考察重点（选填）",
  "interviewPage.setup.focusExtra": "例如：用户增长、跨部门协作、成本控制",
  "interviewPage.setup.focusPlaceholder": "留空则按面试类型通用考察",
  "interviewPage.setup.personaLabel": "自定义人设（选填）",
  /** 人设标签行右侧的辅助说明（第 2 条）：与人设并列后方位词失效，只说"覆盖"。 */
  "interviewPage.setup.personaOverrideHint": "填写后覆盖风格设定",
  "interviewPage.setup.personaExtra":
    "例如：某公司业务负责人，喜欢追问具体数字与落地过程。填写后覆盖面试官风格。",
  "interviewPage.setup.start": "开始面试",
  "interviewPage.setup.confidenceTip":
    "面试官会基于你的资料与岗位要求提问，回答越具体（做了什么、结果是什么）点评越有用。",

  // ===== 材料来源（#41）：每侧都是"从记录选 / 导入文件"二选一 =====
  "interviewPage.setup.material.sourceLabel": "材料来源",
  "interviewPage.setup.material.fromRecord": "从记录选",
  "interviewPage.setup.material.fromFile": "导入文件",
  // 两侧共用一句（问题 6）：类型与侧别无关，说明清楚"图片要走识别"这件事本身。
  "interviewPage.setup.material.fileHint":
    "支持图片 / PDF / TXT / Word / Markdown；图片会走文字识别，文本类文件更快更准",
  "interviewPage.setup.material.legacyDoc": "Word 2003 的 .doc 读不了，另存为 .docx 再导入",
  "interviewPage.setup.material.pickFile": "选择文件",
  "interviewPage.setup.material.repickFile": "换一份",
  "interviewPage.setup.material.parsing": "正在读取文件…",
  "interviewPage.setup.material.parsed": "已读取 {chars} 字",
  "interviewPage.setup.material.recognized": "已从截图识别出 {chars} 字",
  "interviewPage.setup.material.clear": "移除这份文件",
  "interviewPage.setup.material.jobRequired": "岗位材料二选一：从记录选一条，或导入 JD 文件",
  "interviewPage.setup.material.resumeRequired": "简历材料二选一：从记录选一份，或导入简历文件",
  "interviewPage.setup.material.parseFailed": "这份文件没能读取",
  "interviewPage.setup.material.emptyFile": "这份文件是空的，换一份再试",
  "interviewPage.setup.material.tooLarge": "文件超过 10 MB，无法导入",
  "interviewPage.setup.material.unsupported": "不支持的文件格式",
  "interviewPage.setup.material.warningTitle": "这份材料有需要注意的地方",

  // ===== 结束后的追问（#41）：不占正式轮次 =====
  "interviewPage.followUp.cardTitle": "继续追问",
  "interviewPage.followUp.hint": "追问不占正式轮次，也不计入评分报告",
  "interviewPage.followUp.placeholder": "比如：第二题我答漏了什么？",
  "interviewPage.followUp.submit": "发送追问",
  "interviewPage.followUp.empty": "还没有追问。哪道题没想通、哪里有扣分，都可以直接问。",
  "interviewPage.followUp.thinking": "面试官正在回答…",
  "interviewPage.followUp.failed": "这次追问没有答上来",
  "interviewPage.followUp.role.user": "你",
  "interviewPage.followUp.stop": "停止追问",
  "interviewPage.followUp.resume": "继续追问",
  "interviewPage.followUp.closedHint":
    "追问已停止。已经问过的记录都还在这里，点「继续追问」可以接着问。",
  "interviewPage.followUp.stoppedToast": "已停止追问",
  "interviewPage.followUp.resumedToast": "已恢复追问",
  "interviewPage.followUp.stateFailed": "没能切换追问状态",

  // 收尾语：答完最后一题时面试官要先回应这段、再说结束。正常路径由服务端多跑一次
  // 模型生成；这次调用失败时页面用下面这句本地化文案补上（模型可空则拿不到）。
  "interviewPage.closing.fallback":
    "今天先聊到这里。你最后那段回答我记下了，后续流程会有通知；想接着聊刚才那段，随时可以追问。",

  // ===== 正式问答结束后的决策卡（需求 4）：先问要不要追问，再出报告 =====
  "interviewPage.decision.title": "本场正式问答已结束",
  "interviewPage.decision.hint": "报告还没生成。可以先追问几轮，随时再结束并生成报告",
  "interviewPage.decision.continue": "继续追问",
  "interviewPage.decision.finish": "结束并生成报告",
  "interviewPage.decision.finishing": "正在生成报告，请稍候",
  "interviewPage.decision.failed": "报告没能生成",

  // 面试类型 / 难度 / 面试官风格的显示名（键是协议值，见文件头说明）。
  "interviewPage.setup.type.technical": "技术面",
  "interviewPage.setup.type.project": "项目深挖",
  "interviewPage.setup.type.behavioral": "行为面（STAR）",
  "interviewPage.setup.type.hr": "HR 面",
  "interviewPage.setup.type.general": "综合面",
  "interviewPage.setup.type.case": "案例分析",
  "interviewPage.setup.type.english": "英语面试",
  "interviewPage.setup.type.stress": "压力面",
  "interviewPage.setup.difficulty.junior": "初级",
  "interviewPage.setup.difficulty.mid": "中级",
  "interviewPage.setup.difficulty.senior": "高级",
  "interviewPage.setup.style.rigorous": "严谨专业",
  "interviewPage.setup.style.gentle": "温和引导",
  "interviewPage.setup.style.probing": "持续追问",
  "interviewPage.setup.style.pressure": "压力质询",

  // 外部简历（第 21 条）"用于面试"的预填提示：从简历中心跳过来时把材料带进设定卡。
  "interviewPage.setup.external.prefilled": "已带入外部简历「{name}」",
  "interviewPage.setup.external.loadFailed": "没能读取这份外部简历，请手动选择或上传",
  "interviewPage.setup.external.noText": "这份外部简历没有提取到文字，请在简历材料里上传原件",
} as const;

export default interviewPage;
