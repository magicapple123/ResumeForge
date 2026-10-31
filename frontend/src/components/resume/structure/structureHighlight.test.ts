// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";
import {
  applyStructureHighlightToDocument,
  buildStructureHighlightCss,
  highlightTargetsForNode,
  paintStructureHighlight,
  revealPathInDocument,
  STRUCTURE_HIGHLIGHT_DECLARATION,
  STRUCTURE_HIGHLIGHT_STYLE_ID,
} from "./structureHighlight";
import type { StructureViewNode } from "./structureView";

function node(
  partial: Partial<StructureViewNode> & Pick<StructureViewNode, "kind" | "path">,
): StructureViewNode {
  return { key: "k:" + partial.path, label: "x", ...partial };
}

describe("structureHighlight · CSS", () => {
  it("精确路径用等值选择器，条目/板块用前缀选择器", () => {
    const css = buildStructureHighlightCss([
      { path: "education.entry_1.school_1", prefix: false },
      { path: "education.entry_1", prefix: true },
    ]);
    expect(css).toContain('[data-resume-path="education.entry_1.school_1"]');
    expect(css).toContain('[data-resume-path^="education.entry_1."]');
    expect(css).toContain(STRUCTURE_HIGHLIGHT_DECLARATION);
  });

  it("自定义板块 key（含冒号）与含连字符的 id 都是合法路径", () => {
    const css = buildStructureHighlightCss([
      { path: "custom:6f1c2a44-abc.entry-1.school_1", prefix: false },
    ]);
    expect(css).toContain("custom:6f1c2a44-abc.entry-1.school_1");
  });

  it("非法路径（含引号/空格）直接跳过", () => {
    expect(buildStructureHighlightCss([{ path: 'a"b', prefix: false }])).toBe("");
    expect(buildStructureHighlightCss([{ path: "a b", prefix: false }])).toBe("");
  });

  it("没有目标时 CSS 为空（调用方据此清样式）", () => {
    expect(buildStructureHighlightCss([])).toBe("");
  });
});

describe("structureHighlight · 节点目标", () => {
  const field = node({ kind: "item", path: "education.entry_1.school_1", placement: "title" });
  const group = node({
    kind: "group",
    path: "education.entry_1",
    placement: "title",
    children: [field],
  });
  const entry = node({ kind: "entry", path: "education.entry_1", children: [group] });
  const section = node({ kind: "section", path: "education", children: [entry] });

  it("字段精确、条目/板块前缀、分组展开成组内字段", () => {
    expect(highlightTargetsForNode(field)).toEqual([
      { path: "education.entry_1.school_1", prefix: false },
    ]);
    expect(highlightTargetsForNode(entry)).toEqual([{ path: "education.entry_1", prefix: true }]);
    expect(highlightTargetsForNode(section)).toEqual([{ path: "education", prefix: true }]);
    expect(highlightTargetsForNode(group)).toEqual([
      { path: "education.entry_1.school_1", prefix: false },
    ]);
    expect(highlightTargetsForNode(null)).toEqual([]);
  });
});

describe("structureHighlight · iframe 注入", () => {
  function fakeDoc() {
    const doc = document.implementation.createHTMLDocument("resume");
    return doc;
  }

  it("注入一次后重复调用按 id 替换而不是叠加", () => {
    const doc = fakeDoc();
    paintStructureHighlight(null, "");
    const host = document.createElement("div");
    // 没有 iframe 时安全返回
    paintStructureHighlight(host, "css");
    // 直接把样式写进一个文档：复用导出函数的行为
    applyStructureHighlightToDocument(doc, "a{}");
    applyStructureHighlightToDocument(doc, "b{}");
    const styles = doc.querySelectorAll("style#" + STRUCTURE_HIGHLIGHT_STYLE_ID);
    expect(styles).toHaveLength(1);
    expect(styles[0].textContent).toBe("b{}");
    applyStructureHighlightToDocument(doc, "");
    expect(doc.querySelectorAll("style#" + STRUCTURE_HIGHLIGHT_STYLE_ID)).toHaveLength(0);
  });

  it("定位：精确命中优先，找不到时退到前缀", () => {
    const doc = fakeDoc();
    const parent = doc.createElement("div");
    parent.setAttribute("data-resume-path", "education.entry_1");
    parent.scrollIntoView = () => {};
    doc.body.appendChild(parent);
    const target = doc.createElement("span");
    target.setAttribute("data-resume-path", "education.entry_1.school_1");
    target.scrollIntoView = () => {};
    parent.appendChild(target);
    expect(revealPathInDocument(doc, "education.entry_1.school_1")).toBe(true);
    expect(revealPathInDocument(doc, "education.entry_1")).toBe(true);
    expect(revealPathInDocument(doc, "education.missing")).toBe(false);
    expect(revealPathInDocument(null, "x")).toBe(false);
  });

  it("定位只做目标所在页列的纵向滚动，不横向滚到别的页", () => {
    const doc = fakeDoc();
    const scrollTo = vi.fn();
    Object.defineProperty(doc, "defaultView", {
      value: { innerWidth: 794, innerHeight: 1000, scrollY: 0, scrollTo },
      configurable: true,
    });
    const target = doc.createElement("span");
    target.setAttribute("data-resume-path", "education.entry_1.school_1");
    target.getBoundingClientRect = () =>
      ({ left: 100, right: 220, top: 300, height: 20 }) as DOMRect;
    const scrollIntoView = vi.fn();
    target.scrollIntoView = scrollIntoView;
    doc.body.appendChild(target);

    expect(revealPathInDocument(doc, "education.entry_1.school_1")).toBe(true);
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
  });
});
