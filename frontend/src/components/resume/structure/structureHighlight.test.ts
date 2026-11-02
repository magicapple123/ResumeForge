// SPDX-License-Identifier: Apache-2.0
import { act, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SelectionSource } from "../useWorkbenchSelectionSync";
import { useWorkbenchSelectionSync } from "../useWorkbenchSelectionSync";
import {
  applyStructureHighlightToDocument,
  buildStructureHighlightCss,
  highlightTargetsForNode,
  highlightTargetsForPath,
  paintStructureHighlight,
  REVEAL_REPLAY_WINDOW_MS,
  REVEAL_RETRY_MS,
  revealPathInDocument,
  revealPathInHost,
  STRUCTURE_HIGHLIGHT_CONTAINER_DECLARATION,
  STRUCTURE_HIGHLIGHT_CONTAINER_HOVER_DECLARATION,
  STRUCTURE_HIGHLIGHT_DECLARATION,
  STRUCTURE_HIGHLIGHT_PAINT_SELECTED,
  STRUCTURE_HIGHLIGHT_STYLE_ID,
  useCanvasPathHighlight,
} from "./structureHighlight";
import type { StructureViewNode } from "./structureView";

afterEach(() => {
  vi.useRealTimers();
});

function node(
  partial: Partial<StructureViewNode> & Pick<StructureViewNode, "kind" | "path">,
): StructureViewNode {
  return { key: "k:" + partial.path, label: "x", ...partial };
}

describe("structureHighlight · CSS", () => {
  it("字段用等值选择器，条目/板块按粒度画在容器上（问题 7 方案 A）", () => {
    const css = buildStructureHighlightCss([
      { path: "education.entry_1.school_1", kind: "item" },
      { path: "education.entry_1", kind: "entry" },
      { path: "education", kind: "section" },
    ]);
    expect(css).toContain('[data-resume-path="education.entry_1.school_1"]');
    expect(css).toContain('.entry[data-object-id="entry_1"]');
    expect(css).toContain('.section[data-section="education"]');
    // 容器不再退化成"前缀匹配所有叶子"：那条规则一条都不该出现。
    expect(css).not.toContain("[data-resume-path^=");
    expect(css).toContain(STRUCTURE_HIGHLIGHT_DECLARATION);
    expect(css).toContain(STRUCTURE_HIGHLIGHT_CONTAINER_HOVER_DECLARATION);
  });

  it("选中档：叶子与容器各用一套声明，容器只有一条规则", () => {
    const css = buildStructureHighlightCss(
      [{ path: "education", kind: "section" }],
      STRUCTURE_HIGHLIGHT_PAINT_SELECTED,
    );
    const rules = css.split("\n").filter(Boolean);
    expect(rules).toHaveLength(1);
    expect(rules[0].startsWith('.section[data-section="education"]')).toBe(true);
    // 容器档：淡底 + 1px 细边（字段那档的 2px 描边不该出现在容器上）。
    expect(css).toContain(STRUCTURE_HIGHLIGHT_CONTAINER_DECLARATION);
    expect(css).not.toContain("data-resume-path");
    expect(css).not.toContain("0 0 0 2px");
  });

  it("自定义板块 key（含冒号）与含连字符的 id 都是合法路径", () => {
    const css = buildStructureHighlightCss([
      { path: "custom:6f1c2a44-abc.entry-1.school_1", kind: "item" },
    ]);
    expect(css).toContain("custom:6f1c2a44-abc.entry-1.school_1");
    // 板块 key 带冒号时，容器选择器同样成立。
    expect(
      buildStructureHighlightCss([{ path: "custom:6f1c2a44-abc", kind: "section" }]),
    ).toContain('.section[data-section="custom:6f1c2a44-abc"]');
  });

  it("非法路径（含引号/空格）直接跳过", () => {
    expect(buildStructureHighlightCss([{ path: 'a"b', kind: "item" }])).toBe("");
    expect(buildStructureHighlightCss([{ path: "a b", kind: "item" }])).toBe("");
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

  it("字段/条目/板块各按粒度高亮、分组展开成组内字段", () => {
    expect(highlightTargetsForNode(field)).toEqual([
      { path: "education.entry_1.school_1", kind: "item" },
    ]);
    expect(highlightTargetsForNode(entry)).toEqual([{ path: "education.entry_1", kind: "entry" }]);
    expect(highlightTargetsForNode(section)).toEqual([{ path: "education", kind: "section" }]);
    expect(highlightTargetsForNode(group)).toEqual([
      { path: "education.entry_1.school_1", kind: "item" },
    ]);
    expect(highlightTargetsForNode(null)).toEqual([]);
  });

  it("只有路径时按段数判粒度：页眉字段 / 板块(1 段) / 条目(2 段) / 字段(≥3 段)", () => {
    expect(highlightTargetsForPath("header.name")).toEqual([{ path: "header.name", kind: "item" }]);
    expect(highlightTargetsForPath("education")).toEqual([{ path: "education", kind: "section" }]);
    expect(highlightTargetsForPath("education.ob_entry1")).toEqual([
      { path: "education.ob_entry1", kind: "entry" },
    ]);
    expect(highlightTargetsForPath("education.ob_entry1.ob_title")).toEqual([
      { path: "education.ob_entry1.ob_title", kind: "item" },
    ]);
    expect(highlightTargetsForPath("")).toEqual([]);
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

  it("目标已在视口中部 1/3 内就不滚（命中但不动）", () => {
    const doc = fakeDoc();
    const scrollTo = vi.fn();
    Object.defineProperty(doc, "defaultView", {
      value: { innerWidth: 794, innerHeight: 1000, scrollY: 0, scrollTo },
      configurable: true,
    });
    const target = doc.createElement("span");
    target.setAttribute("data-resume-path", "education.entry_1.school_1");
    // 中心 500px，落在 [1000/3, 2000/3] = [333, 667] 里。
    target.getBoundingClientRect = () =>
      ({ left: 100, right: 220, top: 490, height: 20 }) as DOMRect;
    doc.body.appendChild(target);

    expect(revealPathInDocument(doc, "education.entry_1.school_1")).toBe(true);
    expect(scrollTo).not.toHaveBeenCalled();
  });
});

/**
 * 夹具：纸面 = 外层相框（可纵向滚）+ 一帧 iframe（帧内不可滚，与生产一致）。
 *
 * 真实 div 作容器与滚动层（`getComputedStyle` / `MutationObserver` 都要真 Element），
 * 只把 iframe 元素与它的 `contentDocument` 换成夹具。
 */
function makePaper(options: { frameTop?: number; nodeTop?: number; nodePath?: string }) {
  const doc = document.implementation.createHTMLDocument("resume");
  const innerScrollTo = vi.fn();
  Object.defineProperty(doc, "defaultView", {
    value: { innerWidth: 794, innerHeight: 1123, scrollY: 0, scrollTo: innerScrollTo },
    configurable: true,
  });
  const addNode = (path: string, top: number) => {
    const node = doc.createElement("span");
    node.setAttribute("data-resume-path", path);
    node.getBoundingClientRect = () => ({ left: 100, right: 220, top, height: 20 }) as DOMRect;
    doc.body.appendChild(node);
    return node;
  };
  if (options.nodeTop !== undefined)
    addNode(options.nodePath ?? "education.e1.school", options.nodeTop);

  let scrollTop = 0;
  const scroller = document.createElement("div");
  scroller.style.overflowY = "auto";
  Object.defineProperty(scroller, "clientHeight", { value: 598, configurable: true });
  Object.defineProperty(scroller, "scrollHeight", { value: 1872, configurable: true });
  Object.defineProperty(scroller, "scrollTop", {
    get: () => scrollTop,
    set: (next: number) => {
      scrollTop = next;
    },
    configurable: true,
  });
  scroller.getBoundingClientRect = () => ({ top: 0, left: 0, width: 800, height: 598 }) as DOMRect;
  const scrollTo = vi.fn((opts: ScrollToOptions) => {
    scrollTop = opts.top ?? 0;
  });
  (scroller as unknown as { scrollTo: typeof scrollTo }).scrollTo = scrollTo;
  document.body.appendChild(scroller);

  const frameTop = options.frameTop ?? 100;
  const frame = {
    contentDocument: doc,
    clientWidth: 794,
    clientHeight: 1123,
    // 相框被缩放：元素 925px 装 1123px 的内容 → 0.824。
    getBoundingClientRect: () =>
      ({
        left: 0,
        right: 654,
        top: frameTop,
        bottom: frameTop + 925,
        width: 654,
        height: 925,
      }) as DOMRect,
    parentElement: scroller,
  } as unknown as HTMLIFrameElement;

  const host = document.createElement("div");
  Object.defineProperty(host, "querySelectorAll", { value: () => [frame], configurable: true });
  return { host, doc, addNode, scrollTo, innerScrollTo, read: () => scrollTop };
}

function RevealProbe({
  container,
  reveal,
}: {
  container: HTMLElement;
  reveal: { path: string; nonce: number };
}) {
  useCanvasPathHighlight({ targets: [], container, reveal });
  return null;
}

/** 定位链路：iframe 重载 / 旧 HTML 时要有重试与限时重放。 */
describe("structureHighlight · 定位重试与重放", () => {
  it("目标还没进这一版 HTML：有界重试，重排后仍能定位", () => {
    vi.useFakeTimers();
    const paper = makePaper({ nodeTop: undefined });
    render(
      createElement(RevealProbe, {
        container: paper.host,
        reveal: { path: "education.e1.school", nonce: 1 },
      }),
    );
    // 首次尝试：iframe 里还是旧 HTML。
    expect(paper.scrollTo).not.toHaveBeenCalled();

    // 重排完成，目标出现（中心 ≈ 100 + 910×0.824 ≈ 850，在可视区 598 之外）。
    paper.addNode("education.e1.school", 900);
    act(() => {
      vi.advanceTimersByTime(REVEAL_RETRY_MS);
    });
    expect(paper.scrollTo).toHaveBeenCalledTimes(1);
  });

  it("定位成功后 iframe 重载会重放一次；超出重放窗口后不再打扰", () => {
    vi.useFakeTimers();
    const paper = makePaper({ nodeTop: 900 });
    render(
      createElement(RevealProbe, {
        container: paper.host,
        reveal: { path: "education.e1.school", nonce: 1 },
      }),
    );
    expect(paper.scrollTo).toHaveBeenCalledTimes(1);

    // 选中后立刻改一个字 → 实时预览重排 → iframe 重载 → 重放（纸面仍停在选中项）。
    // 重放前把位置挪回顶部，才能看出"又滚了一次"。
    act(() => {
      paper.host.dispatchEvent(new Event("load"));
    });
    expect(paper.scrollTo).toHaveBeenCalledTimes(2);

    // 过了重放窗口还重载：不再把用户拽回选中项。
    vi.advanceTimersByTime(REVEAL_REPLAY_WINDOW_MS + 1000);
    act(() => {
      paper.host.dispatchEvent(new Event("load"));
    });
    expect(paper.scrollTo).toHaveBeenCalledTimes(2);
  });
});

/**
 * 纸面的纵向滚动发生在**外层相框**（`.resume-preview-body`），iframe 帧内没有滚动量
 * （2026-11-02 实测：iframe 元素 437×618、内部文档 1123 且 clientHeight 也是 1123）。
 * 只调 `view.scrollTo` 等于什么都没做——这就是"选中时纸面不定位"的直接原因。
 */
describe("structureHighlight · 外层相框定位", () => {
  it("目标在相框可视区之外：滚外层容器，把它放到中间（只动 scrollTop）", () => {
    const paper = makePaper({ nodeTop: 900 });
    expect(revealPathInHost(paper.host, "education.e1.school")).toBe(true);
    expect(paper.scrollTo).toHaveBeenCalledTimes(1);
    // 目标中心 ≈ 100 + 910 × 0.824 ≈ 850；居中要减掉半个可视高度（299）。
    const top = paper.scrollTo.mock.calls[0][0].top ?? 0;
    expect(top).toBeGreaterThan(400);
    expect(top).toBeLessThan(700);
    // 帧内没有滚动量：不该去动 iframe 自己的 window（那正是改前的空转实现）。
    expect(paper.innerScrollTo).not.toHaveBeenCalled();
  });

  it("目标已在相框可视区中部 1/3：命中但不滚", () => {
    const paper = makePaper({ nodeTop: 250 });
    expect(revealPathInHost(paper.host, "education.e1.school")).toBe(true);
    expect(paper.scrollTo).not.toHaveBeenCalled();
  });

  it("多页简历：目标在第 2 页的 iframe 里 → 滚到那一页，不横向移动", () => {
    // 第 1 页没有这个路径：不命中、不滚。
    const first = makePaper({ nodeTop: 400, nodePath: "header.hd_1" });
    // 第 2 页在这一份 HTML 里：中心 ≈ 1037 + 410 × 0.824 ≈ 1375，远超可视区 598。
    const second = makePaper({ nodeTop: 400, frameTop: 1037 });

    expect(revealPathInHost(first.host, "education.e1.school")).toBe(false);
    expect(first.scrollTo).not.toHaveBeenCalled();

    expect(revealPathInHost(second.host, "education.e1.school")).toBe(true);
    expect(second.scrollTo).toHaveBeenCalledTimes(1);
    // 只写 top：横向位置由分页逻辑维护，横移一下只会看到另一列的一条竖排文字。
    const arg = second.scrollTo.mock.calls[0][0];
    expect(arg.behavior).toBe("smooth");
    expect((arg as { left?: number }).left).toBeUndefined();
  });
});

/**
 * 选中态 → 定位的整条链路（任务 8 / 第二轮返工缺陷 D1）。
 *
 * 现场：结构树点 A 之后，`canvasReveal` 一直指向 A（`nonce` 不再变）。此时在纸面上点字段 B，
 * `selectedPath` 变了 → 消费方 effect 的 deps `[revealPath, revealNonce]` 也跟着变 →
 * 把纸面又滚了一次。现在令牌（`canvasReveal`）与当前选中不一致就作废，纸面点击不会重写它，
 * effect 也就不会被"纸面来源"的选中唤醒。
 *
 * 判据用**真实几何**：两个目标都放在纸面可视区中部 1/3 之外，若错误地发起一次 reveal，
 * `scrollTop` 必然变（不是"恰好本来就在眼前所以看不出来"）。
 */
function SelectionRevealProbe({
  container,
  onRender,
}: {
  container: HTMLElement;
  onRender: (api: {
    selectPath: (path: string | null, source?: SelectionSource) => void;
    pickFromPaper: (path: string) => void;
  }) => void;
}) {
  const selection = useWorkbenchSelectionSync("7|open");
  useCanvasPathHighlight({ targets: [], container, reveal: selection.canvasReveal });
  onRender({ selectPath: selection.selectPath, pickFromPaper: selection.pickFromPaper });
  return null;
}

describe("structureHighlight · 纸面点击不滚纸面（令牌不被纸面来源重写）", () => {
  it("结构树选中 A → 纸面点 B：只换高亮，scrollTop 不变", () => {
    const paper = makePaper({ nodeTop: undefined });
    // 两个目标都在可视区中部 1/3（199-399）之外：谁被 reveal 谁就会改 scrollTop。
    paper.addNode("education.e1.a", 900);
    paper.addNode("education.e1.b", 1200);
    const actions: {
      selectPath?: (path: string | null, source?: SelectionSource) => void;
      pickFromPaper?: (path: string) => void;
    } = {};
    render(
      createElement(SelectionRevealProbe, {
        container: paper.host,
        onRender: (api) => {
          actions.selectPath = api.selectPath;
          actions.pickFromPaper = api.pickFromPaper;
        },
      }),
    );

    // 结构树选中 A → 定位一次（A 的中心在可视区之外）。
    act(() => actions.selectPath?.("education.e1.a", "structure"));
    expect(paper.scrollTo).toHaveBeenCalledTimes(1);
    const afterRevealA = paper.read();
    expect(afterRevealA).toBeGreaterThan(0);

    // 纸面点 B：令牌作废 ⇒ 不消费、不滚。B 同样在中部 1/3 之外，
    // 所以"没滚"只可能来自令牌失效，不是"本来就在眼前"。
    act(() => actions.pickFromPaper?.("education.e1.b"));
    expect(paper.scrollTo).toHaveBeenCalledTimes(1);
    expect(paper.read()).toBe(afterRevealA);

    // 结构树再选 B：令牌续生 → 正常定位（修复不能把定位一起弄丢）。
    act(() => actions.selectPath?.("education.e1.b", "structure"));
    expect(paper.scrollTo).toHaveBeenCalledTimes(2);
    expect(paper.read()).not.toBe(afterRevealA);
  });
});
