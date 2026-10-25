// SPDX-License-Identifier: Apache-2.0
/**
 * 补充事实的展示摘要（纯函数）：列表标题、副标题、状态徽标与自定义字段行。
 *
 * 从 `factModel.ts` 拆出（2026-10）：那个文件负责"表单 ↔ payload"的写入边界，这里只负责
 * "怎么显示一条事实"。两者改动的理由不同，放一起会让任一改动都要读完整份文件。
 *
 * **隐藏字段不展示**：字段设置里被隐藏的默认字段（contract §3）在列表里也不能出现——
 * 否则"界面不渲染"只做到了编辑器。调用方把该类型的 `hidden_fields` 传进来。
 *
 * 标题/副标题只拼用户自己的值：不补「暂无」「未知」，也不推断状态——论文状态、专利状态、
 * 资格状态都来自用户选择的枚举值，徽标只是把它翻译成中文。
 */
import { t } from "../../i18n";
import type { MessageKey } from "../../i18n";
import {
  CREDENTIAL_STATUS_LABEL_KEYS,
  PATENT_STATUS_LABEL_KEYS,
  PRACTICE_KIND_LABEL_KEYS,
  PUBLICATION_STATUS_LABEL_KEYS,
  credentialStatusColor,
  patentStatusColor,
  publicationStatusColor,
} from "./constants";
import type { FactCustomFieldDef, ProfileFact } from "./types";

type HiddenFields = readonly string[];

function hiddenKey(hidden: HiddenFields, key: string): boolean {
  return hidden.includes(key);
}

/** 列表标题：优先用用户填的主体名称；主体字段被隐藏时也不能把它显示出来。 */
export function factTitle(fact: ProfileFact, hidden: HiddenFields = []): string {
  switch (fact.kind) {
    case "publication":
      return hiddenKey(hidden, "title") ? "" : fact.payload.title.trim();
    case "research_project":
      return hiddenKey(hidden, "name") ? "" : fact.payload.name.trim();
    case "patent":
      return hiddenKey(hidden, "title") ? "" : fact.payload.title.trim();
    case "credential":
      return hiddenKey(hidden, "name") ? "" : fact.payload.name.trim();
    case "work_project":
      return hiddenKey(hidden, "name") ? "" : fact.payload.name.trim();
    case "practice":
      return hiddenKey(hidden, "organization") ? "" : fact.payload.organization.trim();
    case "award":
      return hiddenKey(hidden, "name") ? "" : fact.payload.name.trim();
    case "training":
      return hiddenKey(hidden, "name") ? "" : fact.payload.name.trim();
    case "language":
      return hiddenKey(hidden, "name") ? "" : fact.payload.name.trim();
  }
}

function dateRange(start: string, end: string): string {
  if (start && end) return `${start} – ${end}`;
  return start || end;
}

/** 列表副标题：只拼用户已有的、且没被隐藏的值。 */
export function factSecondary(fact: ProfileFact, hidden: HiddenFields = []): string {
  const parts: string[] = [];
  const push = (key: string, ...values: string[]) => {
    if (!hiddenKey(hidden, key)) parts.push(...values);
  };
  switch (fact.kind) {
    case "publication":
      push("venue", fact.payload.venue);
      push("year", fact.payload.year);
      break;
    case "research_project":
      push("role", fact.payload.role);
      push("organization", fact.payload.organization);
      break;
    case "patent":
      push("country", fact.payload.country);
      push("patent_number", fact.payload.patent_number);
      break;
    case "credential":
      push("issuer", fact.payload.issuer);
      break;
    case "work_project":
      push("role", fact.payload.role);
      push(
        "start_date",
        dateRange(
          hiddenKey(hidden, "start_date") ? "" : fact.payload.start_date,
          hiddenKey(hidden, "end_date") ? "" : fact.payload.end_date,
        ),
      );
      break;
    case "practice":
      push("role", fact.payload.role);
      push(
        "start_date",
        dateRange(
          hiddenKey(hidden, "start_date") ? "" : fact.payload.start_date,
          hiddenKey(hidden, "end_date") ? "" : fact.payload.end_date,
        ),
      );
      break;
    case "award":
      push("issuer", fact.payload.issuer);
      push("date", fact.payload.date);
      break;
    case "training":
      push("organization", fact.payload.organization);
      push(
        "start_date",
        dateRange(
          hiddenKey(hidden, "start_date") ? "" : fact.payload.start_date,
          hiddenKey(hidden, "end_date") ? "" : fact.payload.end_date,
        ),
      );
      break;
    case "language":
      push("certificate", fact.payload.certificate);
      push("score", fact.payload.score);
      push("date", fact.payload.date);
      break;
  }
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" · ");
}

/** 行内徽标：状态类取 i18n key，用户自定义文本（级别/学时/成果类型）原样展示。 */
export interface FactBadge {
  labelKey?: MessageKey;
  text?: string;
  color?: string;
}

export function factBadge(fact: ProfileFact, hidden: HiddenFields = []): FactBadge | null {
  if (hiddenKey(hidden, "status")) return null;
  switch (fact.kind) {
    case "publication":
      return {
        labelKey: PUBLICATION_STATUS_LABEL_KEYS[fact.payload.status],
        color: publicationStatusColor(fact.payload.status),
      };
    case "patent":
      return {
        labelKey: PATENT_STATUS_LABEL_KEYS[fact.payload.status],
        color: patentStatusColor(fact.payload.status),
      };
    case "credential":
      return {
        labelKey: CREDENTIAL_STATUS_LABEL_KEYS[fact.payload.status],
        color: credentialStatusColor(fact.payload.status),
      };
    case "practice":
      if (hiddenKey(hidden, "experience_kind")) return null;
      return fact.payload.experience_kind === "unset"
        ? null
        : { labelKey: PRACTICE_KIND_LABEL_KEYS[fact.payload.experience_kind] };
    case "work_project":
      if (hiddenKey(hidden, "artifact_type")) return null;
      return fact.payload.artifact_type ? { text: fact.payload.artifact_type } : null;
    case "award":
      if (hiddenKey(hidden, "level")) return null;
      return fact.payload.level ? { text: fact.payload.level } : null;
    case "training":
      if (hiddenKey(hidden, "hours")) return null;
      return fact.payload.hours ? { text: fact.payload.hours } : null;
    case "language":
      if (hiddenKey(hidden, "level")) return null;
      return fact.payload.level ? { text: fact.payload.level } : null;
    case "research_project":
      return null;
  }
}

/**
 * 自定义字段的展示行：只展示**当前字段定义**里的字段（已删除定义的值留在 payload、
 * 但界面不再使用，契约 §2），空值跳过。label 用定义里的最新名字。
 */
export function factCustomLines(
  fact: ProfileFact,
  customDefs: readonly FactCustomFieldDef[] = [],
): string[] {
  if (customDefs.length === 0) return [];
  // 旧事实（灵活字段上线前保存的）payload 里没有 custom_fields；后端读取会补 []，
  // 但旧缓存/导入数据仍可能是 undefined——列表渲染不能因此整页崩溃。
  const customFields = Array.isArray(fact.payload.custom_fields) ? fact.payload.custom_fields : [];
  const values = new Map(customFields.map((field) => [field.key, field.value]));
  const lines: string[] = [];
  for (const def of customDefs) {
    const value = (values.get(def.key) ?? "").trim();
    if (!value) continue;
    lines.push(t("profileFacts.fact.customFieldLine", { label: def.label, value }));
  }
  return lines;
}
