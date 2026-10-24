// SPDX-License-Identifier: Apache-2.0
/**
 * 覆盖层注入（D05/D10/D09）的组件级验证。
 *
 * 这里同时钉住 D05 最关键的承诺：**辅助层不进入导出**——注入只发生在 iframe 的
 * contentDocument 里，纸面 HTML（srcDoc）字符串一个字节都不变；`features/resume-proview`
 * 也不 import 任何导出/渲染接口（另见 exportIsolation.test.ts 的结构断言）。
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  CROP_STYLE_ID,
  PROOF_CSS,
  PROOF_STYLE_ID,
  applyGrayscaleProof,
  applyPhotoCrop,
  clearProviewOverlays,
  syncProviewOverlays,
} from "./previewOverlays";
import { GUIDE_LAYER_ID } from "./guideGeometry";
import { createPhotoCropParams, DEFAULT_CROP_DRAFT } from "./photoCrop";

function makeFrame(html = "<!doctype html><html><body></body></html>"): HTMLIFrameElement {
  const frame = document.createElement("iframe");
  frame.srcdoc = html;
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc) throw new Error("测试环境未创建 iframe document");
  return frame;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("灰度校样（D10）", () => {
  it("开 = 注入 grayscale 样式；关 = 移除；重复开幂等", () => {
    const frame = makeFrame();
    const doc = frame.contentDocument as Document;
    applyGrayscaleProof(doc, true);
    applyGrayscaleProof(doc, true);
    const styles = doc.querySelectorAll("#" + PROOF_STYLE_ID);
    expect(styles).toHaveLength(1);
    expect((styles[0] as HTMLStyleElement).textContent).toBe(PROOF_CSS);
    applyGrayscaleProof(doc, false);
    expect(doc.getElementById(PROOF_STYLE_ID)).toBeNull();
  });

  it("null 文档安全返回（iframe 卸载竞态）", () => {
    expect(() => applyGrayscaleProof(null, true)).not.toThrow();
  });
});

describe("照片裁剪预览（D09）", () => {
  it("写入 object-view-box 的 inset 百分比，不回写图片数据", () => {
    const frame = makeFrame();
    const doc = frame.contentDocument as Document;
    const params = createPhotoCropParams(
      { sha256: "c".repeat(64), width: 1000, height: 1000 },
      { ...DEFAULT_CROP_DRAFT, aspect: "1:1", zoom: 0.5 },
    );
    const before = frame.getAttribute("srcdoc");
    applyPhotoCrop(doc, params);
    const style = doc.getElementById(CROP_STYLE_ID) as HTMLStyleElement;
    expect(style.textContent).toContain("object-view-box:inset(");
    expect(style.textContent).toContain(".profile-photo");
    // 非破坏：iframe 的 srcDoc 一个字节没变，图片 src 也没被替换。
    expect(frame.getAttribute("srcdoc")).toBe(before);
    applyPhotoCrop(doc, null);
    expect(doc.getElementById(CROP_STYLE_ID)).toBeNull();
  });
});

describe("覆盖层总编排", () => {
  it("辅助线层只在编辑文档里；纸面 HTML 不变（不导出）", () => {
    const html = '<!doctype html><html><body><p data-resume-path="summary">hello</p></body></html>';
    const frame = makeFrame(html);
    const doc = frame.contentDocument as Document;
    doc.body.style.padding = "20px";
    syncProviewOverlays(doc, {
      guides: { margins: true, columns: true, baselines: false, paragraphs: false },
      proof: false,
      crop: null,
      pageWidth: 794,
      pageHeight: 1123,
    });
    expect(doc.getElementById(GUIDE_LAYER_ID)).not.toBeNull();
    // 覆盖层是 DOM 节点，不在 srcDoc 字符串里——导出走的是后端产物，天然没有它。
    expect(frame.getAttribute("srcdoc")).toContain("hello");
    expect(frame.getAttribute("srcdoc")).not.toContain(GUIDE_LAYER_ID);
    expect(frame.getAttribute("srcdoc")).not.toContain("data-proview-guide");
    clearProviewOverlays(doc);
    expect(doc.getElementById(GUIDE_LAYER_ID)).toBeNull();
    expect(doc.getElementById(PROOF_STYLE_ID)).toBeNull();
    expect(doc.getElementById(CROP_STYLE_ID)).toBeNull();
  });
});
