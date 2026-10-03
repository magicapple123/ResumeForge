/**
 * 网申填表。
 *
 * 状态取值与后端 `services/webform/service.py` 的常量逐字对应。
 */

/** 预览里一条映射的状态。 */
export type WebFormItemStatus = "ready" | "low_confidence" | "conflict";

/** 这条映射是怎么来的。与状态正交：AI 命中的行照样可能是 ready 或 conflict。 */
export type WebFormItemSource = "rule" | "ai";

/** 填充结果。`unverified` = 写下去了但回读对不上，需要用户去窗口里确认。 */
export type WebFormOutcomeStatus = "filled" | "skipped" | "failed" | "conflict" | "unverified";

/** 字段目录里的一条。界面由它驱动渲染——加字段不用改前端。 */
export interface WebFormField {
  key: string;
  label: string;
  group: string;
  kind: string;
  options?: string[];
  sensitive: boolean;
  /**
   * 能不能被自动匹配填进页面。目录字段都是 `true`；用户自己攒的**自定义字段是 `false`**
   * （只有标签一个信号，匹配错了会把值悄悄写进别的框）。
   *
   * 界面据此**不要**对它们承诺"下次自动填"——那是句假话，比不显示更糟。
   */
  matchable?: boolean;
}

export interface WebFormFields {
  fields: WebFormField[];
  groups: string[];
}

/**
 * 「网申资料」：用户专门为网申表单录的补充资料（简历里没有、网申常问的那些）。
 *
 * 字段是 `WebFormField`，但**只有要用户自己录的那批**——从简历资料取值的字段（姓名、学校…）
 * 不在其中，所以界面不会把它们渲染成这一区的输入框。
 */
/** 「网申资料」里一条的来源与档位。 */
export interface WebFormExtraEntry {
  value: string;
  /** manual=你自己录的；learned=填表时学到的（程序推断，界面要标出来）。 */
  source: "manual" | "learned";
  /** general=换哪家都成立；scenario=和投递渠道有关；once=只记不填。 */
  reuse: "general" | "scenario" | "once";
  /**
   * 界面上的字段名。空串表示"从目录取名"（后端回落到字段目录）。
   *
   * 自定义字段（清单外的，如「导师姓名」）靠它显示——否则界面上是一串 `CUSTOM_导师姓名`。
   */
  label?: string;
}

export interface WebFormRepeatedField {
  key: string;
  label: string;
  kind: string;
  options?: string[];
  sensitive: boolean;
}

export interface WebFormRepeatedRecord {
  id?: number;
  values: Record<string, string>;
}

export interface WebFormRepeatedGroup {
  key: string;
  label: string;
  family: string;
  fields: WebFormRepeatedField[];
  records: WebFormRepeatedRecord[];
}

export interface WebFormExtraProfile {
  fields: WebFormField[];
  groups: string[];
  /** 只含有值的项：没有这一项与"这一项是空的"在这里是同一件事。 */
  values: Record<string, string>;
  /** 与 `values` 同键的来源与档位。 */
  details: Record<string, WebFormExtraEntry>;
  /** 可以新增多条的网申补充资料组。 */
  repeated_groups: WebFormRepeatedGroup[];
}

/** 填表时发现的、简历通里没有的一条。 */
export interface WebFormLearningCandidate {
  key: string;
  label: string;
  value: string;
  /** `ai` 的要比 `rule` 更醒目：它更可能认错字段。 */
  from: "rule" | "ai";
}

export interface WebFormPage {
  url: string;
  title: string;
  control_count: number;
}

export interface WebFormUrlHistory {
  id: number;
  url: string;
  title: string;
  last_used_at: string;
}

export interface WebFormUrlHistoryList {
  items: WebFormUrlHistory[];
}

export interface WebFormBrowserTarget {
  target_id: string;
  url: string;
  title?: string;
  live_enabled: boolean;
}

export interface WebFormBrowserTargetList {
  items: WebFormBrowserTarget[];
}

export interface WebFormSnapshot {
  snapshot_id: string;
  page: WebFormPage;
}

export interface WebFormSelectOption {
  value: string;
  text: string;
}

export interface WebFormPreviewItem {
  index: number;
  field: string;
  field_label: string;
  value: string;
  control_label: string;
  control_type: string;
  status: WebFormItemStatus;
  /** 规则给的还是模型给的。`ai` 的行**默认不勾选**，界面上打「AI 建议」标签。 */
  source: WebFormItemSource;
  current_value: string;
  options: WebFormSelectOption[];
  note: string;
}

/** 页面要求、但这一轮不会自动填的控件。 */
export interface WebFormPendingItem {
  index: number;
  label: string;
  required: boolean;
  field: string;
  field_label: string;
}

export interface WebFormPreview {
  snapshot_id: string;
  page: WebFormPage;
  items: WebFormPreviewItem[];
  /** 认得出字段但资料为空。 */
  missing_data: WebFormPendingItem[];
  /** 认不出的控件。 */
  unrecognized: WebFormPendingItem[];
  /** 永不自动填的（验证码 / 简历附件 / 他人信息）。 */
  blocked: WebFormPendingItem[];
  /** 默认勾选的下标（冲突项不在其中）。 */
  default_indexes: number[];
  /** 这次填充里"简历通里没有"的那些，填完问用户要不要记下来。 */
  learning: { candidates: WebFormLearningCandidate[] };
}

/** 主推之外的其他候选（目前只有 AI 拿不准时会给）。 */
export interface WebFormLiveAlternative {
  label: string;
  value: string;
}

export interface WebFormRememberPending {
  field_key: string;
  field_label: string;
  value: string;
  control_label: string;
  source: "rule" | "ai" | string;
}

export interface WebFormMemoryTarget {
  target_id: string;
  /**
   * 落点所在那一区。**恒为 `extra`（网申资料）**——「记住这条」写不进简历资料。
   *
   * 以前这里还有 `profile`（我的资料），也就是按一下就能改简历里的字段；简历会被生成进
   * 简历正文，所以 2026-09-28 收掉了。类型收窄成字面量而不是 `string`，是为了让"又冒出
   * 一种落点"在编译期就撞墙，而不是悄悄渲染出来。
   */
  source: "extra";
  group: string;
  label: string;
  value: string;
  kind: string;
  field_key: string;
}

export interface WebFormMemoryTargets {
  targets: WebFormMemoryTarget[];
}

export type WebFormMemoryReuse = "general" | "scenario" | "once";

export interface WebFormRememberInput {
  target_id: string;
  value: string;
  label?: string;
  reuse: WebFormMemoryReuse;
}

/** 智能逐项填表模式的当前状态。 */
export interface WebFormLive {
  running: boolean;
  /** 监听会话仍在运行时，智能逐项填表是否开启；旧后端缺字段时按 running 兼容。 */
  enabled?: boolean;
  field_label: string;
  value: string;
  status:
    "" | "thinking" | "ai_thinking" | "matched" | "blocked" | "unmatched" | "filled" | "failed";
  note: string;
  /** 这条建议是规则给的还是模型给的。空串表示还没有建议（或已填完）。 */
  source: "" | "rule" | "ai";
  /** 主推之外的候选，按把握从大到小。**不含主推那一条**（它在 field_label/value 里）。 */
  alternatives: WebFormLiveAlternative[];
  /** 这次会话里已经填了几个框。 */
  filled: number;
  /** 点「记住这条」后，等待用户选择写入哪个资料目标。 */
  remember_pending: WebFormRememberPending | null;
}

export interface WebFormFillItem {
  index: number;
  field: string;
  value: string;
}

export interface WebFormOutcome {
  index: number;
  field: string;
  status: WebFormOutcomeStatus;
  detail: string;
}

export interface WebFormFillResult {
  outcomes: WebFormOutcome[];
  filled: number;
  unverified: number;
  failed: number;
  /** 页面中可安全读取的可见表单控件总数。旧记录可能没有这两个字段。 */
  form_control_total?: number;
  /** 本次识别并实际尝试写入的控件数。 */
  recognized_total?: number;
}

/** 一次填充是批量还是实时（点哪个填哪个）。 */
export type WebFormRecordSource = "batch" | "live";

/** 记录里的一条：当时填的是哪个框、认成什么字段、写了什么值、成没成。 */
export interface WebFormRecordItem {
  index: number;
  field: string;
  field_label: string;
  control_label: string;
  value: string;
  /** filled | unverified | failed | skipped | conflict */
  status: string;
  detail: string;
  source: string;
}

/** 填完后那个控件的可读快照。`filled` = 这一轮是不是我们填的。 */
export interface WebFormRecordSnapshot {
  index: number;
  label: string;
  value: string;
  filled: boolean;
}

/** 一条填充记录（列表与详情共用，详情里 items/page_snapshot 才非空）。 */
export interface WebFormFillRecord {
  id: number;
  url: string;
  page_title: string;
  filled: number;
  unverified: number;
  failed: number;
  source: WebFormRecordSource;
  created_at: string;
  items: WebFormRecordItem[];
  page_snapshot: WebFormRecordSnapshot[];
}
