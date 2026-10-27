// SPDX-License-Identifier: Apache-2.0
/**
 * 覆盖层注入（D05/D10）的组件级验证。
 *
 * 这里同时钉住 D05 最关键的承诺：**辅助层不进入导出**——注入只发生在 iframe 的
 * contentDocument 里，纸面 HTML（srcDoc）字符串一个字节都不变；`features/resume-proview`
 * 也不 import 任何导出/渲染接口（另见 exportIsolation.test.ts 的结构断言）。
 *
 * 照片裁剪（#10）**不在**覆盖层里：后端已按 `format_config.photo_crop` 把纸面照片换成
 * 派生裁剪图，覆盖层再写 `object-view-box` 就是二次裁切。下面有一条回归用例钉住它。
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  PROOF_CSS,
  PROOF_STYLE_ID,
  applyGrayscaleProof,
  clearProviewOverlays,
  syncProviewOverlays,
} from "./previewOverlays";
import { GUIDE_LAYER_ID } from "./guideGeometry";

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

describe("照片裁剪不再由覆盖层二次裁切（#10）", () => {
  it("纸面里服务端已派生的裁剪图原样显示，不注入 object-view-box", () => {
    // 后端收到 format_config.photo_crop 时会把 <img> 换成派生裁剪图；覆盖层要做的
    // 是"什么都不做"——再叠一层 object-view-box 会把取景再裁一次。
    const cropped = "data:image/png;base64,CROPPED-PHOTO";
    const html = `<!doctype html><html><body><img class="profile-photo" src="${cropped}" /></body></html>`;
    const frame = makeFrame(html);
    const doc = frame.contentDocument as Document;
    // jsdom 不解析 `srcdoc`：把同一份 HTML 同步写进文档，才能对"眼下这一页"做断言；
    // `srcdoc` 属性本身仍保持原样（下面用它断言"纸面 HTML 没被改"）。
    doc.open();
    doc.write(html);
    doc.close();
    syncProviewOverlays(doc, {
      guides: { margins: true, columns: true, baselines: true, paragraphs: true },
      proof: false,
      pageWidth: 794,
      pageHeight: 1123,
    });

    const styles = Array.from(doc.querySelectorAll("style"));
    expect(styles.some((style) => (style.textContent ?? "").includes("object-view-box"))).toBe(
      false,
    );
    expect(doc.querySelector(".profile-photo")?.getAttribute("src")).toBe(cropped);
    // 非破坏：iframe 的 srcDoc 一个字节没变。
    expect(frame.getAttribute("srcdoc")).toContain(cropped);
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
  });
});
