// SPDX-License-Identifier: Apache-2.0
/**
 * 「有约束的版面优化」（W09 / P1-04）新增文案。
 *
 * 口径（plan P1-04）：**不缩字号**（用户没解锁就不动字号）、不解除锁定、无虚假成功；
 * 每个候选要说清「改了什么参数 / 减少多少溢出 / 可读性影响」。术语按 `docs/ui-copy-guide.md`：
 * 排版参数（页边距/行高/区块间距/字号系数）、版式、页面。
 */
const optimizer = {
  "optimizer.title": "按条件优化版面",
  "optimizer.hint": "在你不希望被改动的东西之外找方案：不解除锁定、不偷偷缩字号",
  "optimizer.constraints": "约束条件",
  "optimizer.lockFont": "不动字号",
  "optimizer.lockFont.hint": "只收页边距、区块间距与行高",
  "optimizer.minMargin": "最小页边距",
  "optimizer.minMargin.hint": "页边距不会再被收到这个值以下",
  "optimizer.minMargin.off": "不限制",
  "optimizer.keepEntries": "保持条目完整",
  "optimizer.keepEntries.hint": "只收紧间距与字号，不改分页与条目结构",
  "optimizer.target": "目标篇幅",
  "optimizer.target.pages": "{count} 页",
  "optimizer.generate": "生成候选",
  "optimizer.generating": "正在实测候选",
  "optimizer.regenerate": "重新生成候选",
  "optimizer.candidates": "候选方案",
  "optimizer.candidates.hint": "{count} 个有差异的方案，按可读性影响从小到大",
  "optimizer.candidate.changes": "改了什么",
  "optimizer.candidate.changesColon": "改了什么：",
  "optimizer.candidate.overflow": "溢出减少 {value}",
  "optimizer.candidate.overflow.none": "溢出没有减少",
  "optimizer.candidate.pages": "预计 {pages} 页",
  "optimizer.candidate.fits": "放得下",
  "optimizer.candidate.notFits": "仍放不下",
  "optimizer.candidate.readability.none": "几乎无感",
  "optimizer.candidate.readability.mild": "轻微",
  "optimizer.candidate.readability.noticeable": "明显",
  "optimizer.candidate.fontNote": "字号降 {percent}（下限 {floor}px）",
  "optimizer.apply": "应用这个方案",
  "optimizer.apply.aria": "应用第 {index} 个候选方案",
  "optimizer.applied": "参数已写回滑杆，可撤销",
  "optimizer.applied.hint": "方案里的数值已填到左栏滑杆，你可以直接看见并继续微调",
  "optimizer.measuring": "正在量这一档",
  "optimizer.empty": "内容本来就放得下，不需要优化",
  "optimizer.empty.hint": "可以继续手动微调，或先精简内容",
  "optimizer.noFeasible": "在当前约束下没有可行方案",
  "optimizer.noFeasible.locked": "你锁定的条件把所有候选都排除了；放宽其中一项再试",
  "optimizer.noFeasible.stillOverflow": "候选都试过了，仍放不下；只能精简内容或增加页数",
  "optimizer.noFeasible.noRoom": "排版参数已经收到最紧，没有可再收紧的项",
  "optimizer.noMeasure": "还没有量到当前版面，等预览加载完再试",
  "optimizer.conflict": "参数已被其他窗口修改",
  "optimizer.conflict.hint": "先刷新到最新版，再重新生成候选",
  "optimizer.cannotShrink": "不会自动缩小字号",
  "optimizer.cannotShrink.hint": "想更紧凑请手动调字号滑杆，或取消「不动字号」",
  "optimizer.readability": "可读性影响",
  "optimizer.tried": "已试 {count} 个方案",
  "optimizer.change.padding": "页边距 {from} → {to} mm",
  "optimizer.change.sectionGap": "区块间距 {from} → {to}",
  "optimizer.change.lineHeight": "行高 {from} → {to}",
  "optimizer.change.fontScale": "字号系数 {from} → {to}",
} as const;

export default optimizer;
