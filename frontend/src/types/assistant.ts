// SPDX-License-Identifier: Apache-2.0
/** AI 求职助手会话、消息和流式事件类型。 */

export interface AssistantConversationBrief {
  id: number;
  title: string;
  surface: AssistantSurface;
  pinned: boolean;
  favorite: boolean;
  /** 已归档的会话默认收进「已归档」筛选，不参与置顶排序。 */
  archived: boolean;
  /** 分组名（"移动到项目"）；空串表示未分组。 */
  group_name: string;
  /** 临时对话（F34）：为真时这段对话不注入也不抽取助手记忆；关闭不删已有记忆。 */
  memory_off?: boolean;
  message_count: number;
  created_at: string;
  updated_at: string;
}

/** 助手入口作用域：侧栏主助手与投投悬浮球历史彼此隔离。 */
export type AssistantSurface = "page" | "floating";

/** 会话列表筛选：全部 / 收藏 / 已归档。 */
export type ConversationFilter = "all" | "favorite" | "archived";

/**
 * 思考强度：空串表示不发送该参数，沿用服务商默认。
 *
 * **不是白名单**——各家的档位词汇不一样（`minimal`/`xhigh`/`max`…），所以界面上允许
 * 自定义填写，这里只约束格式（见 `isValidReasoningEffort`）。
 */
export type ReasoningEffort = string;

export const REASONING_EFFORT_OPTIONS: { value: ReasoningEffort }[] = [
  { value: "" },
  { value: "none" },
  { value: "low" },
  { value: "medium" },
  { value: "high" },
];

/** 选「自定义…」时给 Select 用的哨兵值：它不是真的档位，只是让输入框冒出来。 */
export const CUSTOM_EFFORT_OPTION = "__custom__";

/** 自定义档位的长度上限；与后端 `MAX_REASONING_EFFORT_CHARS` 一致。 */
export const MAX_REASONING_EFFORT_CHARS = 32;

/**
 * 自定义档位的格式校验，规则与后端 `normalize_reasoning_effort` 一致。
 *
 * 挡住的是空白、中文、超长串这类一定发不出去的值；放行的是服务商自创的词。
 */
export function isValidReasoningEffort(value: string): boolean {
  const effort = value.trim();
  if (effort.length > MAX_REASONING_EFFORT_CHARS) return false;
  return /^[A-Za-z0-9._-]*$/.test(effort);
}

export interface AssistantConversationForkPayload {
  title?: string;
  message_limit?: number;
}

export interface AssistantAttachment {
  name: string;
  mime_type: string;
  /** document：pdf/docx，正文已由后端在本机提取进 `text`。 */
  kind: "text" | "image" | "document";
  size_bytes: number;
  text: string;
  data_url: string;
  /** 提取过程中的说明（例如内容过长只取了前一部分）。 */
  notes: string[];
}

export interface AssistantSource {
  title: string;
  url: string;
  snippet: string;
}

/**
 * 一次回答里 [来源N] 的「编号 → url」映射条目。
 *
 * 后端在来源**首次收集时**分配全局单调递增编号并持久化到助手消息的
 * `context.source_map`；前端渲染正文里的 [来源N] 时按这个映射解析链接，
 * 而不是拿"去重后的参考来源"数组下标去对——那会跳错来源。
 */
export interface AssistantSourceNumber {
  number: number;
  url: string;
}

/**
 * 写入提案的字段差异（后端 authorization.FieldChange）。
 * before 为 null 表示新增字段，after 为 null 表示删除字段。
 */
export interface AssistantWriteFieldChange {
  field: string;
  before?: string | null;
  after?: string | null;
}

/** 写工具的写入预览：目标 / 影响范围 / 字段差异。 */
export interface AssistantWritePreview {
  target: string;
  scope: string;
  changes: AssistantWriteFieldChange[];
}

/**
 * 待用户确认的写入提案（RF-01）。
 *
 * 助手在用户未同意写入时不会执行写工具，而是生成提案等待确认；批准/拒绝走
 * REST 端点，用服务端存储的参数执行（模型给的参数不作数）。token 只在服务端
 * 流转，前端永远拿不到——这里也没有 token 字段。
 */
export interface AssistantWriteProposal {
  proposal_id: string;
  tool_name: string;
  dataset_id: string;
  preview: AssistantWritePreview;
  created_at: string;
  expires_at: string;
  /**
   * 提案终态。``unknown`` = 后端在执行**中途失败但已经提交过**（RR-05）：数据可能
   * 已经落库，所以文案是"结果未知、先在数据里核对"，而不是"执行失败"。
   */
  status: "pending" | "approved" | "executed" | "expired" | "rejected" | "failed" | "unknown";
  /**
   * 执行结果摘要（只有 executed 之后才有值）：写工具真正做了什么、以及简历文档写入
   * 自动留下的「助手修改前」撤销点版本名。可选：更早存下的历史消息里没有它。
   */
  result_summary?: string;
}

/**
 * 工具参数的安全投影（#13C）：白名单键带值（后端已截到 120 字符），其余键只有名字。
 * 前端工具卡展开后只渲染这份，不直接展示 `arguments` 里的全部字段。
 */
export interface AssistantToolArgPreview {
  key: string;
  /** 白名单键的值；非白名单键没有这个字段。 */
  value?: string;
}

/**
 * 简历文档写操作的结构化预览（#13D）：界面据此显示「旧值 → 新值」与「撤销」。
 * `version_id` 是写前自动留档的命名版本（撤销点）；`before` 为 null 表示新增。
 * 空值/缺省兼容更早存下的历史消息（那时没有这个字段）。
 */
export interface AssistantToolWritePreview {
  before: string | null;
  after: string | null;
  version_id: number | null;
  undo_text: string;
  resume_id: number | null;
  /** 写入之后的简历 revision：撤销时作为条件写的 expected_revision。 */
  revision: number | null;
}

/** 助手调用过一次工具的记录；写在助手消息的 context 里，供历史回看。 */
export interface AssistantToolCall {
  name: string;
  arguments: Record<string, unknown>;
  /** #13C 参数的安全投影；缺省（更早的历史消息）按空数组处理。 */
  args_preview?: AssistantToolArgPreview[];
  /** #13D 简历文档写操作的 diff / 撤销入口；没有就是 null/缺省。 */
  preview?: AssistantToolWritePreview | null;
  summary: string;
  link: string;
  ok: boolean;
  error: string;
  /**
   * 这次调用是否真的改动了用户的数据（后端 `ToolResult.changed`）。
   *
   * 可选是因为它随功能一起加的：更早存下的历史消息里没有这个字段，缺失按"没改动"处理，
   * 不能据此**主动**声称改动过——这类信息只有后端说了才算数。折叠标题里的「改动了 N 项」
   * 就靠它，所以前端不再自己按工具名猜哪些是写操作（猜一份就会与后端漂移）。
   */
  changed?: boolean;
  /**
   * 写入提案（RF-01，可选）：这次调用被转成了待确认提案而没有执行。
   * 更早存下的历史消息里没有这个字段。
   */
  proposal?: AssistantWriteProposal;
}

/**
 * 写操作终态回写的结构化摘要（T01-A）。
 *
 * 后端在每条提案进入终态时补一条 kind=proposal_result 的消息，context 里带这份摘要：
 * 前端据此渲染成一行状态提示（而不是一句普通的助手回复），也能本地化文案。
 */
export interface AssistantProposalResult {
  proposal_id: string;
  tool_name: string;
  status: "executed" | "failed" | "unknown" | "rejected" | "expired";
  target: string;
  summary: string;
}

/** 被引用的那条消息的快照：原消息删掉之后这里仍然可读。 */
export interface AssistantQuotedMessage {
  id: number;
  role: "user" | "assistant";
  excerpt: string;
}

/**
 * 一条用户消息「本轮引用」的岗位/简历（F36）。
 *
 * 与 `AssistantMessage.context` 的同名字段同构：落库消息直接读 context，乐观气泡用
 * 发送瞬间的标签快照（标题暂存在 `job_title` / `resume_title`，`job_company` 缺省）。
 */
export interface AssistantMessageReferences {
  job_id?: number | null;
  job_title?: string;
  job_company?: string;
  resume_id?: number | null;
  resume_title?: string;
}

/** 引用片点击后的跳转目标。 */
export type AssistantReferenceKind = "job" | "resume";

/**
 * 一条用户消息发送时勾选的技能（T24，消息级）。气泡前缀渲染为「使用 X」；
 * 提示词正文不在这里（`context.skill_prompt` 只给模型）。
 */
export interface AssistantMessageSkill {
  id: number;
  name: string;
}

/**
 * 助手这一轮参考过的记忆（T23）：只存 id + 当时的 value 快照。
 *
 * 存快照而不只存 id，是因为记忆可以被改或删——历史消息要能回答"它当时参考了什么"，
 * 不能读回今天的那一行。
 */
export interface AssistantMessageMemory {
  id: number;
  kind: string;
  value: string;
}

export interface AssistantMessage {
  id: number;
  conversation_id: number;
  role: "user" | "assistant";
  content: string;
  /** 引用追问：这条消息引用的是哪一条。 */
  quoted_message_id: number | null;
  attachments: AssistantAttachment[];
  context: {
    job_id?: number | null;
    resume_id?: number | null;
    /**
     * 发送时选中的岗位/简历标题快照（F36）。后端只在查到对象时写入，所以历史消息里可能没有；
     * 有它之后岗位改名/删除也能在气泡里显示当时引用的名字。
     */
    job_title?: string;
    job_company?: string;
    resume_title?: string;
    include_profile?: boolean;
    web_search?: boolean;
    sources?: AssistantSource[];
    /** [来源N] 的「编号 → url」映射（可选：更早存下的历史消息里没有它）。 */
    source_map?: AssistantSourceNumber[];
    tool_calls?: AssistantToolCall[];
    /**
     * 这条**用户消息**发送时勾选了哪些技能（T24，消息级）。只记 id 与名字，提示词正文在
     * `skill_prompt` 里（仅供模型，不进正文）。没勾技能时后端不落这个字段。
     */
    skills?: AssistantMessageSkill[];
    /** 这条用户消息的技能提示词（T24，模型侧注入用）；界面不展示它的正文。 */
    skill_prompt?: string;
    /**
     * 模型的思考过程（开启思考强度时才有），供用户点开查看。
     *
     * 后端对它有存储上限，超限会截断并把 `reasoning_truncated` 置真——界面据此在
     * 结尾补一句"已截断"，不假装这就是全部。可选：更早存下的历史消息里没有它。
     */
    reasoning?: string;
    /** 上面的思考过程是否因超过存储上限被截断。 */
    reasoning_truncated?: boolean;
    quoted?: AssistantQuotedMessage;
    /**
     * #13A 重新生成：这条旧回答被哪条新回答取代。旧消息不会再出现在列表里，
     * 这里只作为后端保留的追溯标记存在。
     */
    superseded_by?: number;
    /** 写操作终态回写的结构化摘要（只有 kind=proposal_result 的消息才有）。 */
    proposal_result?: AssistantProposalResult;
    /**
     * 这一轮落库的上下文用量（需求 #6）。可选：更早存下的历史消息没有它，
     * 那时 `GET /context-usage` 会返回 `partial: true` 的估算值。
     */
    context_usage?: ContextUsage;
    /** T23：这一轮注入的记忆（id + 内容快照）；没有注入时是空数组或缺失。 */
    memories?: AssistantMessageMemory[];
  };
  /** superseded（#13A）：被「重新生成」取代的旧回答，后端过滤后不会下发，仅作类型完整。 */
  status: "pending" | "complete" | "error" | "cancelled" | "superseded";
  /**
   * 消息类别（T01）：normal = 普通对话；proposal_result = 写操作终态的派生回写。
   * 可选：更早存下的历史消息没有这个字段，按 normal 处理。
   */
  kind?: "normal" | "proposal_result";
  /** 派生回写关联的提案 id（普通消息为 null/缺失）。 */
  proposal_id?: string | null;
  error: string;
  model: string;
  created_at: string;
}

/**
 * 旧数据（T24）：会话详情里回显的「旧对话技能」。只有 id 与名字，不含提示词正文。
 * 只用于提示一次「技能已改为只作用于下一条消息」，不参与任何请求。
 */
export interface AssistantLegacySkill {
  id: number;
  name: string;
}

export interface AssistantConversationDetail extends AssistantConversationBrief {
  messages: AssistantMessage[];
  /** 会话消息总数（B5 按需加载：messages 被截断到最新 N 条时也如实给全量数）。可选：旧响应没有。 */
  messages_total?: number;
  /** 是否还有更早的消息未加载（has_earlier=true 时列表顶部出「加载更早」）。可选：旧响应没有。 */
  has_earlier?: boolean;
  /**
   * 压缩状态（T25）：与 `GET /context-usage` 的 compaction 同一份，含摘要正文。
   * 消息流据此在 `covered_until_message_id` 那条消息下方画压缩边界。
   */
  compaction?: ContextCompactionState | null;
  /**
   * 旧数据（T24）：这段对话在「按对话启用技能」时代挂过的技能，只读回显。
   * 有值时消息流顶部给一行可关闭提示；它不参与任何提示词组装。
   */
  legacy_skills?: AssistantLegacySkill[];
}

export interface AssistantAttachmentInput {
  name: string;
  mime_type: string;
  data: string;
}

/**
 * 上下文用量的一个桶（需求 #6）。
 *
 * `key` 是协议值（system / tools / conversation / connectors / skills），**不翻译**：
 * 中文显示名在语言包里按 key 映射（见 `CONTEXT_USAGE_BUCKET_KEYS`）。
 */
export interface ContextUsageBucket {
  key: string;
  /** 估算 token（后端 `estimate_tokens` 口径，不是服务商口径，禁止用于计费）。 */
  tokens: number;
  /** 该桶占上下文窗口的百分比；窗口未设置时是 `null`（不是 0——没有分母就不猜）。 */
  percent: number | null;
}

/**
 * 会话的上下文压缩状态（问题清单 #10）。
 *
 * 与用量一起下发（`ContextUsage.compaction`）：面板在回答「占了多少」的同时要能回答
 * 「压过什么、还能不能还原」——否则用户会以为压缩删了聊天记录（原文从未删除，
 * 只是不再发给模型）。
 */
export interface ContextCompactionState {
  /** 摘要覆盖到哪条消息；之后新增的消息不受影响。 */
  covered_until_message_id: number | null;
  /** 已摘要的轮数（会话累计）。 */
  turns: number;
  tokens_before: number;
  tokens_after: number;
  /** 生成摘要的模型；空 = 跟随当前对话模型。 */
  model: string;
  created_at: string;
  /** 上次遮蔽掉的工具结果条数（L1 的量化结果）。 */
  masked_tool_results: number;
  /** 摘要正文（T25）：与发给模型的是同一份渲染结果，按 4,000 字截断。 */
  summary?: string;
}

/**
 * 「上下文用量」载荷（前端契约，与后端 `ContextUsageOut` 同名同义）。
 *
 * 估算（`total` / 各桶 / `percent`）与实测（`usage_actual`）**不合并、不换算**：
 * 前者来自字符启发式，后者是服务商上一轮真正报告的 `prompt_tokens`。
 */
export interface ContextUsage {
  buckets: ContextUsageBucket[];
  /** 五桶之和（估算）。 */
  total: number;
  /** 百分比分母（当前模型的上下文窗口）；0 = 未设置。 */
  window: number;
  window_source?: "manual" | "reference" | "fallback";
  trigger_tokens?: number;
  default_trigger_tokens?: number;
  percent: number | null;
  /** true = 这条会话的旧消息没落过用量，只有系统提示与对话两桶是估算出来的。 */
  partial: boolean;
  /** 上一轮实测输入 token；`null` = 服务商没报告（显示「本次未报告」）。 */
  usage_actual: number | null;
  /** 压缩状态（#10）；`null` / 缺省 = 这个会话从来没压缩过。 */
  compaction?: ContextCompactionState | null;
}

/**
 * 手动压缩的结果（dry-run 与真跑同一个形状）。
 *
 * `dry_run=true` 时 `percent_after` 是**预估**（摘要块大小按中位值估），界面必须标
 * 「预计」；真跑之后才是实测。
 */
export interface AssistantCompactionResult {
  dry_run: boolean;
  percent_before: number | null;
  percent_after: number | null;
  turns_covered: number;
  tool_results_masked: number;
  model: string;
  created_at: string;
  covered_until_message_id: number | null;
  summary: Record<string, unknown> | null;
  compaction: ContextCompactionState | null;
  /** 没做成时的原因（nothing_to_summarize 等），成功时是空串。 */
  reason: string;
}

/** 五个桶的固定顺序（与后端 `BUCKET_KEYS` 逐字一致）。 */
export const CONTEXT_USAGE_BUCKET_KEYS = [
  "system",
  "tools",
  "conversation",
  "connectors",
  "skills",
] as const;

export type AssistantStreamEvent =
  | {
      type: "start";
      user_message_id: number;
      assistant_message_id: number;
      conversation_title: string;
    }
  | { type: "progress"; message: string }
  | {
      type: "sources";
      sources: AssistantSource[];
      source_map?: AssistantSourceNumber[];
      error: string;
    }
  | ({
      type: "tool";
    } & AssistantToolCall)
  | { type: "write_proposal"; proposal: AssistantWriteProposal }
  | { type: "delta"; text: string }
  | { type: "reasoning"; text: string }
  // 上下文用量（需求 #6）：每轮拼装完下发一次，面板据此显示这一轮真正发出去什么。
  | { type: "context_usage"; usage: ContextUsage }
  // 工具轮次到顶：后端先停下并如实上报轮数，前端据此给「继续」入口（需求 #5）。
  | { type: "round_limit"; rounds: number }
  | { type: "done"; message: AssistantMessage }
  | { type: "error"; message: string; code?: string };
