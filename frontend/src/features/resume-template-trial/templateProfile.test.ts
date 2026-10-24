// SPDX-License-Identifier: Apache-2.0
/** 模板档案：只投影目录事实（篇幅同后端 density_group 判据；字族来自 serif_heading）。 */
import { describe, expect, it } from "vitest";
import { TEMPLATE_CATALOG } from "../../test/resumeFixtures";
import {
  ROOMY_LINE_HEIGHT,
  templateCapability,
  templateChoices,
  templateDensity,
  templateLimitations,
} from "./templateProfile";

const EMPTY = {
  templates: [],
  format_fields: [],
  style_fields: [],
  format_presets: [],
  section_options: [],
  default_section_order: [],
  defaults: { template: "classic", font_scale: "standard", page_limit: 1 },
  pdf_direct_available: true,
  market: [],
};

describe("templateProfile · 篇幅档", () => {
  it("与后端 density_group 同判据：行高 < 1.6 为 roomy", () => {
    expect(ROOMY_LINE_HEIGHT).toBe(1.6);
    // 夹具：compact 1.55（rooy），classic 1.7（regular）
    expect(templateDensity(TEMPLATE_CATALOG, "compact")).toBe("roomy");
    expect(templateDensity(TEMPLATE_CATALOG, "classic")).toBe("regular");
  });

  it("目录没给基准时不猜（null）", () => {
    expect(templateDensity(TEMPLATE_CATALOG, "elegant")).toBeNull();
    expect(templateDensity(undefined, "classic")).toBeNull();
    expect(templateDensity(EMPTY as never, "classic")).toBeNull();
  });
});

describe("templateProfile · 字族与照片", () => {
  it("衬线标题是目录下发的唯一模板档差异", () => {
    expect(templateLimitations({ serif_heading: true })).toEqual(["trial.limit.serif"]);
    expect(templateLimitations({ serif_heading: false })).toEqual([]);
    expect(templateLimitations({})).toEqual([]);
  });

  it("内置模板有照片位点，自制模板取决于用户 HTML", () => {
    expect(
      templateCapability({ name: "classic", serif_heading: false }, TEMPLATE_CATALOG).photo,
    ).toBe("builtin");
    expect(
      templateCapability({ name: "my", custom: true, serif_heading: false }, TEMPLATE_CATALOG)
        .photo,
    ).toBe("custom");
  });
});

describe("templateProfile · 可对比模板清单", () => {
  it("当前模板在目录里时原样返回", () => {
    expect(templateChoices(TEMPLATE_CATALOG, "classic").map((item) => item.name)).toEqual(
      TEMPLATE_CATALOG.templates.map((item) => item.name),
    );
  });

  it("当前模板已下线时补进清单（旧记录仍能显示正在用哪套）", () => {
    const choices = templateChoices(TEMPLATE_CATALOG, "scholar");
    expect(choices[0]).toEqual({ name: "scholar", label: "scholar", description: "" });
    expect(choices).toHaveLength(TEMPLATE_CATALOG.templates.length + 1);
  });
});
