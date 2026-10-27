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

  // ===== 面试官设定卡 =====
  "interviewPage.setup.title": "面试官设定",
  "interviewPage.setup.greeting": "你好，我是 Jane，今天由我来面试你。",
  "interviewPage.setup.jobLabel": "关联岗位（选填）",
  "interviewPage.setup.jobPlaceholder": "选中后按该岗位的 JD 提问（输入关键词搜索）",
  "interviewPage.setup.typeLabel": "面试类型",
  "interviewPage.setup.difficultyLabel": "难度",
  "interviewPage.setup.styleLabel": "面试官风格",
  "interviewPage.setup.roundsLabel": "轮数",
  "interviewPage.setup.roundsAuto": "自动（AI 判断收尾）",
  "interviewPage.setup.roundsOption": "{round} 轮",
  "interviewPage.setup.roundsExtra":
    "选「自动」时不设轮数：面试官按你的表现自主决定何时收尾，更接近真实面试。",
  "interviewPage.setup.focusLabel": "考察重点（选填）",
  "interviewPage.setup.focusExtra": "例如：用户增长、跨部门协作、成本控制",
  "interviewPage.setup.focusPlaceholder": "留空则按面试类型通用考察",
  "interviewPage.setup.personaLabel": "自定义面试官人设（选填）",
  "interviewPage.setup.personaExtra":
    "例如：某公司业务负责人，喜欢追问具体数字与落地过程。优先级高于上面的默认风格。",
  "interviewPage.setup.start": "开始面试",
  "interviewPage.setup.confidenceTip":
    "面试官会基于你的资料与岗位要求提问，回答越具体（做了什么、结果是什么）点评越有用。",

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
} as const;

export default interviewPage;
