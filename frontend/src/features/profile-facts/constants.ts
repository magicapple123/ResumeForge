// SPDX-License-Identifier: Apache-2.0
/**
 * 九类事实的界面常量：分组顺序、名称文案 key、状态枚举的展示顺序与徽标颜色。
 *
 * 状态取值来自后端契约（`schemas/profile_facts.py`），这里的顺序就是下拉框的展示
 * 顺序——「已发表」不会排在「在投」前面制造暗示，但用户本来选过的值原样保留。
 */
import type { MessageKey } from "../../i18n";
import type {
  CredentialStatus,
  FactKind,
  PatentStatus,
  PracticeKind,
  PublicationStatus,
} from "./types";

/** 分组与新建菜单的顺序：科研 → 证照 → 作品/实践 → 获奖/培训/语言（契约 §1 固定顺序）。 */
export const FACT_KINDS: readonly FactKind[] = [
  "publication",
  "research_project",
  "patent",
  "credential",
  "work_project",
  "practice",
  "award",
  "training",
  "language",
];

/** 单数实体名。按钮/标题用 `{label}` 插值，避免每处各写一份中文。 */
export const FACT_KIND_LABEL_KEYS: Record<FactKind, MessageKey> = {
  publication: "profileFacts.kind.publication",
  research_project: "profileFacts.kind.research_project",
  patent: "profileFacts.kind.patent",
  credential: "profileFacts.kind.credential",
  work_project: "profileFacts.kind.work_project",
  practice: "profileFacts.kind.practice",
  award: "profileFacts.kind.award",
  training: "profileFacts.kind.training",
  language: "profileFacts.kind.language",
};

/** 每类一条的保存按钮文案（动词 + 对象，具体到这一类）。 */
export const FACT_SAVE_LABEL_KEYS: Record<FactKind, MessageKey> = {
  publication: "profileFacts.editor.save.publication",
  research_project: "profileFacts.editor.save.research_project",
  patent: "profileFacts.editor.save.patent",
  credential: "profileFacts.editor.save.credential",
  work_project: "profileFacts.editor.save.work_project",
  practice: "profileFacts.editor.save.practice",
  award: "profileFacts.editor.save.award",
  training: "profileFacts.editor.save.training",
  language: "profileFacts.editor.save.language",
};

export interface FactStatusOption<T extends string> {
  value: T;
  labelKey: MessageKey;
}

/**
 * 论文状态。复用科研板块（W14）已有的 `research.status.*` 文案，避免同一状态
 * 在「我的资料」和制作台出现两种叫法。
 */
export const PUBLICATION_STATUS_OPTIONS: readonly FactStatusOption<PublicationStatus>[] = [
  { value: "published", labelKey: "research.status.published" },
  { value: "accepted", labelKey: "research.status.accepted" },
  { value: "in_press", labelKey: "research.status.in_press" },
  { value: "under_review", labelKey: "research.status.under_review" },
  { value: "preprint", labelKey: "research.status.preprint" },
  { value: "other", labelKey: "research.status.other" },
];

/** 专利状态：`filed`/`pending` 都不是授权，徽标颜色按同一口径区分。 */
export const PATENT_STATUS_OPTIONS: readonly FactStatusOption<PatentStatus>[] = [
  { value: "filed", labelKey: "research.patentStatus.filed" },
  { value: "pending", labelKey: "research.patentStatus.pending" },
  { value: "granted", labelKey: "research.patentStatus.granted" },
  { value: "expired", labelKey: "research.patentStatus.expired" },
  { value: "other", labelKey: "research.patentStatus.other" },
];

/** 资格证照状态：unknown/pending/active/expired；不出现"证书=有效资格"的断言。 */
export const CREDENTIAL_STATUS_OPTIONS: readonly FactStatusOption<CredentialStatus>[] = [
  { value: "unknown", labelKey: "profileFacts.credentialStatus.unknown" },
  { value: "pending", labelKey: "profileFacts.credentialStatus.pending" },
  { value: "active", labelKey: "profileFacts.credentialStatus.active" },
  { value: "expired", labelKey: "profileFacts.credentialStatus.expired" },
];

/** 实践/服务经历的关系类型（机构或客户是中性称谓，只有用户显式选择才记录关系）。 */
export const PRACTICE_KIND_OPTIONS: readonly FactStatusOption<PracticeKind>[] = [
  { value: "unset", labelKey: "profileFacts.experienceKind.unset" },
  { value: "full_time", labelKey: "profileFacts.experienceKind.full_time" },
  { value: "part_time", labelKey: "profileFacts.experienceKind.part_time" },
  { value: "contract", labelKey: "profileFacts.experienceKind.contract" },
  { value: "self_employed", labelKey: "profileFacts.experienceKind.self_employed" },
  { value: "internship", labelKey: "profileFacts.experienceKind.internship" },
  { value: "volunteer", labelKey: "profileFacts.experienceKind.volunteer" },
  { value: "other", labelKey: "profileFacts.experienceKind.other" },
];

/** 状态徽标的 antd 预设色：只用语义色（绿=已完成、金=待定、红=失效），不新增 token。 */
const PUBLICATION_STATUS_COLORS: Record<PublicationStatus, string | undefined> = {
  published: "green",
  accepted: "cyan",
  in_press: "blue",
  under_review: "gold",
  preprint: "purple",
  other: undefined,
};

const PATENT_STATUS_COLORS: Record<PatentStatus, string | undefined> = {
  filed: "blue",
  pending: "gold",
  granted: "green",
  expired: "red",
  other: undefined,
};

const CREDENTIAL_STATUS_COLORS: Record<CredentialStatus, string | undefined> = {
  unknown: undefined,
  pending: "gold",
  active: "green",
  expired: "red",
};

function labelKeysOf<T extends string>(
  options: readonly FactStatusOption<T>[],
): Record<T, MessageKey> {
  const result = {} as Record<T, MessageKey>;
  for (const option of options) result[option.value] = option.labelKey;
  return result;
}

export const PUBLICATION_STATUS_LABEL_KEYS = labelKeysOf(PUBLICATION_STATUS_OPTIONS);
export const PATENT_STATUS_LABEL_KEYS = labelKeysOf(PATENT_STATUS_OPTIONS);
export const CREDENTIAL_STATUS_LABEL_KEYS = labelKeysOf(CREDENTIAL_STATUS_OPTIONS);
export const PRACTICE_KIND_LABEL_KEYS = labelKeysOf(PRACTICE_KIND_OPTIONS);

export function publicationStatusColor(status: PublicationStatus): string | undefined {
  return PUBLICATION_STATUS_COLORS[status];
}

export function patentStatusColor(status: PatentStatus): string | undefined {
  return PATENT_STATUS_COLORS[status];
}

export function credentialStatusColor(status: CredentialStatus): string | undefined {
  return CREDENTIAL_STATUS_COLORS[status];
}
