// SPDX-License-Identifier: Apache-2.0
/**
 * #15C / #15D / #15E 三个「投递台决策辅助」接口的前端类型镜像。
 *
 * 契约以后端为准（详册第 1319–1341 行），**字段名一个字都不改**：
 * - `GET /apply/queue/{queue_id}/inspect` —— 岗位体检（薪资偏离 / 同司多投 / 历史结果）；
 * - `GET /apply/queue/resume-fit?ids=…` —— 简历指派建议（「关键词覆盖」）；
 * - `GET /apply/stopping-point?days=…` —— 边际收益停止线。
 *
 * 三处数值字段都允许 `null`：后端在样本不足时会**不给数**，界面必须显示「样本不足（N 条）」
 * 而不是把 `null` 渲染成 `0%`——那会被读成"完全没覆盖 / 薪资持平"，是最坏的误导。
 */

/** 薪资相对同城同族中位数的方向。`null` 只出现在 `status="insufficient"` 时。 */
export type ApplySalaryDirection = "high" | "low" | "same";

/** `insufficient` = 样本不够，界面只显示「样本不足（N 条）」，不显示任何百分比。 */
export type ApplySalaryStatus = "ok" | "insufficient";

export interface ApplyInspectSalary {
  status: ApplySalaryStatus;
  /** 参与比较的历史样本条数（`insufficient` 时就是「N 条」里的 N）。 */
  sample: number;
  /** 同城同族中位数（与 `target` 同单位，界面按 K 展示）；样本不足时为 null。 */
  median: number | null;
  /** 本岗位薪资；岗位没写薪资时为 null。 */
  target: number | null;
  /** 偏离百分比（正数，方向看 `direction`）；样本不足时为 null。 */
  delta_percent: number | null;
  direction: ApplySalaryDirection | null;
}

/** 「同司多投」：同一家公司你已经投过几条、队列里还排着几条。 */
export interface ApplyInspectSameCompany {
  /** `applied + in_queue`；为 0 表示这家公司完全没碰过。 */
  count: number;
  in_queue: number;
  applied: number;
}

/** 「历史结果」：这个岗位历史上投过几次、各自什么结局。 */
export interface ApplyInspectHistory {
  /** 总投递次数；0 表示没投过（此时另外三个计数也必然是 0）。 */
  applied: number;
  succeeded: number;
  failed: number;
  no_reply: number;
}

/** `GET /apply/queue/{queue_id}/inspect` 的响应。 */
export interface ApplyJobInspect {
  queue_id: number;
  salary: ApplyInspectSalary;
  same_company: ApplyInspectSameCompany;
  history: ApplyInspectHistory;
}

/**
 * 一条「简历指派建议」。
 *
 * `gain` 是 `recommended_coverage - current_coverage`（**百分点**，不是比率）：
 * `gain <= 0` 表示换过去没有收益，界面不展示这条建议（不显示「换用」）。
 */
export interface ApplyResumeFitItem {
  queue_id: number;
  job_id: number | null;
  current_resume_id: number | null;
  /** 当前简历对该岗位的关键词覆盖（百分比数值，0–100）；无当前简历时为 null。 */
  current_coverage: number | null;
  recommended_resume_id: number | null;
  recommended_coverage: number | null;
  /** 换用后能多覆盖几个百分点；`<= 0` 不值得换。 */
  gain: number;
  /** 后端给的一句话理由（原样展示，前端不改写）。 */
  reason: string;
}

/** `GET /apply/queue/resume-fit?ids=…` 的响应。 */
export interface ApplyResumeFitList {
  items: ApplyResumeFitItem[];
}

/**
 * 边际收益停止线的三态：
 * - `insufficient`：样本 < 10 条投递，只显示一行灰字「样本不足（N 条投递）」；
 * - `ok`：还没过拐点，整条不显示（不打扰）；
 * - `past`：已经过拐点，黄条 + 两个动作（跟进待回音 / 改简历）。
 */
export type ApplyStoppingPointStatus = "insufficient" | "ok" | "past";

/** 停止线的逐周明细（`interviews` 是当周产生的面试数）。 */
export interface ApplyStoppingPointWeek {
  /** 该周起始日（ISO 日期）。 */
  start: string;
  applied: number;
  interviews: number;
}

/**
 * `GET /apply/queue/{queue_id}/jd-change` 的响应（#15B，**被动式**）。
 *
 * `changed=false` 时 `before` / `after` 可能仍是同一份文本；界面只在 `changed=true`
 * 时展示两栏对比，否则只写一句「这次采集没有变化」——不把同一段话左右各摆一遍。
 * `seen_at` 是**本次采集**的时间（还没有第二次采集时为 null）。
 */
export interface ApplyJdChange {
  changed: boolean;
  before: string;
  after: string;
  seen_at: string | null;
}

/** `PUT /apply/queue/{queue_id}/ghost-ignore` 的请求体（#15A 忽略僵尸分提示）。 */
export interface ApplyGhostIgnorePatch {
  ignored: boolean;
}

/** `PUT /apply/queue/{queue_id}/ghost-ignore` 的响应：原样回显这一条的新状态。 */
export interface ApplyGhostIgnoreResult {
  queue_id: number;
  ignored: boolean;
}

/** `GET /apply/stopping-point?days=…` 的响应。 */
export interface ApplyStoppingPoint {
  status: ApplyStoppingPointStatus;
  applied: number;
  interviews: number;
  /** 此前窗口的面试转化基准（比率 0–1，或已是百分数——展示层统一归一）；样本不足时为 null。 */
  baseline_rate: number | null;
  /** 最近窗口的面试转化（同上）；样本不足时为 null。 */
  recent_rate: number | null;
  weeks: ApplyStoppingPointWeek[];
  /** 后端给的一句结论（原样保留，界面文案以语言包为准）。 */
  message: string;
}
