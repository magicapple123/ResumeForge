// SPDX-License-Identifier: Apache-2.0
/**
 * ATS 本地检测面板：三个分项与严重程度的显示名、JD 输入与关联岗位自动载入提示、
 * 参考分与关键词覆盖率、关键词命中情况、问题条目，以及「改进清单」的复制结果与可粘贴文本。
 */
const atsCheck = {
  /** 分项进度条的行首标签（简称）。 */
  "atsCheck.category.format.label": "格式",
  /** 分项卡片的标题（问题按类别分组，卡片上用全称）。 */
  "atsCheck.category.format.cardTitle": "格式风险",
  /** 见 atsCheck.category.format.label。 */
  "atsCheck.category.keyword.label": "关键词",
  /** 见 atsCheck.category.format.cardTitle。 */
  "atsCheck.category.keyword.cardTitle": "关键词覆盖",
  /** 见 atsCheck.category.format.label。 */
  "atsCheck.category.position.label": "位置",
  /** 见 atsCheck.category.format.cardTitle。 */
  "atsCheck.category.position.cardTitle": "信息位置",

  /** 严重程度：问题标签与可粘贴清单里的「【高】」共用这三条。 */
  "atsCheck.severity.high": "高",
  "atsCheck.severity.medium": "中",
  "atsCheck.severity.low": "低",

  /** JD 文本框的无障碍名。 */
  "atsCheck.jd.label": "JD 文本",
  /** JD 文本框的占位符：同时说明留空的后果。 */
  "atsCheck.jd.placeholder": "可选：粘贴岗位 JD 文本，按 JD 关键词检查覆盖（留空则做通用覆盖）",
  /** 关联岗位 JD 自动载入成功后的次要提示。 */
  "atsCheck.jd.autoLoaded": "已自动载入关联岗位 JD，可直接开始检测",
  /** 自动载入失败时的次要提示（不弹阻塞错误，保留手动按钮）。 */
  "atsCheck.jd.autoFailed": "未能自动读取关联岗位，可稍后手动载入",
  /** 手动载入失败的错误提示：给出口（手动粘贴）。 */
  "atsCheck.jd.loadFailed": "岗位信息读取失败，可以手动粘贴 JD",

  /** 主按钮：开始一次检测。 */
  "atsCheck.action.run": "开始检测",
  /** 有 jobId 时的按钮：重新读取关联岗位的 JD。 */
  "atsCheck.action.reloadJd": "重新载入关联岗位 JD",
  /** 结果区的按钮：按当前 JD 再跑一次。 */
  "atsCheck.action.retry": "重新检测",
  /** 结果区的按钮：把问题与建议复制成可粘贴的清单。 */
  "atsCheck.action.copyImprovements": "复制改进清单",

  /** 空态（还没点检测）：JD 已经在框里，指向同一行的「开始检测」。 */
  "atsCheck.emptyHint.withJd": "JD 已就绪，点「开始检测」查看格式风险与关键词覆盖",
  /** 空态（还没点检测）：输入框还是空的。 */
  "atsCheck.emptyHint.withoutJd": "填入岗位 JD 或关联岗位后开始检测",

  /** 总分的标签。 */
  "atsCheck.score.label": "ATS 参考分",
  /** 没有 JD 时有话直说：参考分算不出来，而不是给 0 分。 */
  "atsCheck.score.noJd": "未提供 JD，无法给出参考分",
  /** 关键词分项在没有 JD 时的占位：这一项不参与计分。 */
  "atsCheck.subscore.needsJd": "需要 JD",
  /** 关键词覆盖率；{percent} 是 0~100 的整数。 */
  "atsCheck.coverage": "关键词覆盖率 {percent}%",
  /** 没有可比对的关键词时的口径说明：不能说成 100%，只能说没识别到。 */
  "atsCheck.coverage.none": "未识别到可比对的关键词",
  /** 已命中关键词列表的标题。 */
  "atsCheck.keywords.matched": "已命中关键词：",
  /** 未命中关键词列表的标题。 */
  "atsCheck.keywords.missing": "未命中关键词：",
  /** 一条问题都没有时的空态。 */
  "atsCheck.empty": "未发现明显问题",
  /** 问题条目里「建议」两字的前缀（建议正文由后端给出）。 */
  "atsCheck.issue.suggestion": "建议：",

  /** 复制成功。 */
  "atsCheck.improvement.copied": "改进清单已复制",
  /** 复制失败：给出路（手动选择文本）。 */
  "atsCheck.improvement.copyFailed": "复制失败，请手动选择文本",
  /** 可粘贴清单的一条：序号 + 严重程度 + 问题标题。 */
  "atsCheck.improvement.head": "{index}. 【{severity}】{title}",
  /** 可粘贴清单的建议行（紧跟在标题下面）。 */
  "atsCheck.improvement.suggestion": "建议：{suggestion}",
} as const;

export default atsCheck;
