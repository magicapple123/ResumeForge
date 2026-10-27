// SPDX-License-Identifier: Apache-2.0
/**
 * 事实台账枚举的显示名映射（分类 / 核实状态 / 承担程度 / 证据来源）。
 *
 * **键是协议值**：`types/claim.ts` 里的中文枚举本身就是提交给后端并参与校验的取值，
 * 翻译它们会写坏数据。这里只把"协议值 -> 语言包 key"这一层集中起来，`types` 表一个字
 * 都没动；组件在渲染期再 `t(...)`，所以切换语言会跟着重渲染。
 *
 * 模块作用域不能求值 `t()`（语言会被钉死），因此本文件只放 key 表与纯查表函数。
 *
 * 中文键上的 `// i18n-ok:` 是 CJK 棘轮要求：这些是后端协议值，永远不该翻，也不上屏；
 * 显示名在 `i18n/messages/{zh-CN,en-US}.enumsClaims.ts`。
 */
import type { MessageKey } from "../index";
import type {
  ClaimCategory,
  ResponsibilityLevel,
  SourceType,
  VerificationStatus,
} from "../../types";

export const CLAIM_CATEGORY_LABEL_KEYS: Record<ClaimCategory, MessageKey> = {
  教育经历: "enumsClaims.category.education", // i18n-ok: 协议值（中文枚举），仅作查询键
  "实习/工作": "enumsClaims.category.internship", // i18n-ok: 协议值（中文枚举），仅作查询键
  项目经历: "enumsClaims.category.project", // i18n-ok: 协议值（中文枚举），仅作查询键
  校园经历: "enumsClaims.category.campus", // i18n-ok: 协议值（中文枚举），仅作查询键
  专业技能: "enumsClaims.category.skills", // i18n-ok: 协议值（中文枚举），仅作查询键
  荣誉奖项: "enumsClaims.category.awards", // i18n-ok: 协议值（中文枚举），仅作查询键
  其他: "enumsClaims.category.other", // i18n-ok: 协议值（中文枚举），仅作查询键
};

export const VERIFICATION_STATUS_LABEL_KEYS: Record<VerificationStatus, MessageKey> = {
  已确认: "enumsClaims.status.confirmed", // i18n-ok: 协议值（中文枚举），仅作查询键
  待确认: "enumsClaims.status.pending", // i18n-ok: 协议值（中文枚举），仅作查询键
  已过期: "enumsClaims.status.expired", // i18n-ok: 协议值（中文枚举），仅作查询键
  不采用: "enumsClaims.status.rejected", // i18n-ok: 协议值（中文枚举），仅作查询键
};

/** 核实状态的一句解释，表单下拉里与状态名拼成「已确认——可以作为事实写进正式简历」。 */
export const VERIFICATION_STATUS_HINT_KEYS: Record<VerificationStatus, MessageKey> = {
  已确认: "enumsClaims.statusHint.confirmed", // i18n-ok: 协议值（中文枚举），仅作查询键
  待确认: "enumsClaims.statusHint.pending", // i18n-ok: 协议值（中文枚举），仅作查询键
  已过期: "enumsClaims.statusHint.expired", // i18n-ok: 协议值（中文枚举），仅作查询键
  不采用: "enumsClaims.statusHint.rejected", // i18n-ok: 协议值（中文枚举），仅作查询键
};

export const RESPONSIBILITY_LEVEL_LABEL_KEYS: Record<ResponsibilityLevel, MessageKey> = {
  参与: "enumsClaims.responsibility.participate", // i18n-ok: 协议值（中文枚举），仅作查询键
  负责模块: "enumsClaims.responsibility.ownModule", // i18n-ok: 协议值（中文枚举），仅作查询键
  主导方案或交付: "enumsClaims.responsibility.leadDelivery", // i18n-ok: 协议值（中文枚举），仅作查询键
  项目负责人: "enumsClaims.responsibility.owner", // i18n-ok: 协议值（中文枚举），仅作查询键
};

/** 承担程度的解释，与状态提示同一套「名称——解释」呈现。 */
export const RESPONSIBILITY_LEVEL_HINT_KEYS: Record<ResponsibilityLevel, MessageKey> = {
  参与: "enumsClaims.responsibilityHint.participate", // i18n-ok: 协议值（中文枚举），仅作查询键
  负责模块: "enumsClaims.responsibilityHint.ownModule", // i18n-ok: 协议值（中文枚举），仅作查询键
  主导方案或交付: "enumsClaims.responsibilityHint.leadDelivery", // i18n-ok: 协议值（中文枚举），仅作查询键
  项目负责人: "enumsClaims.responsibilityHint.owner", // i18n-ok: 协议值（中文枚举），仅作查询键
};

export const SOURCE_TYPE_LABEL_KEYS: Record<SourceType, MessageKey> = {
  pull_request: "enumsClaims.source.pullRequest",
  repository: "enumsClaims.source.repository",
  document: "enumsClaims.source.document",
  certificate: "enumsClaims.source.certificate",
  link: "enumsClaims.source.link",
  screenshot: "enumsClaims.source.screenshot",
  reference: "enumsClaims.source.reference",
  other: "enumsClaims.source.other",
};

/**
 * 只认自己的键：原型链上的 `constructor` / `__proto__` 不能变成显示名
 * （与 `claimPresentation.ownColor` 同一条防御）。
 */
function lookup<K extends string>(
  labels: Record<K, MessageKey>,
  value: string,
): MessageKey | undefined {
  return Object.prototype.hasOwnProperty.call(labels, value) ? labels[value as K] : undefined;
}

/** 未知取值返回 `undefined`，调用方回退成后端下发的原值（不丢信息）。 */
export function claimCategoryLabelKey(value: string): MessageKey | undefined {
  return lookup(CLAIM_CATEGORY_LABEL_KEYS, value);
}

export function claimStatusLabelKey(value: string): MessageKey | undefined {
  return lookup(VERIFICATION_STATUS_LABEL_KEYS, value);
}

export function claimResponsibilityLabelKey(value: string): MessageKey | undefined {
  return lookup(RESPONSIBILITY_LEVEL_LABEL_KEYS, value);
}

export function claimSourceTypeLabelKey(value: string): MessageKey | undefined {
  return lookup(SOURCE_TYPE_LABEL_KEYS, value);
}
