// SPDX-License-Identifier: Apache-2.0
/** 补充事实纯数据层：默认值、表单↔payload 转换（含自定义字段）、排序与链接校验。 */
import { describe, expect, it } from "vitest";
import { FACT_KINDS } from "./constants";
import {
  createEmptyPayload,
  emptyFormValues,
  formToPayload,
  isHttpUrl,
  joinLines,
  nextSortOrder,
  payloadToForm,
  splitLines,
} from "./factModel";
import {
  AWARD_FACT,
  CREDENTIAL_FACT,
  CUSTOM_FIELD_DEF,
  LANGUAGE_FACT,
  PRACTICE_FACT,
  PUBLICATION_FACT,
  RESEARCH_FACT,
  TRAINING_FACT,
} from "./testFixtures";

describe("默认 payload", () => {
  it("九类空表单保存后回到同样的空 payload（字段一个不少）", () => {
    for (const kind of FACT_KINDS) {
      expect(formToPayload(kind, emptyFormValues(kind))).toEqual(createEmptyPayload(kind));
    }
  });

  it("空的人员列表在表单里仍是数组，每行一条的列表仍是空字符串", () => {
    expect(emptyFormValues("publication").authors).toEqual([]);
    expect(emptyFormValues("patent").inventors).toEqual([]);
    expect(emptyFormValues("research_project").description).toBe("");
  });

  it("默认状态不暗示已发表、已授权或资格有效", () => {
    expect(createEmptyPayload("publication").status).toBe("other");
    expect(createEmptyPayload("patent").status).toBe("other");
    expect(createEmptyPayload("credential").status).toBe("unknown");
    expect(createEmptyPayload("practice").experience_kind).toBe("unset");
  });
});

describe("表单值与 payload 的往返", () => {
  it("论文：作者顺序、本人/通讯标记与其余字段原样往返", () => {
    const values = payloadToForm(PUBLICATION_FACT.payload);
    expect(values.authors).toEqual(PUBLICATION_FACT.payload.authors);
    expect(values.note).toBe("");
    expect(formToPayload("publication", values)).toEqual(PUBLICATION_FACT.payload);
  });

  it("多行列表按行拆分与合并，空行与首尾空白被忽略", () => {
    expect(splitLines(" one \n\n two \r\nthree ")).toEqual(["one", "two", "three"]);
    expect(joinLines(["a", "b"])).toBe("a\nb");
    const payload = formToPayload("work_project", {
      ...emptyFormValues("work_project"),
      name: "Portfolio site",
      tech_stack: "Figma\nUser research",
      description: " did it ",
    });
    expect(payload.tech_stack).toEqual(["Figma", "User research"]);
    expect(payload.description).toEqual(["did it"]);
  });

  it("姓名空白的作者行被丢弃，其余作者顺序保持", () => {
    const payload = formToPayload("publication", {
      ...emptyFormValues("publication"),
      title: "A paper",
      authors: [
        { name: "First", is_self: false, corresponding: false },
        { name: "   ", is_self: true, corresponding: false },
        { name: "Second", is_self: true, corresponding: true },
      ],
    });
    expect(payload.authors).toEqual([
      { name: "First", is_self: false, corresponding: false },
      { name: "Second", is_self: true, corresponding: true },
    ]);
  });

  it("非法枚举回落到默认值而不是把脏值发给后端", () => {
    const payload = formToPayload("credential", {
      ...emptyFormValues("credential"),
      name: "License",
      status: "made-up",
      expiry_date: "not-a-date",
    });
    expect(payload.status).toBe("unknown");
    expect(payload.expiry_date).toBe("not-a-date");
  });
});

describe("自定义字段值", () => {
  it("按定义写入值快照，并保留已从定义删除的旧值", () => {
    const previous = [{ key: "cf_deadbeef1234", label: "Old custom", value: "keep" }];
    const payload = formToPayload(
      "award",
      {
        ...emptyFormValues("award"),
        name: "Award",
        custom: { [CUSTOM_FIELD_DEF.key]: "4" },
      },
      { customDefs: [CUSTOM_FIELD_DEF], previousCustomFields: previous },
    );
    expect(payload.custom_fields).toEqual([
      { key: CUSTOM_FIELD_DEF.key, label: CUSTOM_FIELD_DEF.label, value: "4" },
      { key: "cf_deadbeef1234", label: "Old custom", value: "keep" },
    ]);
  });

  it("旧快照与当前定义同名时跳过旧条目（同一事实内 label 必须唯一）", () => {
    const payload = formToPayload(
      "award",
      { ...emptyFormValues("award"), name: "Award" },
      {
        customDefs: [CUSTOM_FIELD_DEF],
        previousCustomFields: [
          { key: "cf_deadbeef1234", label: CUSTOM_FIELD_DEF.label, value: "old" },
        ],
      },
    );
    expect(payload.custom_fields).toEqual([
      { key: CUSTOM_FIELD_DEF.key, label: CUSTOM_FIELD_DEF.label, value: "" },
    ]);
  });

  it("payloadToForm 把自定义字段值平铺成 custom 映射（编辑回填用）", () => {
    const fact = {
      ...AWARD_FACT,
      payload: {
        ...AWARD_FACT.payload,
        custom_fields: [{ key: CUSTOM_FIELD_DEF.key, label: CUSTOM_FIELD_DEF.label, value: "4" }],
      },
    };
    const values = payloadToForm(fact.payload);
    expect(values.custom).toEqual({ [CUSTOM_FIELD_DEF.key]: "4" });
  });

  it("新类型 payload 也能在表单值之间原样往返", () => {
    for (const fact of [AWARD_FACT, TRAINING_FACT, LANGUAGE_FACT]) {
      expect(formToPayload(fact.kind, payloadToForm(fact.payload))).toEqual(fact.payload);
    }
  });
});

describe("排序与链接", () => {
  it("新事实追加到现有最大 sort_order 之后", () => {
    expect(nextSortOrder([])).toBe(1);
    expect(nextSortOrder([PUBLICATION_FACT, CREDENTIAL_FACT, RESEARCH_FACT, PRACTICE_FACT])).toBe(
      5,
    );
  });

  it("链接只接受 http(s)，空串视为未填", () => {
    expect(isHttpUrl("https://example.com/a")).toBe(true);
    expect(isHttpUrl("http://example.com")).toBe(true);
    expect(isHttpUrl(" ftp://example.com ")).toBe(false);
    expect(isHttpUrl("example.com")).toBe(false);
    expect(isHttpUrl("")).toBe(false);
  });
});
