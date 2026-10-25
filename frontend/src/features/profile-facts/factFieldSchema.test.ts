// SPDX-License-Identifier: Apache-2.0
/** 字段设置纯逻辑：契约字段→中文标签映射、隐藏字段换算、自定义字段校验、兜底 schema。 */
import { describe, expect, it } from "vitest";
import { FACT_KINDS } from "./constants";
import {
  DEFAULT_FIELD_KEYS,
  DEFAULT_FIELD_LABEL_KEYS,
  defaultFieldLabel,
  defaultFieldsFor,
} from "./factFieldLabels";
import {
  MAX_CUSTOM_FIELDS,
  MAX_CUSTOM_FIELD_VALUE_CHARS,
  fallbackSchema,
  hiddenFieldsFromVisible,
  validateCustomFieldDefs,
  visibleDefaultFields,
  type FieldSettingsIssue,
} from "./factFieldSchema";
import { makeKindSchema } from "./testFixtures";

describe("契约字段与中文标签", () => {
  it("九类默认字段的每个 key 都有中文标签（新增字段不能只改后端）", () => {
    for (const kind of FACT_KINDS) {
      for (const key of DEFAULT_FIELD_KEYS[kind]) {
        expect(DEFAULT_FIELD_LABEL_KEYS[kind][key], `${kind}.${key}`).toBeDefined();
        expect(defaultFieldLabel(kind, key)).not.toBe(key);
      }
    }
  });

  it("新增三类的默认字段与契约 §1 一致", () => {
    expect(defaultFieldsFor("award")).toEqual(["name", "issuer", "date", "level", "description"]);
    expect(defaultFieldsFor("training")).toEqual([
      "name",
      "organization",
      "start_date",
      "end_date",
      "hours",
      "description",
      "outcomes",
    ]);
    expect(defaultFieldsFor("language")).toEqual(["name", "level", "certificate", "score", "date"]);
  });

  it("未知字段 key（后端比前端新）原样显示，不猜翻译", () => {
    expect(defaultFieldLabel("language", "future_field")).toBe("future_field");
  });
});

describe("隐藏字段换算", () => {
  it("schema.hidden_fields → 可见字段 → 再换回 hidden_fields 保持原序", () => {
    const schema = makeKindSchema("publication", { hidden_fields: ["year", "note"] });
    const visible = visibleDefaultFields(schema);
    expect(visible).not.toContain("year");
    expect(visible).not.toContain("note");
    expect(hiddenFieldsFromVisible(schema.default_fields, visible)).toEqual(["year", "note"]);
  });
});

describe("自定义字段校验（契约 §2）", () => {
  const issueOf = (defs: { key?: string; label: string }[]): FieldSettingsIssue | null =>
    validateCustomFieldDefs(defs);

  it("合法定义通过；首尾空白会被忽略后参与比较", () => {
    expect(issueOf([{ label: "Team size" }, { key: "cf_0123456789ab", label: "  Scale  " }])).toBe(
      null,
    );
  });

  it("空名称、重名、超量都被拦下（与默认字段同名的判定由后端执行）", () => {
    expect(issueOf([{ label: "   " }])?.key).toBe("profileFacts.settings.inputRequired");
    expect(issueOf([{ label: "Scope" }, { label: " Scope " }])?.key).toBe(
      "profileFacts.settings.inputDuplicate",
    );
    const tooMany = Array.from({ length: MAX_CUSTOM_FIELDS + 1 }, (_, index) => ({
      label: `Field ${index}`,
    }));
    expect(issueOf(tooMany)?.key).toBe("profileFacts.settings.maxReached");
  });
});

describe("兜底 schema", () => {
  it("九类齐全、全部字段可见、无自定义字段、值与字段上限来自契约", () => {
    const schema = fallbackSchema();
    expect(schema.kinds.map((item) => item.kind)).toEqual([...FACT_KINDS]);
    for (const item of schema.kinds) {
      expect(item.hidden_fields).toEqual([]);
      expect(item.custom_fields).toEqual([]);
      expect(item.default_fields).toEqual([...DEFAULT_FIELD_KEYS[item.kind]]);
    }
    expect(schema.max_custom_field_value_chars).toBe(MAX_CUSTOM_FIELD_VALUE_CHARS);
  });
});
