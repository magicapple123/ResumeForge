// SPDX-License-Identifier: Apache-2.0
/**
 * 四向页边距 + 照片大小：解析优先级、探针形态、写入不变式。
 *
 * 这一组断言是"前端与后端说同一件事"的证据链（设计 §7 T03 的五条验收）：
 * 1. 只有"总" → 四边全等于它；
 * 2. 支路覆盖"总"，缺的边跟"总"走；
 * 3. 四边相等时探针**逐字**等于 `pagePaddingProbeCss`（单值形态，否则松手会跳一下）；
 * 4. 四边不等时是 CSS 简写顺序（上右下左）的四值形态；
 * 5. 拖总滑杆之后，`format_config` 里不残留任何 `page_padding_*`。
 *
 * 后端对偶在 `backend/tests/test_layout_overrides.py`（同一个优先级矩阵、同一批 CSS 字面量）。
 */
import { describe, expect, it } from "vitest";
import {
  MARGIN_SIDES,
  MAX_PHOTO_SCALE,
  MIN_PHOTO_SCALE,
  PAGE_MARGIN_KEY,
  PAGE_MARGIN_STEP,
  clampPageMargin,
  clampPhotoScale,
  configuredMarginSide,
  configuredPhotoScale,
  fromPhotoPercent,
  hasMarginOverrides,
  marginsAreUniform,
  resolvePageMargins,
  resolvePhotoScale,
  sidesDifferingFromMaster,
  toPhotoPercent,
  withMarginSide,
  withPhotoScale,
  withResetMarginSide,
  withUniformMargin,
} from "./pageMargins";
import { pageMarginsProbeCss, pagePaddingProbeCss, photoScaleProbeCss } from "./resumeFormatProbe";

const TEMPLATE = 14;

describe("resolvePageMargins · 优先级（§2.2 ①②③）", () => {
  it("① 只有「总」：四边全等于它（旧数据只有 page_padding）", () => {
    expect(resolvePageMargins({ page_padding: 12 }, TEMPLATE)).toEqual({
      top: 12,
      right: 12,
      bottom: 12,
      left: 12,
    });
  });

  it("② 支路覆盖「总」，缺的边跟「总」走", () => {
    expect(resolvePageMargins({ page_padding: 12, page_padding_top: 8 }, TEMPLATE)).toEqual({
      top: 8,
      right: 12,
      bottom: 12,
      left: 12,
    });
  });

  it("④ 只有四条支路、没有「总」：四边就是它们（总滑杆读数显示「自定义」）", () => {
    const config = {
      page_padding_top: 8,
      page_padding_right: 9,
      page_padding_bottom: 10,
      page_padding_left: 11,
    };
    expect(resolvePageMargins(config, TEMPLATE)).toEqual({
      top: 8,
      right: 9,
      bottom: 10,
      left: 11,
    });
  });

  it("③ 支路不全且没有「总」：整组作废，四边回模板默认（HTML 与 PDF 因此不分歧）", () => {
    expect(resolvePageMargins({ page_padding_top: 8 }, TEMPLATE)).toEqual({
      top: 14,
      right: 14,
      bottom: 14,
      left: 14,
    });
  });

  it("什么都没设：四边都是模板默认值", () => {
    expect(resolvePageMargins({}, TEMPLATE)).toEqual({ top: 14, right: 14, bottom: 14, left: 14 });
    expect(resolvePageMargins(undefined, 18)).toEqual({ top: 18, right: 18, bottom: 18, left: 18 });
  });

  it("旧客户端的 margin_mm 只在没有 page_padding 时作回落，并且被夹进区间", () => {
    // 已经给了 page_padding → 以它为权威（test_export_page_parity 的同一条契约）。
    expect(resolvePageMargins({ page_padding: 12 }, TEMPLATE, 26)).toEqual({
      top: 12,
      right: 12,
      bottom: 12,
      left: 12,
    });
    // 没有 page_padding → 用历史旋钮，但 40 会被夹到上限 26。
    expect(resolvePageMargins({}, TEMPLATE, 40)).toEqual({
      top: 26,
      right: 26,
      bottom: 26,
      left: 26,
    });
  });

  it("读不出数字的畸形值按「没设过」处理，不会把 NaN 带进 CSS", () => {
    expect(resolvePageMargins({ page_padding: "abc", page_padding_top: null }, TEMPLATE)).toEqual({
      top: 14,
      right: 14,
      bottom: 14,
      left: 14,
    });
  });
});

describe("探针 CSS · 与后端 page_padding_rule 逐字一致（§2.3 双形态）", () => {
  it("四边相等时逐字等于 pagePaddingProbeCss（单值形态）", () => {
    const margins = { top: 14.1, right: 14.1, bottom: 14.1, left: 14.1 };
    expect(pageMarginsProbeCss(margins)).toBe("body { padding: 14.1mm !important; }");
    // 这一条是"别名"，不是"另一个实现"：转调保证两边永远不会漂。
    expect(pageMarginsProbeCss(margins)).toBe(pagePaddingProbeCss(14.1));
  });

  it("四边不等时是 CSS 简写顺序（上右下左）的四值形态", () => {
    expect(pageMarginsProbeCss({ top: 8, right: 12, bottom: 12, left: 12 })).toBe(
      "body { padding: 8mm 12mm 12mm 12mm !important; }",
    );
    expect(pageMarginsProbeCss({ top: 8, right: 9, bottom: 10, left: 11 })).toBe(
      "body { padding: 8mm 9mm 10mm 11mm !important; }",
    );
  });

  it("整数不带小数点（复刻 Python 的 :g），小数只留有效位", () => {
    expect(pageMarginsProbeCss({ top: 8, right: 12, bottom: 12, left: 12 })).toContain("8mm 12mm");
    expect(pageMarginsProbeCss({ top: 14.5, right: 14.5, bottom: 14.5, left: 14.5 })).toBe(
      "body { padding: 14.5mm !important; }",
    );
  });
});

describe("照片系数探针", () => {
  it("等于 1 时返回空串（后端也不写这条声明）", () => {
    expect(photoScaleProbeCss(1)).toBe("");
    expect(photoScaleProbeCss(1.0000000001)).toBe("");
  });

  it("不为 1 时写 :root 变量，与后端 format_css 的 :root 形态一致", () => {
    expect(photoScaleProbeCss(1.15)).toBe(":root { --photo-scale: 1.15; }");
    expect(photoScaleProbeCss(1.5)).toBe(":root { --photo-scale: 1.5; }");
    expect(photoScaleProbeCss(0.6)).toBe(":root { --photo-scale: 0.6; }");
  });
});

describe("写入侧 · 规范化不变式（§2.2 写侧语义）", () => {
  it("withUniformMargin：写 page_padding，且不残留任何 page_padding_*（验收 5）", () => {
    const before = {
      accent: "#123456",
      page_padding: 12,
      page_padding_top: 8,
      page_padding_right: 9,
      page_padding_bottom: 10,
      page_padding_left: 11,
    };
    const next = withUniformMargin(before, 16);
    expect(next).toEqual({ accent: "#123456", page_padding: 16 });
    for (const side of MARGIN_SIDES) expect(next).not.toHaveProperty(PAGE_MARGIN_KEY[side]);
    expect(before.page_padding_top).toBe(8); // 原对象没被改
  });

  it("withUniformMargin(null)：total 与四条支路一起清掉（回到随模板）", () => {
    const next = withUniformMargin({ accent: "#123", page_padding: 16, page_padding_top: 8 }, null);
    expect(next).toEqual({ accent: "#123" });
  });

  it("withMarginSide：写全四条，并把总键删掉", () => {
    const next = withMarginSide({ accent: "#123", page_padding: 12 }, "top", 8, TEMPLATE);
    expect(next).toEqual({
      accent: "#123",
      page_padding_top: 8,
      page_padding_right: 12,
      page_padding_bottom: 12,
      page_padding_left: 12,
    });
    expect(next).not.toHaveProperty("page_padding");
  });

  it("withMarginSide：四边被拉平之后塌回单键（自定义 → 统一的回程）", () => {
    const asymmetric = {
      page_padding_top: 8,
      page_padding_right: 12,
      page_padding_bottom: 12,
      page_padding_left: 12,
    };
    const next = withMarginSide(asymmetric, "top", 12, TEMPLATE);
    expect(next).toEqual({ page_padding: 12 });
    for (const side of MARGIN_SIDES) expect(next).not.toHaveProperty(PAGE_MARGIN_KEY[side]);
  });

  it("withMarginSide：越界值被夹紧到 0–26（前端夹紧、后端丢弃的不对称里，前端这一半）", () => {
    expect(withMarginSide({}, "left", 40, TEMPLATE).page_padding_left).toBe(26);
    expect(withMarginSide({}, "left", -3, TEMPLATE).page_padding_left).toBe(0);
  });

  it("withResetMarginSide：该边回到「总」值，其余三条不动", () => {
    const config = {
      page_padding: 12,
      page_padding_top: 8,
      page_padding_right: 9,
      page_padding_bottom: 10,
      page_padding_left: 11,
    };
    // 复位 top：8 → 12（总），仍与 right/bottom/left 不等 → 写全四条。
    expect(withResetMarginSide(config, "top", TEMPLATE)).toEqual({
      page_padding_top: 12,
      page_padding_right: 9,
      page_padding_bottom: 10,
      page_padding_left: 11,
    });
  });

  it("withResetMarginSide：复位后四边全等于模板默认 → 连「总」一起清（回到随模板）", () => {
    const config = {
      page_padding: 14,
      page_padding_top: 8,
      page_padding_right: 14,
      page_padding_bottom: 14,
      page_padding_left: 14,
    };
    expect(withResetMarginSide(config, "top", 14)).toEqual({});
  });

  it("withResetMarginSide：复位后四边全等但不是模板默认 → 塌回 page_padding", () => {
    const config = { page_padding: 12, page_padding_top: 8 };
    // 解析结果是 {8,12,12,12}；复位 top → 12，四边全等且 ≠ 模板 14 → 收成单键。
    expect(withResetMarginSide(config, "top", 14)).toEqual({ page_padding: 12 });
  });
});

describe("页边距的边界与来源读取", () => {
  it("clampPageMargin 收进 0–26 并收口到 0.1mm，步长常量与后端一致", () => {
    expect(clampPageMargin(30)).toBe(26);
    expect(clampPageMargin(-3)).toBe(0);
    expect(clampPageMargin(14.34)).toBe(14.3);
    expect(clampPageMargin(Number.NaN)).toBe(0);
    expect(PAGE_MARGIN_STEP).toBe(0.1);
  });

  it("marginsAreUniform 只认四边严格相等", () => {
    expect(marginsAreUniform({ top: 14, right: 14, bottom: 14, left: 14 })).toBe(true);
    expect(marginsAreUniform({ top: 14, right: 14, bottom: 14, left: 13.9 })).toBe(false);
  });

  it("hasMarginOverrides / configuredMarginSide：回答的是「这个键设过没有」", () => {
    expect(hasMarginOverrides({})).toBe(false);
    expect(hasMarginOverrides({ page_padding: 12 })).toBe(true);
    expect(hasMarginOverrides({ page_padding_left: 12 })).toBe(true);
    expect(configuredMarginSide({ page_padding_left: 12 }, "left")).toBe(12);
    expect(configuredMarginSide({ page_padding_left: 12 }, "top")).toBeNull();
  });

  it("sidesDifferingFromMaster：只有真的和统一值不同的边才算「单独调整过」", () => {
    // 拖一条边会把四条一起写全：用"键写过没有"判断会让四行同时长出复位图标。
    // 这里模板默认 12，只有 top 被拖到 8——另外三条虽然也写了键，值与统一值一样。
    const written = {
      page_padding_top: 8,
      page_padding_right: 12,
      page_padding_bottom: 12,
      page_padding_left: 12,
    };
    expect(sidesDifferingFromMaster(written, 12)).toEqual({
      top: true,
      right: false,
      bottom: false,
      left: false,
    });
    // 从没设过：四边都跟着统一值，一个复位图标都不该出现。
    expect(sidesDifferingFromMaster({}, 14)).toEqual({
      top: false,
      right: false,
      bottom: false,
      left: false,
    });
  });
});

describe("照片系数", () => {
  it("缺键 = 1.0；越界夹紧；非有限值回落到 1.0", () => {
    expect(resolvePhotoScale({})).toBe(1);
    expect(resolvePhotoScale({ photo_scale: 1.5 })).toBe(1.5);
    expect(resolvePhotoScale({ photo_scale: 3 })).toBe(MAX_PHOTO_SCALE);
    expect(resolvePhotoScale({ photo_scale: 0.1 })).toBe(MIN_PHOTO_SCALE);
    expect(resolvePhotoScale({ photo_scale: "abc" })).toBe(1);
    expect(clampPhotoScale(Number.NaN)).toBe(1);
  });

  it("1.15 这种「不在 2% 网格上」的值不被挪动（后端接受任何区间内的浮点）", () => {
    expect(clampPhotoScale(1.15)).toBe(1.15);
    expect(toPhotoPercent(1.15)).toBe(115);
    expect(fromPhotoPercent(115)).toBe(1.15);
  });

  it("百分比 ↔ 系数是同一个收口（UI 只碰整数百分比）", () => {
    expect(toPhotoPercent(1)).toBe(100);
    expect(toPhotoPercent(0.6)).toBe(60);
    expect(toPhotoPercent(1.6)).toBe(160);
    expect(fromPhotoPercent(160)).toBe(1.6);
    expect(fromPhotoPercent(200)).toBe(MAX_PHOTO_SCALE);
    expect(fromPhotoPercent(10)).toBe(MIN_PHOTO_SCALE);
  });

  it("withPhotoScale：null = 删键；数值 = 百分比 / 100", () => {
    expect(withPhotoScale({ accent: "#123", photo_scale: 1.4 }, null)).toEqual({ accent: "#123" });
    expect(withPhotoScale({ accent: "#123" }, 150)).toEqual({
      accent: "#123",
      photo_scale: 1.5,
    });
    expect(configuredPhotoScale({ photo_scale: 1.5 })).toBe(1.5);
    expect(configuredPhotoScale({})).toBeNull();
  });
});
