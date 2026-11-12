// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { authorsItem, fieldItem, listItem, textItem } from "./documentFixtures";
import {
  formatAuthors,
  formatDateRange,
  formatFieldValue,
  formatListValues,
  itemDisplayLabel,
  itemDisplayValue,
  joinDateRange,
  splitDateRange,
} from "./format";

describe("日期范围", () => {
  it("split / join 往返", () => {
    expect(splitDateRange("2020-09|2024-06")).toEqual({ start: "2020-09", end: "2024-06" });
    expect(splitDateRange("2020-09")).toEqual({ start: "2020-09", end: "" });
    expect(joinDateRange("2020-09", "")).toBe("2020-09|");
    expect(joinDateRange("", "2024-06")).toBe("|2024-06");
    expect(joinDateRange("", "")).toBe("");
  });

  it("空 end 渲染「至今」；英文用 Present；空值返回空串", () => {
    expect(formatDateRange("2020-09|", { presentLabel: "至今" })).toBe("2020-09 – 至今");
    expect(formatDateRange("2020-09|", { presentLabel: "Present" })).toBe("2020-09 – Present");
    expect(formatDateRange("2020-09|2024-06")).toBe("2020-09 – 2024-06");
    expect(formatDateRange("|")).toBe("");
  });
});

describe("列表 / 作者", () => {
  it("按 join 与语言拼分隔符；未知 join 退回分号", () => {
    expect(formatListValues(["A", "B"], "comma", "zh-CN")).toBe("A，B");
    expect(formatListValues(["A", "B"], "comma", "en-US")).toBe("A, B");
    expect(formatListValues(["A", "B"], "semicolon", "zh-CN")).toBe("A；B");
    expect(formatListValues(["A", "B"], "dot", "en-US")).toBe("A · B");
    expect(formatListValues(["A", "B"], "inline", "en-US")).toBe("A B");
    expect(formatListValues(["A", " "], "bogus", "zh-CN")).toBe("A");
    expect(formatListValues([], "comma")).toBe("");
  });

  it("作者只拼姓名（本人/通讯标记不进文本）", () => {
    expect(
      formatAuthors([
        { name: "张三", is_self: true, corresponding: false },
        { name: "李四", is_self: false, corresponding: true },
      ]),
    ).toBe("张三、李四");
    expect(formatAuthors([{ name: "Zhang", is_self: false, corresponding: false }], "en-US")).toBe(
      "Zhang",
    );
  });
});

describe("field / item 展示值", () => {
  it("formatFieldValue 覆盖 date_range / list / enum / 默认", () => {
    expect(formatFieldValue("2020|2021", "date_range")).toBe("2020 – 2021");
    expect(formatFieldValue("A|B", "list")).toBe("A；B");
    expect(formatFieldValue("active", "enum", { resolveEnum: () => "有效期内" })).toBe("有效期内");
    expect(formatFieldValue("active", "enum")).toBe("active");
    expect(formatFieldValue("文本", "text")).toBe("文本");
  });

  it("itemDisplayValue 覆盖四种 item", () => {
    expect(itemDisplayValue(fieldItem({ value: "Tsinghua University" }))).toBe(
      "Tsinghua University",
    );
    expect(itemDisplayValue(listItem())).toBe("Data Structures；Operating Systems");
    expect(itemDisplayValue(authorsItem())).toBe("Zhang San");
    expect(itemDisplayValue(textItem())).toBe("Won first prize");
  });

  it("itemDisplayLabel：用户 label > 目录标签 > key；text 无标签", () => {
    expect(itemDisplayLabel(fieldItem({ label: "学校名" }), "学校")).toBe("学校名");
    expect(itemDisplayLabel(fieldItem({ label: "" }), "学校")).toBe("学校");
    expect(itemDisplayLabel(fieldItem({ label: "", key: "school" }))).toBe("school");
    expect(itemDisplayLabel(textItem(), "正文")).toBe("");
  });
});
