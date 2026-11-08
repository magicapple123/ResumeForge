// SPDX-License-Identifier: Apache-2.0
/**
 * 求职偏好档（T14）的纯展示/表单映射：不取数、无副作用，便于单测。
 *
 * 三条约定：
 * - kind / source / 枚举 value 都是**协议值**，这里只做"协议值 → 语言包 key"；
 *   未登记的值回退显示原码，绝不猜。
 * - 值的展示格式只在 `formatPreferenceValue` 一处实现（行与确认卡共用一套口径）。
 * - 表单状态与 API 值之间的转换只在 `formStateForPreference` / `buildPreferenceValue`
 *   一处实现：结构化 scalar（薪资 / 篇幅）由界面拆成多个输入框再拼回对象。
 */
import type {
  JobPreference,
  JobPreferenceKind,
  JobPreferenceSource,
} from "../../api/jobPreferences";
import { t, type MessageKey } from "../../i18n";

/** 12 类 kind 的展示名（与后端目录一一对应）。 */
export const KIND_LABEL_KEYS: Record<JobPreferenceKind, MessageKey> = {
  target_role_family: "jobPreference.kind.target_role_family",
  target_city: "jobPreference.kind.target_city",
  exclude_company: "jobPreference.kind.exclude_company",
  exclude_industry: "jobPreference.kind.exclude_industry",
  salary_floor: "jobPreference.kind.salary_floor",
  work_mode: "jobPreference.kind.work_mode",
  overtime: "jobPreference.kind.overtime",
  redline_banned_word: "jobPreference.kind.redline_banned_word",
  redline_length: "jobPreference.kind.redline_length",
  redline_tone: "jobPreference.kind.redline_tone",
  available_from: "jobPreference.kind.available_from",
  session_note: "jobPreference.kind.session_note",
};

/** 来源闭集（不含 assistant）：展示时注明"你告诉助手的 / 你手动设置的"。 */
export const SOURCE_LABEL_KEYS: Record<JobPreferenceSource, MessageKey> = {
  user_stated: "jobPreference.source.user_stated",
  user_edited: "jobPreference.source.user_edited",
  imported: "jobPreference.source.imported",
};

/** 三组枚举型 scalar 的选项展示名（协议值 → key）。 */
export const ENUM_OPTION_LABEL_KEYS: Partial<
  Record<JobPreferenceKind, Record<string, MessageKey>>
> = {
  work_mode: {
    onsite: "jobPreference.option.work_mode.onsite",
    hybrid: "jobPreference.option.work_mode.hybrid",
    remote: "jobPreference.option.work_mode.remote",
  },
  overtime: {
    accept: "jobPreference.option.overtime.accept",
    limited: "jobPreference.option.overtime.limited",
    reject: "jobPreference.option.overtime.reject",
  },
  redline_tone: {
    professional: "jobPreference.option.redline_tone.professional",
    plain: "jobPreference.option.redline_tone.plain",
    warm: "jobPreference.option.redline_tone.warm",
  },
};

/** 枚举选项的展示名 key；未登记返回 undefined（调用方回退原码）。 */
export function enumOptionKey(kind: JobPreferenceKind, value: string): MessageKey | undefined {
  return ENUM_OPTION_LABEL_KEYS[kind]?.[value];
}

/**
 * 枚举型 scalar 的选项清单：优先用后端 catalog 给的协议值，label 一律用本地语言包
 * （catalog.options[].label 是后端中文，不能拿来做英文界面）。后端没给值时才回退到
 * 本地登记表——两边都缺时显示原码，不猜。
 */
export function enumOptionsFor(
  kind: JobPreferenceKind,
  catalogOptions: ReadonlyArray<{ value: string }> = [],
): Array<{ value: string; label: string }> {
  const values =
    catalogOptions.length > 0
      ? catalogOptions.map((option) => option.value)
      : Object.keys(ENUM_OPTION_LABEL_KEYS[kind] ?? {});
  return values.map((value) => {
    const key = enumOptionKey(kind, value);
    return { value, label: key ? t(key) : value };
  });
}

/** 这是不是「只在这次对话」的行（session_note 永不进注入块，行上要标注）。 */
export function isSessionOnlyPreference(pref: JobPreference): boolean {
  return pref.kind === "session_note";
}

function salaryText(value: unknown): string {
  if (!value || typeof value !== "object") return String(value ?? "");
  const record = value as Record<string, unknown>;
  const amount = Number(record.amount);
  if (!Number.isFinite(amount)) return "";
  const key = record.unit === "year" ? "jobPreference.value.yearly" : "jobPreference.value.monthly";
  return t(key, { amount });
}

/**
 * 把存储值渲染成给人看的一句话（行与任何只读展示共用；不在别处再实现一份）。
 *
 * 未知形态回退成 JSON 字符串而不是空白——空白会让"有一条偏好"看起来像坏数据。
 */
export function formatPreferenceValue(kind: JobPreferenceKind, value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).join(t("jobPreference.value.separator"));
  }
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    if (kind === "salary_floor") return salaryText(value);
    if (kind === "redline_length") {
      const pages = Number((value as Record<string, unknown>).max_pages);
      return Number.isFinite(pages) ? t("jobPreference.value.maxPages", { count: pages }) : "";
    }
    return JSON.stringify(value);
  }
  const text = String(value);
  const optionKey = enumOptionKey(kind, text);
  if (optionKey) return t(optionKey);
  if (kind === "available_from") {
    return text === "immediate"
      ? t("jobPreference.value.immediate")
      : t("jobPreference.value.fromDate", { date: text });
  }
  return text;
}

/** 编辑弹窗的表单状态：结构化 scalar 拆成独立输入框。 */
export interface JobPreferenceFormState {
  kind: JobPreferenceKind;
  listValues: string[];
  amount: number | null;
  salaryUnit: "month" | "year";
  enumValue: string;
  maxPages: number | null;
  dateText: string;
  text: string;
  note: string;
}

/** 空表单：新增时按选中的 kind 给默认值。 */
export function emptyFormState(kind: JobPreferenceKind): JobPreferenceFormState {
  return {
    kind,
    listValues: [],
    amount: null,
    salaryUnit: "month",
    enumValue: "",
    maxPages: null,
    dateText: "",
    text: "",
    note: "",
  };
}

/** 已有偏好 → 表单状态（编辑时预填；未知形态落到对应字段，不丢数据）。 */
export function formStateForPreference(pref: JobPreference): JobPreferenceFormState {
  const state = emptyFormState(pref.kind);
  state.note = pref.note;
  const value = pref.value;
  switch (pref.kind) {
    case "salary_floor": {
      if (value && typeof value === "object") {
        const record = value as Record<string, unknown>;
        const amount = Number(record.amount);
        state.amount = Number.isFinite(amount) ? amount : null;
        state.salaryUnit = record.unit === "year" ? "year" : "month";
      }
      return state;
    }
    case "redline_length": {
      if (value && typeof value === "object") {
        const pages = Number((value as Record<string, unknown>).max_pages);
        state.maxPages = Number.isFinite(pages) ? pages : null;
      }
      return state;
    }
    case "work_mode":
    case "overtime":
    case "redline_tone": {
      state.enumValue = typeof value === "string" ? value : "";
      return state;
    }
    case "available_from": {
      state.dateText = typeof value === "string" ? value : "";
      return state;
    }
    case "session_note": {
      state.text = typeof value === "string" ? value : "";
      return state;
    }
    default: {
      state.listValues = Array.isArray(value) ? value.map((item) => String(item)) : [];
      return state;
    }
  }
}

/** 表单状态 → 提交给后端的值（结构化 scalar 在这里拼回对象）。 */
export function buildPreferenceValue(form: JobPreferenceFormState): unknown {
  switch (form.kind) {
    case "salary_floor":
      return {
        amount: form.amount ?? 0,
        unit: form.salaryUnit,
        currency: "CNY",
      };
    case "redline_length":
      return { max_pages: form.maxPages ?? 0 };
    case "work_mode":
    case "overtime":
    case "redline_tone":
      return form.enumValue;
    case "available_from":
      return form.dateText.trim();
    case "session_note":
      return form.text.trim();
    default:
      return form.listValues.map((item) => item.trim()).filter(Boolean);
  }
}

/** 表单是否填了必填内容（提交按钮的可用性；后端仍会做完整校验并给 422）。 */
export function isFormComplete(form: JobPreferenceFormState): boolean {
  switch (form.kind) {
    case "salary_floor":
      return form.amount !== null && Number.isFinite(form.amount) && form.amount > 0;
    case "redline_length":
      return form.maxPages !== null && Number.isFinite(form.maxPages) && form.maxPages >= 1;
    case "work_mode":
    case "overtime":
    case "redline_tone":
      return form.enumValue !== "";
    case "available_from":
      return form.dateText.trim() !== "";
    case "session_note":
      return form.text.trim() !== "";
    default:
      return form.listValues.some((item) => item.trim() !== "");
  }
}
