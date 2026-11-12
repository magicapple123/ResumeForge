// SPDX-License-Identifier: Apache-2.0
/**
 * 台账表单的取值模型与「界面值 ↔ 提交值」转换。
 *
 * 从 ClaimFormModal 拆出来（清单 §20.8 的预算提醒）：表单已经 456/500 行，再往里面塞
 * 「关联资料条目」必然顶破预算。拆分的边界是"字段组"：本文件只放类型与纯转换函数，
 * 每个字段组组件各自渲染自己那一块，主弹窗只留编排。
 */
import type { Claim, ClaimPayload, ClaimSource } from "../../../types";
import { emptyClaim } from "../../../types";

export interface FormValues {
  title: string;
  category: string;
  subject: string;
  source_fact: string;
  candidate_wording: string;
  entry_ids: string[];
  responsibility_level: string;
  verification_status: string;
  boundary: string;
  last_verified: string;
  allowed_uses: string[];
  risk_notes: string[];
  sources: ClaimSource[];
  decisions: string;
  difficulties: string;
  verification: string;
  result: string;
}

export const EMPTY_VALUES: FormValues = {
  title: "",
  category: "项目经历", // i18n-ok: 协议值（提交后端并参与校验），不是显示文案
  subject: "",
  source_fact: "",
  candidate_wording: "",
  entry_ids: [],
  responsibility_level: "参与", // i18n-ok: 协议值
  verification_status: "待确认", // i18n-ok: 协议值
  boundary: "",
  last_verified: "",
  allowed_uses: [],
  risk_notes: [],
  sources: [],
  decisions: "",
  difficulties: "",
  verification: "",
  result: "",
};

/** 多行文本 ↔ 字符串数组。空行丢掉，顺序保留。 */
export function linesToText(lines: string[] | undefined): string {
  return (lines ?? []).join("\n");
}

export function textToLines(text: string | undefined): string[] {
  return (text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function toValues(claim: Claim): FormValues {
  const details = claim.interview_details ?? {};
  return {
    ...EMPTY_VALUES,
    title: claim.title,
    category: claim.category,
    subject: claim.subject,
    source_fact: claim.source_fact,
    candidate_wording: claim.candidate_wording,
    entry_ids: claim.entry_ids ?? [],
    responsibility_level: claim.responsibility_level,
    verification_status: claim.verification_status,
    boundary: claim.boundary,
    last_verified: claim.last_verified,
    allowed_uses: claim.allowed_uses,
    risk_notes: claim.risk_notes,
    sources: claim.sources,
    decisions: linesToText(details.decisions),
    difficulties: linesToText(details.difficulties),
    verification: linesToText(details.verification),
    result: details.result ?? "",
  };
}

export function toPayload(values: FormValues): ClaimPayload {
  return {
    ...emptyClaim(),
    title: values.title.trim(),
    category: values.category as ClaimPayload["category"],
    subject: values.subject.trim(),
    source_fact: values.source_fact.trim(),
    candidate_wording: values.candidate_wording.trim(),
    entry_ids: values.entry_ids ?? [],
    responsibility_level: values.responsibility_level as ClaimPayload["responsibility_level"],
    verification_status: values.verification_status as ClaimPayload["verification_status"],
    boundary: values.boundary.trim(),
    last_verified: values.last_verified.trim(),
    allowed_uses: values.allowed_uses ?? [],
    risk_notes: values.risk_notes ?? [],
    sources: (values.sources ?? []).map((source) => ({
      type: source.type,
      location: (source.location ?? "").trim(),
      public: Boolean(source.public),
      note: (source.note ?? "").trim(),
    })),
    interview_details: {
      decisions: textToLines(values.decisions),
      difficulties: textToLines(values.difficulties),
      verification: textToLines(values.verification),
      result: values.result.trim() || null,
    },
  };
}
