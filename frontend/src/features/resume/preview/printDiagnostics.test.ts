// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { parseColor } from "./colorMath";
import {
  ACCENT_CONTRAST_MIN,
  contrastRatio,
  diagnoseColors,
  grayscaleOf,
  readColorSample,
  relativeLuminance,
  TEXT_CONTRAST_MIN,
} from "./printDiagnostics";

function docWithColors(): Document {
  const frame = document.createElement("iframe");
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc) throw new Error("测试环境未创建 iframe document");
  doc.body.style.color = "#222222";
  doc.body.style.backgroundColor = "rgb(255, 255, 255)";
  const heading = doc.createElement("h1");
  heading.style.color = "#123456";
  const rule = doc.createElement("hr");
  rule.style.color = "#999999";
  doc.body.append(heading, rule);
  return doc;
}

describe("颜色解析与对比度（D10）", () => {
  it("解析 hex 与 rgb()；透明/非法返回 null", () => {
    expect(parseColor("#fff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseColor("#123456")).toEqual({ r: 18, g: 52, b: 86 });
    expect(parseColor("rgb(1, 2, 3)")).toEqual({ r: 1, g: 2, b: 3 });
    expect(parseColor("rgba(0, 0, 0, 0)")).toBeNull();
    expect(parseColor("transparent")).toBeNull();
    expect(parseColor("")).toBeNull();
  });

  it("黑白对比度 = 21；相对亮度单调", () => {
    const black = { r: 0, g: 0, b: 0 };
    const white = { r: 255, g: 255, b: 255 };
    expect(contrastRatio(black, white)).toBeCloseTo(21, 5);
    expect(relativeLuminance(black)).toBe(0);
    expect(relativeLuminance(white)).toBeCloseTo(1, 5);
    expect(grayscaleOf({ r: 255, g: 0, b: 0 }).r).toBeLessThan(255);
  });

  it("正文低于 4.5 给 warn；全部达标的采样不报问题", () => {
    const warn = diagnoseColors({ text: "#999999", accent: "#aaaaaa", line: "#dddddd" });
    expect(warn.measured).toBe(true);
    expect(warn.findings.find((item) => item.item === "text")?.ratio).toBeLessThan(
      TEXT_CONTRAST_MIN,
    );
    expect(warn.findings.every((item) => !item.ok)).toBe(true);

    const ok = diagnoseColors({ text: "#000000", accent: "#333333", line: "#aaaaaa" });
    expect(ok.findings.every((item) => item.ok)).toBe(true);
    const accent = ok.findings.find((item) => item.item === "accent");
    expect(accent?.ratio).toBeGreaterThan(ACCENT_CONTRAST_MIN);
  });

  it("一个颜色都没量到时 measured=false（不假装检查过）", () => {
    const result = diagnoseColors({});
    expect(result.measured).toBe(false);
    expect(result.findings).toEqual([]);
  });

  it("从渲染文档读采样：正文/强调/细线/背景 + 可诊断", () => {
    const sample = readColorSample(docWithColors());
    expect(sample.text).toBeTruthy();
    expect(sample.accent).toBeTruthy();
    expect(sample.line).toBeTruthy();
    expect(sample.background).toBeTruthy();
    const result = diagnoseColors(sample);
    expect(result.measured).toBe(true);
    expect(result.findings.length).toBe(3);
  });

  it("没有文档时返回空采样", () => {
    expect(readColorSample(null)).toEqual({});
  });
});
