// SPDX-License-Identifier: Apache-2.0
/**
 * 简历详情/预览这一层的界面文案：详情弹窗（标题兜底、关联岗位链接行、错误提示）、
 * 底部动作条、版面诊断卡片、行距控件，以及生成弹窗里的「本次使用」摘要。
 *
 * 与 `zh-CN.workbench.ts` 的分工：制作台外壳、左栏参数与「自动一页」的即时反馈仍在那边；
 * 这一层**已经在用**的 key 一律继续在原处取——`workbench.close.*`、`resume.preview.close.body`、
 * `resume.measure.hintTemplate`、`resume.detail.group-usage.*` 与 `common.action.cancel` /
 * `common.action.save` 都**不在本包重复定义**：重名会被 spread 静默覆盖，是最难发现的
 * 一类文案回退。
 *
 * key 前缀按区块分：`resume.detail.*`（详情弹窗）、`resume.footer.*`（底部动作条）、
 * `resume.diagnosis.*`（版面诊断）、`resume.lineHeight.*`（行距控件）、
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

  // ── 版面诊断（ResumeLayoutDiagnosisCard）───────────────────────
  /** 面板标题。 */
  "resume.diagnosis.title": "版面诊断",
  /** 当前版面占用比例；{percent} 是 0~100 的整数。 */
  "resume.diagnosis.fill": "占用 {percent}%",
  /** 「自动一页」：诊断判定溢出、且有可试的候选版式时才出现。 */
  "resume.diagnosis.autofit": "自动一页",
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
} as const;

export default resume;
