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
  /**
   * R19：这一条用的**服务商**与**模型**（取实际生效的配置；取不到就是空串）。
   * 只有 AI 服务那几条会填，其余来源恒为空串——前端据此不渲染模型 chip。
   */
  provider?: string;
  model?: string;
  /** CR-07：只读展示提示（前 4 后 4，短于 16 位为 `********`）；未配置时为空串。 */
  hint?: string;
  key_configured: boolean;
  /**
   * CR-06：这一条没有单独配置，实际生效的是「AI 模型」里的 DeepSeek Key。
   * 用布尔而不是让前端匹配 `detail` 文案：前端有自己的译文，匹配中文迟早漂。
   */
  borrowed_key?: boolean;
  protection: ConnectionProtection;
  protection_label: string;
  protection_description: string;
  editable: boolean;
  write_hint: string;
  target_id: string;
  location: string;
  /**
   * #9：「去配置」深链的落点锚点（`/settings?tab=…#anchor` 的 `#` 部分）。
   * 凭据行把它写成根节点的 `id`，深链因此能真的滚到**这一行**并高亮；
   * 系统来源（C 组）没有这项语义，为空串。
   */
  anchor?: string;
  /** 系统来源的当前生效值（凭据恒为空串）。 */
  value: string;
  /** 系统来源的出厂默认值。 */
  default_value: string;
  is_default: boolean;
}

/** 一组外部依赖：A 组 AI 服务 / B 组搜索来源 / C 组系统来源。 */
export interface ConnectionGroup {
  id: "ai" | "search" | "proxy" | "system";
  label: string;
  kind: "credential" | "system";
  hint: string;
  items: ConnectionItem[];
}

/** 密钥地图的一行（CR-12）：全部由后端从凭据清单投影，前端只渲染。 */
export interface ConnectionKeyMapRow {
  id: string;
  label: string;
  group: string;
  group_label: string;
  /** 界面上去哪改。 */
  configure_at: string;
  /** 哪些功能在用这把 Key（数组：#9 的矩阵要切格子）。 */
  used_by: string[];
  /** 同一批标签拼回的整句（详情卡与凭据行的「用于」直接显示这一句）。 */
  used_by_text: string;
  /** 留空 / 清除时会发生什么。 */
  empty_meaning: string;
  /** 文件里存哪（排障用）。 */
  where: string;
  /** 这条凭据现在的状态（与凭据行的 `status` 同源）。 */
  status: ConnectionStatus | "";
  /** 「去配置」落点：设置页分组（`?tab=`）。 */
  section: string;
  /** 「去配置」落点：锚点 id（`#`）。 */
  anchor: string;
}

/** 依赖矩阵的一列 = 一把密钥（#9）。 */
export interface ConnectionMatrixKey {
  id: string;
  label: string;
  /** 所属分组：决定这一列的强调色（`data-group`）。 */
  group: string;
  status: ConnectionStatus;
  /** 「去配置」落点。 */
  section: string;
  anchor: string;
}

/** 依赖矩阵的一行 = 一个会拿密钥去发请求的功能（#9）。 */
export interface ConnectionMatrixFeature {
  id: string;
  label: string;
  /** 功能域（内容生成 / 联网与抓取 / 输入与检索 / 系统）。 */
  group: string;
}

/** 一条依赖：哪把 Key 被哪个功能用；`kind` **由后端算**，前端不许按 id 判断。 */
export interface ConnectionMatrixEdge {
  key: string;
  feature: string;
  kind: "direct" | "override";
}

/** 闸门凭据（代理口令）：所有出网请求都过它，因此不占矩阵列。 */
export interface ConnectionMatrixGate {
  key: string;
  label: string;
}

/**
 * 密钥依赖矩阵（#9）。
 *
 * 行列顺序 = 后端 registry 声明顺序；这里**没有任何清单**——新增一把 Key 时矩阵自动多
 * 一列，前端一行都不用改。
 */
export interface ConnectionMatrix {
  keys: ConnectionMatrixKey[];
  features: ConnectionMatrixFeature[];
  edges: ConnectionMatrixEdge[];
  /** 没有闸门型凭据时为 `null`。 */
  gate: ConnectionMatrixGate | null;
}

/** 整页快照。 */
export interface ConnectionsPayload {
  groups: ConnectionGroup[];
  /** CR-12：行数等于凭据来源数（后端投影，前端不许手写第二份）。 */
  key_map?: ConnectionKeyMapRow[];
  /** #9：依赖矩阵（行=功能 / 列=密钥）。老后端不返回时为 `null`。 */
  matrix?: ConnectionMatrix | null;
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
