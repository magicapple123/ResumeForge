// SPDX-License-Identifier: Apache-2.0
/**
 * `resumeFormatLabels` 的纯函数用例。
 *
 * 这一层是版式字段的「中英取名」唯一判断点：英文界面优先 `label_en`，空串回落 `label`
 * （旧后端 / 漏翻的项），中文界面直接 `label`。任何时候都不该返回空串——否则滑块行会
 * 变成一行空白，比显示中文更糟。
 */
import { describe, expect, it } from "vitest";

import { formatFieldDescription, formatFieldLabel, formatFieldLabelOf } from "./resumeFormatLabels";

describe("resumeFormatLabels · 显示名", () => {
  it("英文界面且有 label_en：用英文", () => {
    const field = { key: "section_gap", label: "区块间距", label_en: "Section spacing" };
    expect(formatFieldLabel(field, "en-US", "section_gap")).toBe("Section spacing");
  });

  it("英文界面但 label_en 为空：回落中文（旧后端 / 漏翻不显示空白）", () => {
    expect(
      formatFieldLabel({ key: "accent", label: "强调色", label_en: "" }, "en-US", "accent"),
    ).toBe("强调色");
    expect(formatFieldLabel({ key: "accent", label: "强调色" }, "en-US", "accent")).toBe("强调色");
  });

  it("中文界面：始终用 label，即使 label_en 有值", () => {
    const field = { key: "section_gap", label: "区块间距", label_en: "Section spacing" };
    expect(formatFieldLabel(field, "zh-CN", "section_gap")).toBe("区块间距");
  });

  it("目录项缺失（undefined）：用调用方给的兜底文案", () => {
    expect(formatFieldLabel(undefined, "en-US", "section_gap")).toBe("section_gap");
    expect(formatFieldLabel(null, "zh-CN", "回退")).toBe("回退");
    expect(formatFieldLabelOf(undefined, "accent", "en-US", "accent")).toBe("accent");
  });
});

describe("resumeFormatLabels · 说明文字与按 key 取值", () => {
  it("description 与 label 同一套规则", () => {
    const field = {
      label: "字号系数",
      label_en: "Font scale",
      description: "在所选字号档位上再乘一个系数",
      description_en: "Multiplies the selected font size",
    };
    expect(formatFieldDescription(field, "en-US")).toBe("Multiplies the selected font size");
    expect(formatFieldDescription(field, "zh-CN")).toBe("在所选字号档位上再乘一个系数");
    expect(formatFieldDescription(undefined, "en-US")).toBe("");
  });

  it("formatFieldLabelOf 按 key 在清单里找项", () => {
    const fields = [
      { key: "accent", label: "强调色", label_en: "Accent" },
      { key: "line_color", label: "分隔线", label_en: "Dividers" },
    ];
    expect(formatFieldLabelOf(fields, "line_color", "en-US", "fallback")).toBe("Dividers");
    expect(formatFieldLabelOf(fields, "line_color", "zh-CN", "fallback")).toBe("分隔线");
    expect(formatFieldLabelOf(fields, "missing", "en-US", "fallback")).toBe("fallback");
  });
});
