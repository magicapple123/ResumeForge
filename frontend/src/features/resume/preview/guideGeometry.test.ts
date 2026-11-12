// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it } from "vitest";
import {
  GUIDE_LAYER_ID,
  clearGuideLayer,
  computeGuideGeometry,
  measureGuideGeometry,
  renderGuideLayer,
} from "./guideGeometry";

function makeDocument(): Document {
  const frame = document.createElement("iframe");
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc) throw new Error("测试环境未创建 iframe document");
  return doc;
}

function fakeRect(top: number, left: number, width: number, height: number): DOMRect {
  return {
    top,
    left,
    width,
    height,
    bottom: top + height,
    right: left + width,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("辅助线几何（D05）", () => {
  it("页边距取内容区四边；列边界是内容区中线；基线按行高排", () => {
    const geometry = computeGuideGeometry({
      pageWidth: 794,
      pageHeight: 1123,
      padding: { top: 40, right: 30, bottom: 40, left: 50 },
      lineHeight: 20,
      paragraphs: [{ left: 50, top: 100, width: 600, height: 30 }],
    });
    expect(geometry.columnX).toBeCloseTo((50 + 794 - 30) / 2, 5);
    expect(geometry.baselines[0]).toBeCloseTo(60, 5);
    expect(geometry.baselines[1]).toBeCloseTo(80, 5);
    expect(geometry.baselines[geometry.baselines.length - 1]).toBeLessThanOrEqual(1123 - 40);
    expect(geometry.paragraphs).toHaveLength(1);
  });

  it("行高无效时不出基线（不编造网格）", () => {
    const geometry = computeGuideGeometry({
      pageWidth: 794,
      pageHeight: 1123,
      padding: { top: 40, right: 30, bottom: 40, left: 50 },
      lineHeight: 0,
      paragraphs: [],
    });
    expect(geometry.baselines).toEqual([]);
  });

  it("只渲染开启的类别；覆盖层固定定位且不接收指针事件", () => {
    const doc = makeDocument();
    const geometry = computeGuideGeometry({
      pageWidth: 794,
      pageHeight: 1123,
      padding: { top: 40, right: 30, bottom: 40, left: 50 },
      lineHeight: 20,
      paragraphs: [{ left: 50, top: 100, width: 600, height: 30 }],
    });
    const layer = renderGuideLayer(doc, geometry, {
      margins: true,
      columns: false,
      baselines: false,
      paragraphs: false,
    });
    expect(layer).not.toBeNull();
    expect(doc.getElementById(GUIDE_LAYER_ID)).not.toBeNull();
    expect(layer?.dataset.proviewOverlay).toBe("guides");
    expect(layer?.style.position).toBe("fixed");
    expect(layer?.style.pointerEvents).toBe("none");
    expect(doc.querySelectorAll('[data-proview-guide="margin-top"]')).toHaveLength(1);
    expect(doc.querySelectorAll('[data-proview-guide="baseline"]')).toHaveLength(0);
    expect(doc.querySelectorAll('[data-proview-guide="paragraph"]')).toHaveLength(0);
  });

  it("四类都开时各画各的；重复渲染是幂等替换（不叠层）", () => {
    const doc = makeDocument();
    const geometry = computeGuideGeometry({
      pageWidth: 794,
      pageHeight: 1123,
      padding: { top: 40, right: 30, bottom: 40, left: 50 },
      lineHeight: 20,
      paragraphs: [{ left: 50, top: 100, width: 600, height: 30 }],
    });
    renderGuideLayer(doc, geometry, {
      margins: true,
      columns: true,
      baselines: true,
      paragraphs: true,
    });
    renderGuideLayer(doc, geometry, {
      margins: true,
      columns: true,
      baselines: true,
      paragraphs: true,
    });
    expect(doc.querySelectorAll("#" + GUIDE_LAYER_ID)).toHaveLength(1);
    expect(doc.querySelectorAll('[data-proview-guide="margin-top"]')).toHaveLength(1);
    expect(doc.querySelectorAll('[data-proview-guide="column"]')).toHaveLength(1);
    expect(doc.querySelectorAll('[data-proview-guide="baseline"]').length).toBeGreaterThan(0);
    expect(doc.querySelectorAll('[data-proview-guide="paragraph"]')).toHaveLength(1);
  });

  it("全关时不给空层；clear 可重复调用", () => {
    const doc = makeDocument();
    const geometry = computeGuideGeometry({
      pageWidth: 794,
      pageHeight: 1123,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      lineHeight: 0,
      paragraphs: [],
    });
    expect(
      renderGuideLayer(doc, geometry, {
        margins: false,
        columns: false,
        baselines: false,
        paragraphs: false,
      }),
    ).toBeNull();
    expect(doc.getElementById(GUIDE_LAYER_ID)).toBeNull();
    clearGuideLayer(doc);
    clearGuideLayer(null);
  });

  it("从渲染后的文档量：页边距来自 computed padding，段落来自元素 rect", () => {
    const doc = makeDocument();
    doc.body.style.paddingTop = "20px";
    doc.body.style.paddingRight = "30px";
    doc.body.style.paddingBottom = "20px";
    doc.body.style.paddingLeft = "40px";
    doc.body.style.lineHeight = "18px";
    const entry = doc.createElement("div");
    entry.className = "entry";
    entry.textContent = "entry";
    Object.defineProperty(entry, "getBoundingClientRect", {
      value: () => fakeRect(90, 40, 700, 40),
      configurable: true,
    });
    doc.body.appendChild(entry);

    const geometry = measureGuideGeometry(doc, 794, 1123);
    expect(geometry.insets).toEqual({ top: 20, right: 30, bottom: 20, left: 40 });
    expect(geometry.baselines[0]).toBeCloseTo(38, 5);
    expect(geometry.paragraphs).toHaveLength(1);
    expect(geometry.paragraphs[0].left).toBeCloseTo(40, 5);
  });
});
