// SPDX-License-Identifier: Apache-2.0
/**
 * 字段设置的纯逻辑：兜底 schema、可见/隐藏字段换算、自定义字段校验。
 *
 * 为什么需要兜底 schema：`/api/profile/facts/schema` 是新接口，加载失败时不该让整个
 * 「补充事实」区块不可用——按"全部默认字段可见、无自定义字段"降级显示，并在区块里
 * 给一条可重试的提示。字段设置视图同样拿到兜底数据，保存失败时由视图自己报错。
 */
import { t } from "../../i18n";
import type { MessageKey } from "../../i18n";
import { FACT_KINDS } from "./constants";
import { defaultFieldsFor } from "./factFieldLabels";
import type {
  FactCustomFieldInput,
  FactKind,
  ProfileFactKindSchema,
  ProfileFactSchema,
} from "./types";

/** 契约 §2：每个类型最多 20 个自定义字段，字段值上限 2000 字。 */
export const MAX_CUSTOM_FIELDS = 20;
export const MAX_CUSTOM_FIELD_VALUE_CHARS = 2000;
/** 契约 §2：label 1..40 字。 */
export const MAX_CUSTOM_FIELD_LABEL_CHARS = 40;

/**
 * 单一类型的兜底 schema：全部默认字段可见、没有自定义字段。
 * `revision: 0` 与后端"缺失 prefs 行"时的 GET 返回一致（首次保存用 expected_revision=0）。
 */
export function fallbackKindSchema(kind: FactKind): ProfileFactKindSchema {
  return {
    kind,
    revision: 0,
    default_fields: defaultFieldsFor(kind),
    hidden_fields: [],
    custom_fields: [],
    max_custom_fields: MAX_CUSTOM_FIELDS,
  };
}

/** 整份兜底 schema（九类，固定顺序）。 */
export function fallbackSchema(): ProfileFactSchema {
  return {
    kinds: FACT_KINDS.map((kind) => fallbackKindSchema(kind)),
    max_custom_field_value_chars: MAX_CUSTOM_FIELD_VALUE_CHARS,
  };
}

/** 当前可见（未隐藏）的默认字段，保持 schema 返回顺序。 */
export function visibleDefaultFields(kindSchema: ProfileFactKindSchema): string[] {
  const hidden = new Set(kindSchema.hidden_fields);
  return kindSchema.default_fields.filter((key) => !hidden.has(key));
}

/** 勾选结果（可见字段）→ hidden_fields（保存时提交的隐藏清单）。 */
export function hiddenFieldsFromVisible(
  defaultFields: readonly string[],
  visibleFields: readonly string[],
): string[] {
  const visible = new Set(visibleFields);
  return defaultFields.filter((key) => !visible.has(key));
}

export interface FieldSettingsIssue {
  key: MessageKey;
  params?: Record<string, string | number>;
}

/**
 * 校验字段设置的自定义字段：非空、≤40 字、不重名、数量不超限。
 *
 * 后端 PUT 同样校验（400）；前端先拦一遍是为了让用户当场看到哪一行错了。
 * "不得与默认字段中文标签同名"这条**只由后端判**：默认字段的中文标签唯一真相在
 * 后端 `fact_field_catalog.py`，GET /schema 只下发 key 不下发标签，前端手写一份
 * 标签表去比较会让"界面觉得不同名、后端觉得同名"的边界各说各话——交给后端 400
 * 并把原因展示出来，才是唯一口径。
 */
export function validateCustomFieldDefs(
  defs: readonly FactCustomFieldInput[],
): FieldSettingsIssue | null {
  if (defs.length > MAX_CUSTOM_FIELDS) {
    return { key: "profileFacts.settings.maxReached", params: { max: MAX_CUSTOM_FIELDS } };
  }
  const seen = new Set<string>();
  for (const def of defs) {
    const label = def.label.trim();
    if (!label) return { key: "profileFacts.settings.inputRequired" };
    if (Array.from(label).length > MAX_CUSTOM_FIELD_LABEL_CHARS) {
      return {
        key: "profileFacts.settings.labelTooLong",
        params: { max: MAX_CUSTOM_FIELD_LABEL_CHARS },
      };
    }
    if (seen.has(label)) {
      return { key: "profileFacts.settings.inputDuplicate", params: { label } };
    }
    seen.add(label);
  }
  return null;
}

/** 把校验结果渲染成一句人话（视图与测试共用，避免各拼一份）。 */
export function fieldSettingsIssueText(issue: FieldSettingsIssue): string {
  return t(issue.key, issue.params);
}
