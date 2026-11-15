// SPDX-License-Identifier: Apache-2.0
/**
 * 「外部连接」页（T11 / T12）的响应类型。
 *
 * 两个维度分开：`status`（这条连接现在有效吗）与 `protection`（它在本机怎么存）。
 * 两者都是**协议值**，显示名走 i18n（认不出的值回落后端给的 `*_label`）。
 */

/** 凭据三态 + 系统来源两态（`modified` / `default`）。 */
export type ConnectionStatus = "saved" | "not_configured" | "session_only" | "modified" | "default";

/** 存储保护方式；`config_file` 只用于非密钥的系统来源。 */
export type ConnectionProtection = "dpapi" | "plaintext" | "memory_only" | "config_file";

/** 一个外部依赖：一条凭据，或一项系统来源。 */
export interface ConnectionItem {
  id: string;
  label: string;
  kind: "credential" | "system";
  status: ConnectionStatus;
  status_label: string;
  detail: string;
  masked: string;
  key_configured: boolean;
  protection: ConnectionProtection;
  protection_label: string;
  protection_description: string;
  editable: boolean;
  write_hint: string;
  target_id: string;
  location: string;
  /** 系统来源的当前生效值（凭据恒为空串）。 */
  value: string;
  /** 系统来源的出厂默认值。 */
  default_value: string;
  is_default: boolean;
}

/** 一组外部依赖：A 组 AI 服务 / B 组搜索来源 / C 组系统来源。 */
export interface ConnectionGroup {
  id: "ai" | "search" | "system";
  label: string;
  kind: "credential" | "system";
  hint: string;
  items: ConnectionItem[];
}

/** 整页快照。 */
export interface ConnectionsPayload {
  groups: ConnectionGroup[];
  storage: { kind: ConnectionProtection; label: string; description: string };
  /** 后端是否真的读到了数据库会话（false 时状态不可判定）。 */
  retrieved: boolean;
}

/** 识别引擎三档的协议值。 */
export type OcrEngine = "auto" | "ocr" | "vision";

export interface OcrEngineOption {
  value: OcrEngine;
  /** **后端给的可读说明**：前端不再写第二份中文（否则总会说两套）。 */
  label: string;
}

export interface OcrSettings {
  engine: OcrEngine;
  key_configured: boolean;
  engine_options: OcrEngineOption[];
}
