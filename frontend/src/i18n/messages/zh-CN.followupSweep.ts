// SPDX-License-Identifier: Apache-2.0
/**
 * 跟进巡检卡（T06）：来源徽标、两类桶的说明、三种处理方式与整卡提交文案。
 *
 * 卡片标题由后端文案模板产出（属于数据，只读展示），本包只存**界面决定的措辞**：
 * 桶名、按钮名、提示与结果提示。「这里只记录你的选择，不改动求职进度里的阶段」是
 * 必须讲清的口径——巡检决策只写 application_follow_up，不写 application_track。
 */
const followupSweep = {
  /** 任务来源徽标（任务卡里非手动来源统一的出处标签）。 */
  "followupSweep.sourceBadge": "跟进巡检",
  /** 卡片区域的读屏名。 */
  "followupSweep.aria.card": "跟进巡检卡",
  /** 两类桶的显示名；步骤的 kind 是协议值（followup / confirm）。 */
  "followupSweep.kind.followup": "跟进清单",
  "followupSweep.kind.confirm": "确认状态",
  /** 跟进清单桶的说明：讲清"怎么选 + 不动阶段"。 */
  "followupSweep.kindHint.followup":
    "每条各选一种处理方式，选完一起提交；这里只记录你的选择，不改动「求职进度」里的阶段。",
  /** 确认状态桶的说明：长期没更新时先确认状态，而不是催跟进。 */
  "followupSweep.kindHint.confirm":
    "这些岗位有一段时间没有记录到状态变化，先确认现在到哪一步了；这里只记录你的选择，不改动阶段。",
  /** 一组处理方式的读屏名（{title} 是这一步的岗位文案）。 */
  "followupSweep.decision.aria": "「{title}」的处理方式",
  /** 三种处理方式（与后端 decision 协议值一一对应）。 */
  "followupSweep.decision.contacted": "已联系",
  "followupSweep.decision.replied": "对方已回",
  "followupSweep.decision.stopped": "不跟了",
  /** 整卡提交按钮；{count} 是本次要记录的处理条数。 */
  "followupSweep.action.submit": "记录这次处理（{count} 条）",
  /** 单个步骤已记录处理结果时的标签。 */
  "followupSweep.state.stepDone": "已记录",
  /** 整卡已全部处理完时的说明（不再提供提交按钮）。 */
  "followupSweep.state.done": "这张卡已处理完",
  /** 还有条目没选处理方式时的行内提示；{count} 是未选条数。 */
  "followupSweep.hint.incomplete": "还有 {count} 条没选处理方式",
  /** 已选了一部分、还可以下次再处理时的提示（后端允许部分提交）。 */
  "followupSweep.hint.partial": "还有 {count} 条没选，也可以先提交已选的",
  /** 提交成功；{count} 是后端确认的处理条数。 */
  "followupSweep.toast.submitted": "已记录 {count} 条跟进处理",
  /** 重复提交（后端 created_rows=0 / idempotent=true）时如实说明已记录过。 */
  "followupSweep.toast.idempotent": "这些处理已经记录过了",
  /** 提交失败：说清发生了什么，建议重试。 */
  "followupSweep.error.submit": "这次处理没有记录上，请重试一次",
} as const;

export default followupSweep;
