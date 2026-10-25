// SPDX-License-Identifier: Apache-2.0
/**
 * 补充事实的契约类型：九类受限事实的 payload、自定义字段与字段设置 schema。
 *
 * 唯一真相是后端契约
 * （deliverables/software-company/resumeforge-facts-flexibility-contract-20261025.md §1-4）。
 * 这里**逐字段照抄**：字段名、枚举值、列表结构都不做翻译或重命名——界面上的中文名
 * 一律在小标题/占位符里，不污染契约键。
 *
 * 为什么 payload 全部 extra="forbid"：多传一个键就是 422、静默忽略会让用户以为存上了。
 * 因此保存时统一发送**完整字段集**（含 custom_fields 值快照）。
 */

/** 九类受支持的补充事实（顺序 = 界面分组顺序 = 后端 PROFILE_FACT_KINDS）。 */
export type FactKind =
  | "publication"
  | "research_project"
  | "patent"
  | "credential"
  | "work_project"
  | "practice"
  | "award"
  | "training"
  | "language";

/** 论文发表状态。`in_press` 是「排版中」，`under_review` 是「在投」——都不是已发表。 */
export type PublicationStatus =
  "published" | "accepted" | "in_press" | "under_review" | "preprint" | "other";

/** 专利状态。`filed` 是已申请，不等于已授权。 */
export type PatentStatus = "filed" | "pending" | "granted" | "expired" | "other";

/** 资格证照状态：由用户自己填写，系统不自动认定资格。 */
export type CredentialStatus = "unknown" | "pending" | "active" | "expired";

/** 实践/服务经历的关系类型（与作品项目、旧工作经历区分：这里明确记录雇佣/合作关系）。 */
export type PracticeKind =
  | "unset"
  | "full_time"
  | "part_time"
  | "contract"
  | "self_employed"
  | "internship"
  | "volunteer"
  | "other";

/** 作者/发明人一行：顺序即署名顺序，`is_self` 标记本人，`corresponding` 标记通讯作者。 */
export interface FactPerson {
  name: string;
  is_self: boolean;
  corresponding: boolean;
}

/**
 * 自定义字段的**值快照**（存进事实 payload）：key 稳定、label 是保存那一刻的显示名、
 * value 可空。删除字段定义后值仍留在 payload（本地数据不删），只是界面/AI 不再使用。
 */
export interface FactCustomField {
  key: string;
  label: string;
  value: string;
}

/** 字段设置里的自定义字段定义：key 由服务端生成（新增时省略），label 1–40 字。 */
export interface FactCustomFieldDef {
  key: string;
  label: string;
}

/** PUT 字段设置时提交的自定义字段：新增项不带 key，由服务端生成 `cf_ + 12 位 hex`。 */
export interface FactCustomFieldInput {
  key?: string;
  label: string;
}

/** 论文：标题、作者顺序、刊物、年份、状态、DOI、链接、卷期页码、备注。 */
export interface PublicationPayload {
  title: string;
  authors: FactPerson[];
  venue: string;
  year: string;
  status: PublicationStatus;
  doi: string;
  url: string;
  volume_pages: string;
  note: string;
  custom_fields: FactCustomField[];
}

/** 科研项目：名称、角色、机构、起止、经费事实、贡献与成果（每行一条）。 */
export interface ResearchProjectPayload {
  name: string;
  role: string;
  organization: string;
  start_date: string;
  end_date: string;
  funding: string;
  description: string[];
  outcomes: string[];
  custom_fields: FactCustomField[];
}

/** 专利：标题、发明人顺序、专利号、国家/地区、状态、申请/授权日期、链接。 */
export interface PatentPayload {
  title: string;
  inventors: FactPerson[];
  patent_number: string;
  country: string;
  status: PatentStatus;
  filed_date: string;
  granted_date: string;
  url: string;
  custom_fields: FactCustomField[];
}

/** 资格证照：证号是本地私密字段，默认不外发、不印到简历。 */
export interface CredentialPayload {
  name: string;
  issuer: string;
  issue_date: string;
  expiry_date: string;
  status: CredentialStatus;
  credential_number: string;
  verify_url: string;
  note: string;
  custom_fields: FactCustomField[];
}

/** 作品项目：公开链接 + 成果类型 + 工具与方法 + 贡献/亮点。 */
export interface WorkProjectPayload {
  name: string;
  role: string;
  start_date: string;
  end_date: string;
  tech_stack: string[];
  description: string[];
  highlights: string[];
  public_url: string;
  artifact_type: string;
  custom_fields: FactCustomField[];
}

/** 实践/服务经历：机构或客户（中性称谓）、关系类型、角色、日期、贡献。 */
export interface PracticePayload {
  organization: string;
  role: string;
  experience_kind: PracticeKind;
  start_date: string;
  end_date: string;
  description: string[];
  custom_fields: FactCustomField[];
}

/** 荣誉与获奖：名称、颁发机构、时间、级别、说明（契约 §1 award）。 */
export interface AwardPayload {
  name: string;
  issuer: string;
  date: string;
  level: string;
  description: string;
  custom_fields: FactCustomField[];
}

/** 培训与课程：名称、机构、起止、学时、内容与收获（每行一条，契约 §1 training）。 */
export interface TrainingPayload {
  name: string;
  organization: string;
  start_date: string;
  end_date: string;
  hours: string;
  description: string[];
  outcomes: string[];
  custom_fields: FactCustomField[];
}

/** 语言能力：语言、水平、证书、分数、取得时间（契约 §1 language）。 */
export interface LanguagePayload {
  name: string;
  level: string;
  certificate: string;
  score: string;
  date: string;
  custom_fields: FactCustomField[];
}

/** kind → payload 的映射，供 `ProfileFact` 的可判别联合使用。 */
export interface FactPayloadByKind {
  publication: PublicationPayload;
  research_project: ResearchProjectPayload;
  patent: PatentPayload;
  credential: CredentialPayload;
  work_project: WorkProjectPayload;
  practice: PracticePayload;
  award: AwardPayload;
  training: TrainingPayload;
  language: LanguagePayload;
}

/** payload 的联合类型（保存/默认值转换用）；按 kind 收窄时请用 `ProfileFact`。 */
export type FactPayload = FactPayloadByKind[FactKind];

/** 单条事实的公共字段（后端 `ProfileFactOut`）。 */
interface FactRecordBase {
  fact_id: string;
  schema_version: number;
  revision: number;
  sort_order: number;
  created_at: string;
  updated_at: string | null;
  deleted_at: string | null;
}

/** 一条补充事实：`kind` 与 `payload` 一一对应，可按 `kind` 收窄。 */
export type ProfileFact = {
  [K in FactKind]: FactRecordBase & { kind: K; payload: FactPayloadByKind[K] };
}[FactKind];

/** 收窄到某一类事实（测试夹具、按类渲染时用）。 */
export type ProfileFactOf<K extends FactKind> = Extract<ProfileFact, { kind: K }>;

/** GET /api/profile/facts 的响应：`total` 是过滤后的总数，`items` 受 limit 限制。 */
export interface ProfileFactList {
  items: ProfileFact[];
  total: number;
}

/** 新建一条事实的请求体。`sort_order` 由前端按已有最大值 +1，保持追加顺序。 */
export interface ProfileFactCreate {
  kind: FactKind;
  payload: FactPayload;
  sort_order?: number;
}

/** 条件更新：`expected_revision` 与服务端不一致时后端返回 409（不静默覆盖）。 */
export interface ProfileFactUpdate {
  payload?: FactPayload;
  sort_order?: number;
  expected_revision?: number;
}

/**
 * 单一类型的字段设置。缺失 prefs 行时服务端返回全默认（hidden 空、custom 空）。
 * `default_fields` 是后端 schema 的唯一真相（含顺序），前端只负责给它配中文标签。
 */
export interface ProfileFactKindSchema {
  kind: FactKind;
  revision: number;
  default_fields: string[];
  hidden_fields: string[];
  custom_fields: FactCustomFieldDef[];
  max_custom_fields: number;
}

/** GET /api/profile/facts/schema 的响应。 */
export interface ProfileFactSchema {
  kinds: ProfileFactKindSchema[];
  max_custom_field_value_chars: number;
}

/**
 * PUT / reset 的响应：契约写"返回完整 schema"。为兼容后端两种合理实现（整份 / 单类），
 * API 层用 `normalizeSchemaResponse` 归一化，调用方只看见 `ProfileFactSchema`。
 */
export type ProfileFactSchemaResponse = ProfileFactSchema | ProfileFactKindSchema;

/** PUT /api/profile/facts/schema/{kind} 请求体；新增自定义字段省略 key。 */
export interface ProfileFactKindSchemaUpdate {
  hidden_fields: string[];
  custom_fields: FactCustomFieldInput[];
  expected_revision: number;
}

/** POST /api/profile/facts/schema/{kind}/reset 请求体。 */
export interface ProfileFactSchemaReset {
  expected_revision: number;
}
