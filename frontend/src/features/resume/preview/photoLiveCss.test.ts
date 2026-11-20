// SPDX-License-Identifier: Apache-2.0
/**
 * 5.4：草稿照片实时样式的**逐字等价**夹具。
 *
 * 期望值是从后端 `format_css()`（`resume_template_format.py` 照片分支）抄下来的产物，
 * 不是"看起来差不多"的 CSS。任何一边改了格式（空格、分号、`f"{value:g}"`），这里都会红。
 */
import { describe, expect, it } from "vitest";
import {
  buildPhotoLiveCss,
  paintLoadedPhotoLiveFrames,
  paintPhotoLiveStyle,
  PHOTO_LIVE_STYLE_ID,
} from "./photoLiveCss";

describe("buildPhotoLiveCss · 与 resume_template_format.format_css 逐字一致", () => {
  it("五项都没设过 → 空串（模板负责 1px / var(--line) / 4px）", () => {
    expect(buildPhotoLiveCss({})).toBe("");
    expect(buildPhotoLiveCss(null)).toBe("");
  });

  it("显式写默认值也算「设过」：键在就出整条规则", () => {
    expect(buildPhotoLiveCss({ photo_radius: 4 })).toBe(
      ".profile-photo { border: 1px solid var(--line); border-radius: 4px }",
    );
  });

  it("边框 0 → border: 0（不是 border-width: 0）", () => {
    expect(buildPhotoLiveCss({ photo_border_width: 0 })).toBe(
      ".profile-photo { border: 0; border-radius: 4px }",
    );
  });

  it("颜色缺省 → var(--line)，给了就小写直出", () => {
    expect(buildPhotoLiveCss({ photo_border_width: 3 })).toBe(
      ".profile-photo { border: 3px solid var(--line); border-radius: 4px }",
    );
    expect(buildPhotoLiveCss({ photo_border_width: 2, photo_border_color: "#AABBCC" })).toBe(
      ".profile-photo { border: 2px solid #aabbcc; border-radius: 4px }",
    );
  });

  it("偏移都为 0 不写 transform；非 0 才写（含小数）", () => {
    expect(buildPhotoLiveCss({ photo_offset_x: 0, photo_offset_y: 0 })).toBe(
      ".profile-photo { border: 1px solid var(--line); border-radius: 4px }",
    );
    expect(buildPhotoLiveCss({ photo_offset_x: 2.5, photo_offset_y: -1 })).toBe(
      ".profile-photo { border: 1px solid var(--line); border-radius: 4px; transform: translate(2.5mm, -1mm) }",
    );
  });

  it("照片系数只在 ≠1 时写 :root，且排在规则之前", () => {
    expect(buildPhotoLiveCss({ photo_scale: 1 })).toBe("");
    expect(buildPhotoLiveCss({ photo_scale: 1.14 })).toBe(":root { --photo-scale: 1.14; }");
    expect(buildPhotoLiveCss({ photo_scale: 1.15, photo_radius: 8 })).toBe(
      ":root { --photo-scale: 1.15; }\n.profile-photo { border: 1px solid var(--line); border-radius: 8px }",
    );
  });

  it("越界值夹到边界（与后端 validated_format_config 同口径）", () => {
    expect(buildPhotoLiveCss({ photo_border_width: 999 })).toBe(
      ".profile-photo { border: 16px solid var(--line); border-radius: 4px }",
    );
    expect(buildPhotoLiveCss({ photo_scale: 5 })).toBe(":root { --photo-scale: 1.6; }");
  });

  it("非法颜色不当成「设过」（后端会丢弃这个键）；三位十六进制合法", () => {
    expect(buildPhotoLiveCss({ photo_border_color: "red" })).toBe("");
    expect(buildPhotoLiveCss({ photo_border_color: "#ABC" })).toBe(
      ".profile-photo { border: 1px solid #abc; border-radius: 4px }",
    );
  });
});

describe("paintPhotoLiveStyle · iframe 注入", () => {
  it("只注入一次；重复调用改文本；空串清空规则", () => {
    const doc = document.implementation.createHTMLDocument("frame");
    paintPhotoLiveStyle(doc, "a{}");
    paintPhotoLiveStyle(doc, "b{}");
    const styles = doc.querySelectorAll(`#${PHOTO_LIVE_STYLE_ID}`);
    expect(styles).toHaveLength(1);
    expect(styles[0].textContent).toBe("b{}");
    paintPhotoLiveStyle(doc, "");
    expect(doc.querySelector(`#${PHOTO_LIVE_STYLE_ID}`)?.textContent).toBe("");
  });

  it("空串且还没注入过 → 不建节点", () => {
    const doc = document.implementation.createHTMLDocument("frame");
    paintPhotoLiveStyle(doc, "");
    expect(doc.getElementById(PHOTO_LIVE_STYLE_ID)).toBeNull();
  });

  it("容器里没有 iframe 时安全返回", () => {
    expect(() => paintLoadedPhotoLiveFrames(null, "a{}")).not.toThrow();
    expect(() => paintLoadedPhotoLiveFrames(document.createElement("div"), "a{}")).not.toThrow();
  });
});
