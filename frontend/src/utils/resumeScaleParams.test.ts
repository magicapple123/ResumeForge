// SPDX-License-Identifier: Apache-2.0
/**
 * 三个系数的前端口径：区间/步长与后端逐键相等、越界夹紧、≈1 即删键。
 *
 * 后端那一侧是 `backend/tests/test_export_format_config.py` 的
 * `test_scale_bounds_match_the_frontend_contract`——**两端各钉一次**。这里不复用任何
 * 后端生成物：把数字写死，两边各自独立断言，改一边忘了另一边就会红。
 */
import { describe, expect, it } from "vitest";
import type { ResumeTemplateCatalog } from "../types";
import {
  DEFAULT_SCALE,
  SCALE_BOUNDS,
  SCALE_CSS_VARS,
  SCALE_KEYS,
  SECTION_GAP_FALLBACK_BOUNDS,
  SECTION_GAP_FALLBACK_DEFAULT,
  catalogNumberBounds,
  clampScale,
  isScaleCustomized,
  isScaleKey,
  resolveScale,
  roundToStep,
  templateSectionGap,
  withScale,
} from "./resumeScaleParams";

describe("区间与步长与后端 _SCALE_MIN_MAX / SCALE_STEPS 逐键相等", () => {
  it("三个键的 min/max/step", () => {
    expect(SCALE_BOUNDS.name_scale).toEqual({ min: 0.8, max: 1.3, step: 0.02 });
    expect(SCALE_BOUNDS.section_title_scale).toEqual({ min: 0.85, max: 1.25, step: 0.02 });
    expect(SCALE_BOUNDS.entry_gap).toEqual({ min: 0.6, max: 1.8, step: 0.05 });
  });

  it("键清单与顺序（:root 声明顺序由后端 SCALE_KEYS_ORDER 决定）", () => {
    expect(SCALE_KEYS).toEqual(["name_scale", "section_title_scale", "entry_gap"]);
  });

  it("CSS 变量名是连字符字面量，与 8 个模板里的写法一致", () => {
    expect(SCALE_CSS_VARS).toEqual({
      name_scale: "--name-scale",
      section_title_scale: "--section-title-scale",
      entry_gap: "--entry-gap",
    });
  });
});

describe("isScaleKey", () => {
  it("只认三个系数键", () => {
    expect(SCALE_KEYS.every((key) => isScaleKey(key))).toBe(true);
    // section_gap 是 FORMAT_FIELDS 里既有的绝对覆盖项，不是系数。
    expect(isScaleKey("section_gap")).toBe(false);
    expect(isScaleKey("photo_scale")).toBe(false);
  });
});

describe("clampScale：滑杆夹紧（后端是丢弃，两侧同一件事）", () => {
  it("越界值收进区间，边界值原样通过", () => {
    expect(clampScale("name_scale", 0.5)).toBe(0.8);
    expect(clampScale("name_scale", 9)).toBe(1.3);
    expect(clampScale("name_scale", 0.8)).toBe(0.8);
    expect(clampScale("name_scale", 1.3)).toBe(1.3);
    expect(clampScale("entry_gap", 0.1)).toBe(0.6);
    expect(clampScale("entry_gap", 5)).toBe(1.8);
  });

  it("非有限数退回「没设过」", () => {
    expect(clampScale("name_scale", Number.NaN)).toBe(DEFAULT_SCALE);
  });
});

describe("resolveScale：缺键 = 1，越界夹紧", () => {
  it("什么都没设过时是 1", () => {
    expect(resolveScale(undefined, "name_scale")).toBe(1);
    expect(resolveScale({}, "name_scale")).toBe(1);
    expect(resolveScale(null, "section_title_scale")).toBe(1);
  });

  it("读得出来的数按区间夹紧", () => {
    expect(resolveScale({ name_scale: 1.1 }, "name_scale")).toBe(1.1);
    expect(resolveScale({ name_scale: 3 }, "name_scale")).toBe(1.3);
    expect(resolveScale({ entry_gap: 0.1 }, "entry_gap")).toBe(0.6);
  });

  it("非数字（颜色字符串 / 数组 / null）一律按没设过处理", () => {
    expect(resolveScale({ name_scale: "#ff0000" }, "name_scale")).toBe(1);
    expect(resolveScale({ name_scale: null }, "name_scale")).toBe(1);
    expect(resolveScale({ name_scale: Number.NaN }, "name_scale")).toBe(1);
  });
});

describe("withScale：数值写入 / null 删键", () => {
  it("写数值时保留其它覆盖", () => {
    const next = withScale({ accent: "#123456" }, "name_scale", 1.1);

    expect(next).toEqual({ accent: "#123456", name_scale: 1.1 });
  });

  it("null 与 1 都是删键（不是写回默认值）", () => {
    expect(withScale({ name_scale: 1.2 }, "name_scale", null)).toEqual({});
    expect(withScale({ name_scale: 1.2 }, "name_scale", 1)).toEqual({});
    // 浮点尾巴也当 1 处理。
    expect(withScale({ name_scale: 1.2 }, "name_scale", 1.0000000001)).toEqual({});
  });

  it("写入前先夹紧，落库值一定在后端白名单里", () => {
    expect(withScale({}, "entry_gap", 9)).toEqual({ entry_gap: 1.8 });
    expect(withScale({}, "entry_gap", 0.1)).toEqual({ entry_gap: 0.6 });
  });
});

describe("isScaleCustomized：决定「随模板」胶囊与复位入口", () => {
  it("没设过 / 设成 1 / 非数字都不算调过", () => {
    expect(isScaleCustomized({}, "name_scale")).toBe(false);
    expect(isScaleCustomized({ name_scale: 1 }, "name_scale")).toBe(false);
    expect(isScaleCustomized({ name_scale: "#fff" }, "name_scale")).toBe(false);
    expect(isScaleCustomized(undefined, "name_scale")).toBe(false);
  });

  it("真调过才算", () => {
    expect(isScaleCustomized({ name_scale: 1.1 }, "name_scale")).toBe(true);
    expect(isScaleCustomized({ entry_gap: 1.8 }, "entry_gap")).toBe(true);
  });
});

describe("roundToStep：浮点尾巴不落到读数与落库值里", () => {
  it("0.02 步长", () => {
    expect(roundToStep(0.8 + 0.02 * 3, 0.02)).toBe(0.86);
    expect(roundToStep(1.1500000000000001, 0.02)).toBe(1.15);
  });

  it("0.05 / 0.1 步长", () => {
    expect(roundToStep(1.4500000000000002, 0.05)).toBe(1.45);
    expect(roundToStep(1.3000000000000003, 0.1)).toBe(1.3);
  });
});

describe("section_gap：区间取目录，缺失时回落到兜底常量", () => {
  const catalog = {
    format_fields: [
      { key: "section_gap", label: "区块间距", type: "number", min: 0.6, max: 2.2, step: 0.1 },
    ],
    template_layouts: { classic: { line_height: 1.7, padding_mm: 14, section_gap: 1.3 } },
  } as unknown as ResumeTemplateCatalog;

  it("目录下发时以目录为准", () => {
    expect(catalogNumberBounds(catalog, "section_gap", SECTION_GAP_FALLBACK_BOUNDS)).toEqual({
      min: 0.6,
      max: 2.2,
      step: 0.1,
    });
  });

  it("目录缺失 / 没有这一项时用兜底值", () => {
    expect(catalogNumberBounds(undefined, "section_gap", SECTION_GAP_FALLBACK_BOUNDS)).toEqual(
      SECTION_GAP_FALLBACK_BOUNDS,
    );
    const empty = { format_fields: [] } as unknown as ResumeTemplateCatalog;
    expect(catalogNumberBounds(empty, "section_gap", SECTION_GAP_FALLBACK_BOUNDS)).toEqual(
      SECTION_GAP_FALLBACK_BOUNDS,
    );
  });

  it("默认值取该模板的基准，缺失时回落 1.3", () => {
    expect(templateSectionGap(catalog, "classic")).toBe(1.3);
    expect(templateSectionGap(catalog, "modern")).toBe(SECTION_GAP_FALLBACK_DEFAULT);
    expect(templateSectionGap(undefined, "classic")).toBe(SECTION_GAP_FALLBACK_DEFAULT);
  });
});
