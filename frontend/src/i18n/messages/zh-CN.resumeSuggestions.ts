// SPDX-License-Identifier: Apache-2.0
/**
 * 岗位化修改建议弹窗（`ResumeSuggestionsModal`）。
 *
 * ## 这里**没有**收录 `adopt()` 里的修订指令
 *
 * 采纳一条建议时，组件把建议拼成一段 `instructions` 交给 `reviseResume()`，那是**喂给
 * 模型的 prompt**（交接单 §3 第三类），翻成英文会改变生成行为。那几句话原样留在组件里，
 * 不计入迁移。
 *
 * ## 列表里那条「依据：…」是展示，不是 prompt
 *
 * 与上面那条无关：结果列表里每条建议下面显示的出处是**界面文案**，所以有
 * `resumeSuggestions.evidence`。多个出处之间的 `；` 是纯展示分隔符（中文全角、英文
 * `"; "`），走 `separator.evidence`，不写死在组件里。
 *
 * ## 进度文案里的单位
 *
 * 「已用时 {seconds}s」把秒数交给参数、`s` 留在句子里：两种语言都用 `s`，但句子结构
 * 不同，所以整句是一条 key，不是「前半句 + 数字 + 后半句」拼出来的。
 */
const resumeSuggestions = {
  "resumeSuggestions.modal.title": "岗位化修改建议",

  /** 三档优先级的显示名；`priority` 本身是后端给的值，不翻。 */
  "resumeSuggestions.priority.high": "优先修改",
  "resumeSuggestions.priority.medium": "建议修改",
  "resumeSuggestions.priority.low": "可选优化",

  /** 采纳成功。 */
  "resumeSuggestions.adopted": "已采纳这条建议并更新简历",
  /** 采纳失败（没有更具体的错误消息时）。 */
  "resumeSuggestions.adoptFailed": "采纳建议失败，请稍后重试",
  /** 生成失败（后端没给错误文本时）。 */
  "resumeSuggestions.generateFailed": "生成建议失败，请稍后重试",

  /** 说明卡的标题（用户点开弹窗先看到的那一句）。 */
  "resumeSuggestions.intro.title": "生成岗位优化建议",
  /**
   * 说明卡的正文：讲清读什么、大概多久、能不能走开。
   *
   * 原文里 `10–60` 用的是 en dash（不是连字符），这里逐字保留，英文同样写 `10–60 seconds`。
   */
  "resumeSuggestions.intro.body":
    "会读取这份简历与关联岗位 JD，调用一次大模型生成逐条修改建议；约 10–60 秒，生成期间可以关闭窗口，完成后会通知你。",
  "resumeSuggestions.action.start": "开始生成",

  /** 生成中的进度：`{seconds}` 是已用时秒数。 */
  "resumeSuggestions.scanning.elapsed": "正在生成建议…已用时 {seconds}s",
  /** 生成中告知「关窗不 abort」。 */
  "resumeSuggestions.scanning.hint": "可以关闭此窗口，生成会继续",
  /** 生成中唯一的 abort 入口（关窗不算）。 */
  "resumeSuggestions.action.cancelScan": "取消生成",

  /** 结果列表顶部的目标岗位；有关联公司时用这一条。 */
  "resumeSuggestions.target.company": "目标岗位：{company} · {job}",
  /** 结果列表顶部的目标岗位；没有公司时用这一条（不留悬空的「·」）。 */
  "resumeSuggestions.target.job": "目标岗位：{job}",

  /** 覆盖类动作的就地确认标题。 */
  "resumeSuggestions.regenerate.confirm": "重新生成会覆盖当前建议",
  /** 就地确认的确认按钮。 */
  "resumeSuggestions.regenerate.ok": "重新生成",
  /** 打开就地确认的按钮（结果列表右上角）。 */
  "resumeSuggestions.action.regenerate": "重新生成建议",

  /** 单条建议的采纳按钮。 */
  "resumeSuggestions.action.adopt": "采纳并修改",

  /** 一条建议的出处行。 */
  "resumeSuggestions.evidence": "依据：{evidence}",
  /** 多条出处之间的分隔符（纯展示）。 */
  "resumeSuggestions.separator.evidence": "；",

  /** 一条建议都没有时的空态。 */
  "resumeSuggestions.empty": "当前简历与岗位要求匹配度较好，暂未发现必须修改项",
} as const;

export default resumeSuggestions;
