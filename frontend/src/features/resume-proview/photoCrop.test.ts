// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  PHOTO_CROP_ASPECTS,
  PHOTO_CROP_FORMAT_KEY,
  buildPhotoSource,
  computeCropRect,
  createPhotoCropParams,
  DEFAULT_CROP_DRAFT,
  draftFromParams,
  isFullFrame,
  parsePhotoCrop,
  photoSha256,
  readPhotoCropFromFormatConfig,
  withPhotoCrop,
  type PhotoSourceInfo,
} from "./photoCrop";
import {
  DEFAULT_PRINTED_WIDTH_MM,
  cropPixelSize,
  estimatePrintClarity,
  printedWidthMm,
} from "./photoClarity";

/** 与后端 resume_photo_crop 同口径：来源哈希是照片 data URL 字符串的 sha256。 */
const PHOTO = "data:image/png;base64,AAAA";
const SQUARE: PhotoSourceInfo = { sha256: "a".repeat(64), width: 1000, height: 1000 };

describe("裁剪矩形几何（D09，非破坏，后端冻结形状）", () => {
  it("原图比例 + 不放大 = 全幅；rect 用 x/y/w/h", () => {
    expect(computeCropRect(SQUARE, DEFAULT_CROP_DRAFT)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it("3:4 锁定在方图上得到居中竖条；4:5 也是竖条但更宽", () => {
    expect(computeCropRect(SQUARE, { ...DEFAULT_CROP_DRAFT, aspect: "3:4" })).toEqual({
      x: 0.125,
      y: 0,
      w: 0.75,
      h: 1,
    });
    expect(computeCropRect(SQUARE, { ...DEFAULT_CROP_DRAFT, aspect: "4:5" })).toEqual({
      x: 0.1,
      y: 0,
      w: 0.8,
      h: 1,
    });
  });

  it("取景放大居中缩小矩形；位置偏移被夹在原图内", () => {
    expect(computeCropRect(SQUARE, { aspect: "3:4", zoom: 0.5, offsetX: 0, offsetY: 0 })).toEqual({
      x: 0.3125,
      y: 0.25,
      w: 0.375,
      h: 0.5,
    });
    expect(computeCropRect(SQUARE, { aspect: "3:4", zoom: 0.5, offsetX: 1, offsetY: -1 })).toEqual({
      x: 0.625,
      y: 0,
      w: 0.375,
      h: 0.5,
    });
  });

  it("草稿 → 参数 → 草稿可还原（重开弹窗时滑块位置不丢）", () => {
    const draft = { aspect: "4:5" as const, zoom: 0.6, offsetX: -0.4, offsetY: 0.7 };
    const params = createPhotoCropParams(SQUARE, draft);
    const restored = draftFromParams(params);
    expect(restored.aspect).toBe("4:5");
    expect(restored.zoom).toBeCloseTo(0.6, 3);
    expect(restored.offsetX).toBeCloseTo(-0.4, 3);
    expect(restored.offsetY).toBeCloseTo(0.7, 3);
  });

  it("全幅判定（恢复原图 = 删参数；矩形键名 w/h）", () => {
    const full = createPhotoCropParams(SQUARE, DEFAULT_CROP_DRAFT);
    expect(isFullFrame(full)).toBe(true);
    const cropped = createPhotoCropParams(SQUARE, { ...DEFAULT_CROP_DRAFT, zoom: 0.5 });
    expect(isFullFrame(cropped)).toBe(false);
    expect(cropped.rect).toMatchObject({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 });
  });

  it("照片哈希与后端 photo_sha256 同口径：sha256(照片字符串) 64 位小写 hex", () => {
    expect(photoSha256(PHOTO)).toMatch(/^[0-9a-f]{64}$/);
    expect(buildPhotoSource(PHOTO, 800, 600).sha256).toBe(photoSha256(PHOTO));
    expect(photoSha256("")).toBe("");
    expect(photoSha256("data:image/png;base64,AAAB")).not.toBe(photoSha256(PHOTO));
  });

  it("界面可选比例就是后端 ASPECTS（free / 1:1 / 3:4 / 4:5）", () => {
    expect(PHOTO_CROP_ASPECTS).toEqual(["free", "1:1", "3:4", "4:5"]);
  });
});

describe("清晰度提示", () => {
  it("按纸面宽度折算打印 dpi；低于 200 提示发虚", () => {
    const params = createPhotoCropParams(SQUARE, DEFAULT_CROP_DRAFT);
    expect(cropPixelSize(params)).toEqual({ width: 1000, height: 1000 });
    const small = createPhotoCropParams(SQUARE, { ...DEFAULT_CROP_DRAFT, zoom: 0.5 });
    expect(cropPixelSize(small)).toEqual({ width: 500, height: 500 });
    expect(estimatePrintClarity(small, 30).level).toBe("ok");
    expect(estimatePrintClarity(small, 100).level).toBe("warn");
    expect(estimatePrintClarity(small, 100).printedWidthMm).toBe(100);
  });

  it("CSS px → mm 用 96dpi；非法宽度回兜底值", () => {
    expect(printedWidthMm(96)).toBeCloseTo(25.4, 5);
    expect(printedWidthMm(0)).toBe(DEFAULT_PRINTED_WIDTH_MM);
    expect(printedWidthMm(Number.NaN)).toBe(DEFAULT_PRINTED_WIDTH_MM);
  });
});

describe("裁剪参数契约（format_config.photo_crop，后端冻结形状）", () => {
  it("解析合法参数；版本/越界矩形/坏哈希/缺来源一律拒绝", () => {
    const params = createPhotoCropParams(SQUARE, { ...DEFAULT_CROP_DRAFT, zoom: 0.5 });
    expect(parsePhotoCrop(JSON.parse(JSON.stringify(params)))).toEqual(params);
    expect(parsePhotoCrop({ ...params, version: 2 })).toBeNull();
    expect(parsePhotoCrop({ ...params, rect: { x: 0.9, y: 0, w: 0.5, h: 1 } })).toBeNull();
    expect(
      parsePhotoCrop({ ...params, source: { sha256: "abc", width: 1, height: 1 } }),
    ).toBeNull();
    expect(parsePhotoCrop(null)).toBeNull();
  });

  it("旧前端形状（hash + width/height）不会被误认成合法参数", () => {
    expect(
      parsePhotoCrop({
        version: 1,
        aspect: "original",
        rect: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
        source: { hash: "abc123", width: 800, height: 600 },
      }),
    ).toBeNull();
  });

  it("aspect 非法时按后端行为回落 free（矩形才是决定性数据）", () => {
    const params = createPhotoCropParams(SQUARE, DEFAULT_CROP_DRAFT);
    expect(parsePhotoCrop({ ...params, aspect: "4:3" })?.aspect).toBe("free");
  });

  it("写回 format_config 走 v1 域协议：嵌套对象 + version=1 + 空域删键", () => {
    const params = createPhotoCropParams(SQUARE, DEFAULT_CROP_DRAFT);
    const merged = withPhotoCrop({ line_height: 1.7 }, params);
    expect(merged.line_height).toBe(1.7);
    const domain = merged[PHOTO_CROP_FORMAT_KEY] as unknown as Record<string, unknown>;
    expect(typeof domain).toBe("object");
    expect(domain.version).toBe(1);
    expect(domain.source).toMatchObject({ sha256: "a".repeat(64), width: 1000, height: 1000 });
    expect(domain.rect).toMatchObject({ x: 0, y: 0, w: 1, h: 1 });
    expect(readPhotoCropFromFormatConfig(merged)).toEqual(params);
    expect(withPhotoCrop(merged, null)).toEqual({ line_height: 1.7 });
  });

  it("更高版本的域整域丢弃（读侧与 fe-layout 协议一致）", () => {
    const params = createPhotoCropParams(SQUARE, DEFAULT_CROP_DRAFT);
    expect(
      readPhotoCropFromFormatConfig({ photo_crop: { ...params, version: 2 } } as never),
    ).toBeNull();
  });
});
