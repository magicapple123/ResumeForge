// SPDX-License-Identifier: Apache-2.0
import type { AdmissionResult, HardGateResult } from "./match";
import type { QueueStatus, TaskItemStatus, TaskKind, TaskStatus } from "./tasks";

// ===== ⑦ 队列 =====
export interface ApplyQueueItem {
  id: number;
  job_id: number | null;
  job_title: string;
  company: string;
  resume_id: number | null;
  resume_title: string;
  greeting: string;
  sort_order: number;
  status: QueueStatus;
  admission: AdmissionResult | null;
  hard_gate: HardGateResult | null;
  requires_confirm: boolean;
  /**
   * 这个岗位能不能自动投递：取决于**来源**是否能归属到某个招聘网站，与匹配结论无关。
   *
   * 为 false 时（手动录入、来源与投递链接都指不到站点的岗位）勾选框禁用、也不计入
   * 「待投递」——投递台只能驱动招聘网站上的岗位，强投只会得到一条失败记录。
   *
   * **可选**：缺失按"支持"处理（与后端默认同向），判断写 `=== false`，别写 `!x`。
   */
  apply_supported?: boolean;
  /**
   * #14B 参考分（0–100）：由后端用 `score_match_result` 从匹配结论派生，**不参与准入**。
   *
   * `null` 表示这个岗位还没做过匹配分析。它只用来帮用户决定"先投哪个"，投不投得出去
   * 仍然只看 `admission`；列头必须写「参考分」并原样展示免责文案。
   * **可选**：后端未升级时缺失，按 `null`（未分析）处理。
   */
  match_score?: number | null;
  /** #14B 是否被收藏（`Job.favorite` 透出）；**可选**：缺失按 false 处理。 */
  favorite?: boolean;
  /**
   * #15A 僵尸岗分数（0–100）：由后端按**你自己这条岗位的复采历史**算出来（首见至今天数 /
   * 复采次数 / 薪资是否变过 / HR 是否长期不活跃），不是平台的"健康度"。
   *
   * `null` = 复采历史不足（冷启动，只有 1 条 sighting），界面**不渲染**徽标——把"没数据"
   * 画成 0 分会一直被读成"这个岗位很健康"。
   * **可选**：后端未升级时缺失，与 `null` 同义。
   */
  ghost_score?: number | null;
  /** #15A 四项证据：后端给的人话，界面**逐条原样**展示，不在前端重算阈值或改写措辞。 */
  ghost_evidence?: string[];
  /** #15B 这条岗位的 JD 在你上次投递之后被改过（被动式：只在下一次采集时才发现）。 */
  jd_changed?: boolean;
  /** #15A 用户已经点过「忽略此岗位」：徽标不再渲染，分数本身仍留在数据里。 */
  ghost_ignored?: boolean;
  created_at: string;
  updated_at: string;
}

export interface ApplyQueueAddItem {
  job_id: number;
  resume_id?: number | null;
  greeting?: string;
  confirm_real_gap?: boolean;
  confirm_unanalyzed?: boolean;
}

/**
 * 队列列表响应（P2-2）：列表**封顶 500 条**（按 sort_order 倒序取最新入队的），
 * `total` 是队列实际条数，`truncated` 表示还有更早的条目没展示——
 * 界面要提示用筛选/开始投递消化队列，而不是假装队列只有 500 条。
 */
export interface ApplyQueueList {
  items: ApplyQueueItem[];
  total: number;
  truncated: boolean;
}

/** 入队被 409 拦下时后端回传的结构化原因（用于逐条确认）。 */
export interface QueueConflictDetail {
  message: string;
  job_id?: number;
  gaps?: string[];
  unanalyzed?: boolean;
  /**
   * 岗位来源不是投递台支持的招聘网站。
   *
   * 这一类比 `unanalyzed` / `gaps` 更硬：那两类用户可以显式确认后放行，这一类**确认也没用**
   * ——投递时根本定位不到站点，所以界面只提示、不给"仍然加入"的按钮。
   */
  site_unsupported?: boolean;
  /** 被拦下的岗位（开始投递时可能不止一个）。 */
  job_ids?: number[];
  job_titles?: string[];
}

// ===== ⑧ 批次与记录 =====
export interface ApplyTask {
  id: number;
  kind: TaskKind;
  status: TaskStatus;
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  current_step: string;
  stop_reason: string;
  config: Record<string, unknown>;
  message: string;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export interface ApplyTaskItem {
  id: number;
  task_id: number;
  job_id: number | null;
  job_title: string;
  company: string;
  resume_id: number | null;
  resume_title: string;
  greeting: string;
  status: TaskItemStatus;
  failure_category: string;
  failure_detail: string;
  attempt: number;
  sort_order: number;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export interface ApplyTaskDetail extends ApplyTask {
  items: ApplyTaskItem[];
}

export interface ApplyRecord {
  id: number;
  task_id: number;
  job_id: number | null;
  job_title: string;
  company: string;
  resume_title: string;
  greeting: string;
  status: TaskItemStatus;
  failure_category: string;
  failure_label: string;
  failure_detail: string;
  /**
   * #39：失败三段稳定码（后端 0073）。都是协议值，展示名与「你该怎么做」在前端语言包：
   * 在哪一步（opening/…/unknown）、卡在哪个控件（chat_input 等）、为什么失败
   * （site_changed / render_timeout / page_not_navigated 等）。可选：旧响应没有。
   */
  failure_step?: string;
  failure_target?: string;
  failure_reason?: string;
  attempt: number;
  /**
   * #15B 你投的这个岗位在你投之后被改过（被动式：只在下一次采集时才发现）。
   * **可选**：旧响应没有，缺失按 false 处理（不渲染徽标）。
   */
  jd_changed?: boolean;
  /**
   * #15B 变更明细按**队列条目 id** 取（`GET /apply/queue/{queue_id}/jd-change`），而记录本身
   * 只带岗位与批次，所以后端按 `job_id` 反查出这条记录关联的队列条目，随记录一起下发。
   * 只有「徽标点开抽屉」这一个用途：
   * - 有值 → 徽标可点，抽屉按它取 before/after；
   * - 空 / 缺失 → 徽标照旧显示（"有变更"是真的），但不猜一个 id 去打请求
   *   （猜错会看到别人岗位的 diff，比不给更糟）。
   */
  queue_id?: number | null;
  created_at: string;
  finished_at: string | null;
}

/**
 * 一个投递批次及其全部记录：投递记录按批次分组展示的载体。
 *
 * 一次「开始投递」= 一个批次；用户一次性投 N 个岗位时，这 N 条记录同属一组。
 * 组头上的统计是该批次自己的账（不随筛选变化），组内是命中的记录。
 */
/** #39：组头同因聚合项——本批某个失败分类的条数（label 已由后端按枚举翻好）。 */
export interface ApplyFailureCount {
  category: string;
  label: string;
  count: number;
}

export interface ApplyRecordBatch {
  id: number;
  status: TaskStatus;
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  message: string;
  created_at: string;
  finished_at: string | null;
  /**
   * 命中当前筛选的记录数（B4 按需加载）：轻量分页（include_items=false）不携带
   * items，组头用它展示「N 条记录」；展开时再拉明细。可选：旧响应里没有。
   */
  matched_count?: number;
  /**
   * #39：「只重试这 N 条」里的 N——命中当前筛选、状态为失败的记录数。
   * 与 matched_count 分开：后者含成功/跳过，能重投的只有失败的那些。
   */
  retryable_count?: number;
  items: ApplyRecord[];
  failure_summary: ApplyFailureCount[];
}

export interface GreetingPreview {
  greeting: string;
  source: "generated" | "queue" | "default";
}
