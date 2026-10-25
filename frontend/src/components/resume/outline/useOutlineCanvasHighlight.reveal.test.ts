// SPDX-License-Identifier: Apache-2.0
/** D01 显式定位：把纸面元素滚进可视区（jsdom 用桩记录 scrollIntoView）。 */
import { describe, expect, it, vi } from "vitest";
import { revealPathInDocument, revealPathInHost } from "./useOutlineCanvasHighlight";

describe("revealPathInDocument", () => {
  it("精确路径优先；没有精确匹配时用前缀（条目级定位）", () => {
    const doc = document.implementation.createHTMLDocument("preview");
    const exact = doc.createElement("span");
    exact.setAttribute("data-resume-path", "projects.0.description.1");
    const scroll = vi.fn();
    exact.scrollIntoView = scroll;
    doc.body.appendChild(exact);
    expect(revealPathInDocument(doc, "projects.0.description.1")).toBe(true);
    expect(scroll).toHaveBeenCalledWith({ block: "center", behavior: "smooth" });
    expect(revealPathInDocument(doc, "projects.0")).toBe(true);
  });

  it("找不到 / 空路径 / 空文档返回 false（不抛错）", () => {
    const doc = document.implementation.createHTMLDocument("empty");
    expect(revealPathInDocument(doc, "projects.9.name")).toBe(false);
    expect(revealPathInDocument(doc, "")).toBe(false);
    expect(revealPathInDocument(null, "projects.0.name")).toBe(false);
  });
});

describe("revealPathInHost", () => {
  it("遍历容器内 iframe 并在至少一帧命中时返回 true", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const frame = document.createElement("iframe");
    host.appendChild(frame);
    const doc = frame.contentDocument;
    if (!doc) throw new Error("iframe document missing");
    const node = doc.createElement("span");
    node.setAttribute("data-resume-path", "experience.0.company");
    const scroll = vi.fn();
    node.scrollIntoView = scroll;
    doc.body.appendChild(node);
    expect(revealPathInHost(host, "experience.0.company")).toBe(true);
    expect(scroll).toHaveBeenCalled();
    expect(revealPathInHost(host, "education.0.school")).toBe(false);
    expect(revealPathInHost(null, "experience.0.company")).toBe(false);
  });
});
