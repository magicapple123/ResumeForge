// SPDX-License-Identifier: Apache-2.0
/**
 * 求职偏好档的纯映射（T14）：kind/枚举/来源展示名、值的展示格式、表单 ↔ API 值转换。
 *
 * 重点钉住"结构化 scalar 不是字符串"这条：薪资要拼回 {amount,unit,currency}、篇幅要拼回
 * {max_pages}——拼错的表现是后端 422，而界面上只会看到一句"保存失败"。
 */
import { describe, expect, it } from "vitest";
import type { JobPreference, JobPreferenceKind } from "../../api/jobPreferences";
import { t } from "../../i18n";
import {
  KIND_LABEL_KEYS,
  SOURCE_LABEL_KEYS,
  buildPreferenceValue,
  emptyFormState,
  enumOptionKey,
  enumOptionsFor,
  formatPreferenceValue,
  formStateForPreference,
  isFormComplete,
  isSessionOnlyPreference,
} from "./jobPreferenceView";

function preference(overrides: Partial<JobPreference> = {}): JobPreference {
  return {
    pref_id: "p1",
    kind: "target_city",
    label: "城市",
    value_kind: "list",
    value: ["Hangzhou", "Shanghai"],
    source: "user_stated",
    source_proposal_id: "proposal-1",
    note: "",
    state: "active",
    has_previous: false,
    created_at: "2026-11-09T00:00:00",
    updated_at: "2026-11-09T00:00:00",
    ...overrides,
  };
}

describe("展示名映射", () => {
  it("12 类 kind 都有展示名 key", () => {
    expect(Object.keys(KIND_LABEL_KEYS)).toHaveLength(12);
    for (const value of Object.values(KIND_LABEL_KEYS)) {
      expect(t(value)).not.toBe(value);
    }
  });

  it("来源闭集三种都有展示名；枚举选项按协议值映射", () => {
    expect(Object.keys(SOURCE_LABEL_KEYS)).toEqual(["user_stated", "user_edited", "imported"]);
    expect(enumOptionKey("work_mode", "remote")).toBe("jobPreference.option.work_mode.remote");
    expect(enumOptionKey("overtime", "reject")).toBe("jobPreference.option.overtime.reject");
    expect(enumOptionKey("redline_tone", "warm")).toBe("jobPreference.option.redline_tone.warm");
    expect(enumOptionKey("work_mode", "unknown_mode")).toBeUndefined();
  });

  it("枚举选项优先用后端给的协议值，label 走本地语言包（不吃后端中文）", () => {
    const options = enumOptionsFor("work_mode", [
      { value: "onsite" },
      { value: "remote" },
      { value: "brand_new" },
    ]);
    expect(options.map((option) => option.value)).toEqual(["onsite", "remote", "brand_new"]);
    expect(options[0].label).toBe(t("jobPreference.option.work_mode.onsite"));
    // 未登记的协议值显示原码，不显示后端中文 label。
    expect(options[2].label).toBe("brand_new");
  });
});

describe("formatPreferenceValue", () => {
  it("列表用语言包分隔符；薪资/篇幅是结构化对象不是 JSON", () => {
    expect(formatPreferenceValue("target_city", ["A", "B"])).toBe(
      ["A", "B"].join(t("jobPreference.value.separator")),
    );
    expect(
      formatPreferenceValue("salary_floor", { amount: 15000, unit: "month", currency: "CNY" }),
    ).toBe(t("jobPreference.value.monthly", { amount: 15000 }));
    expect(
      formatPreferenceValue("salary_floor", { amount: 300000, unit: "year", currency: "CNY" }),
    ).toBe(t("jobPreference.value.yearly", { amount: 300000 }));
    expect(formatPreferenceValue("redline_length", { max_pages: 1 })).toBe(
      t("jobPreference.value.maxPages", { count: 1 }),
    );
  });

  it("枚举值 / 到岗时间 / 文本按协议值展示", () => {
    expect(formatPreferenceValue("work_mode", "remote")).toBe(
      t("jobPreference.option.work_mode.remote"),
    );
    expect(formatPreferenceValue("available_from", "immediate")).toBe(
      t("jobPreference.value.immediate"),
    );
    expect(formatPreferenceValue("available_from", "2026-12-01")).toBe(
      t("jobPreference.value.fromDate", { date: "2026-12-01" }),
    );
    expect(formatPreferenceValue("session_note", "temporary")).toBe("temporary");
  });

  it("未知形态回退可读文本，不返回空白", () => {
    expect(formatPreferenceValue("target_city", null)).toBe("");
    expect(formatPreferenceValue("target_role_family", { weird: 1 })).toContain("weird");
  });
});

describe("表单 ↔ API 值", () => {
  it("薪资拆成金额 + 单位，提交时拼回 {amount,unit,currency}", () => {
    const form = formStateForPreference(
      preference({
        kind: "salary_floor",
        value_kind: "scalar",
        value: { amount: 20000, unit: "year", currency: "CNY" },
      }),
    );
    expect(form.amount).toBe(20000);
    expect(form.salaryUnit).toBe("year");
    expect(buildPreferenceValue(form)).toEqual({
      amount: 20000,
      unit: "year",
      currency: "CNY",
    });
    expect(isFormComplete(form)).toBe(true);
  });

  it("篇幅拼回 {max_pages}，非法页数判未完成", () => {
    const empty = emptyFormState("redline_length");
    expect(isFormComplete(empty)).toBe(false);
    const form = { ...empty, maxPages: 2 };
    expect(buildPreferenceValue(form)).toEqual({ max_pages: 2 });
    expect(isFormComplete(form)).toBe(true);
  });

  it("列表值去空白与空项；枚举/日期/文本原样提交", () => {
    const list = { ...emptyFormState("target_city"), listValues: ["  ", "Hangzhou", " "] };
    expect(buildPreferenceValue(list)).toEqual(["Hangzhou"]);
    expect(isFormComplete(emptyFormState("target_city"))).toBe(false);

    expect(buildPreferenceValue({ ...emptyFormState("work_mode"), enumValue: "hybrid" })).toBe(
      "hybrid",
    );
    expect(
      buildPreferenceValue({ ...emptyFormState("available_from"), dateText: " 2026-12-01 " }),
    ).toBe("2026-12-01");
    expect(buildPreferenceValue({ ...emptyFormState("session_note"), text: " note " })).toBe(
      "note",
    );
  });

  it("编辑表单预填已有值", () => {
    const form = formStateForPreference(preference());
    expect(form.kind).toBe("target_city");
    expect(form.listValues).toEqual(["Hangzhou", "Shanghai"]);
    const enumForm = formStateForPreference(
      preference({ kind: "overtime", value_kind: "scalar", value: "limited" }),
    );
    expect(enumForm.enumValue).toBe("limited");
  });

  it("session_note 是唯一「仅本次对话」的行", () => {
    expect(isSessionOnlyPreference(preference({ kind: "session_note" }))).toBe(true);
    for (const kind of Object.keys(KIND_LABEL_KEYS) as JobPreferenceKind[]) {
      if (kind === "session_note") continue;
      expect(isSessionOnlyPreference(preference({ kind }))).toBe(false);
    }
  });
});
