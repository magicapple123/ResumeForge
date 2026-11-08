// SPDX-License-Identifier: Apache-2.0
/**
 * 投递交付单（T09）接口：读取与验收（契约 C 节）。
 *
 * 交付单是已有投递快照（`resume_delivery_record`）的**只读读视图**：track 状态、填充
 * 记录、事实台账疑点都旁挂上来，前端只负责展示——**三态与优先级只由后端给**
 * （waiting_human > has_doubts > ready），这里不做任何聚合或阈值计算。
 *
 * ack 只写 `apply_task_item.receipt_acked_at`（幂等、不碰 track）；失败记录也可读/可 ack
 * ——"卡在人手上"是正常终态，不是错误。
 */
import { request } from "./client";

/** 三态（协议值，展示名走 deliveryReceipt 语言包）。 */
export type DeliveryReceiptState = "waiting_human" | "has_doubts" | "ready";

/** 投递快照：来自 resume_delivery_record（外键 SET NULL，简历/岗位被删也完整可读）。 */
export interface DeliveryReceiptDelivery {
  track_id: number;
  resume_title: string;
  company: string;
  job_title: string;
  /**
   * apply / track 路径的快照按 ADR-0002 本来就没有导出产物：以下四列可能是 null/空，
   * 这不是"缺件"，界面显示「未记录」即可（三态也不因此判卡住，见 receipt.md §6）。
   */
  pages: number | null;
  page_limit: number | null;
  export_format: string | null;
  request_params: Record<string, unknown> | null;
  content_sha256: string;
  artifact_sha256: string | null;
  created_at: string;
  /** 快照指纹与当前简历不同：只作展示，**不参与三态**。 */
  resume_changed_since_delivery: boolean;
}

/** 网申填充记录摘要（按 url 匹配；`unknown` 表示匹配不上，不判缺件）。 */
export interface DeliveryReceiptFill {
  matched: boolean;
  unknown: boolean;
  url: string;
  filled_count: number;
  total_count: number;
  failed_count: number;
}

/** 交付单读视图（字段不得删；receipt 轨道可在 contracts/receipt.md 细化）。 */
export interface DeliveryReceipt {
  record_id: number;
  state: DeliveryReceiptState;
  /** 稳定码（如 captcha_required / doubts_present / snapshot_missing），展示名走语言包。 */
  state_reasons: string[];
  delivery: DeliveryReceiptDelivery | null;
  fill: DeliveryReceiptFill | null;
  /** 事实台账疑点数。 */
  doubts: { count: number };
  /** 人工步骤稳定码（captcha_required / login_required / …）。 */
  human_steps: string[];
  followup: { reminder_id: number; due_at: string } | null;
  receipt_acked_at: string | null;
}

/** 验收响应（幂等：已有值不覆盖）。 */
export interface DeliveryReceiptAckResponse {
  receipt_acked_at: string;
  acked: boolean;
}

/** 读一条投递记录的交付单（失败记录也可读）。 */
export function getDeliveryReceipt(recordId: number): Promise<DeliveryReceipt> {
  return request(`/apply/records/${recordId}/receipt`);
}

/** 验收交付单：只写 receipt_acked_at，不碰求职进度。 */
export function ackDeliveryReceipt(recordId: number): Promise<DeliveryReceiptAckResponse> {
  return request(`/apply/records/${recordId}/receipt/ack`, { method: "POST" });
}
