import type {
  AdmissionResult,
  HardGateResult,
} from "./match";
import type {
  QueueStatus,
  TaskItemStatus,
  TaskKind,
  TaskStatus,
} from "./tasks";

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
  attempt: number;
  created_at: string;
  finished_at: string | null;
}

/**
 * 一个投递批次及其全部记录：投递记录按批次分组展示的载体。
 *
 * 一次「开始投递」= 一个批次；用户一次性投 N 个岗位时，这 N 条记录同属一组。
 * 组头上的统计是该批次自己的账（不随筛选变化），组内是命中的记录。
 */
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
  items: ApplyRecord[];
}

export interface GreetingPreview {
  greeting: string;
  source: "generated" | "queue" | "default";
}
