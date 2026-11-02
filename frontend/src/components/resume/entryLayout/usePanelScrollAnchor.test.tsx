// SPDX-License-Identifier: Apache-2.0
/**
 * R-10 面板滚动锚定（`usePanelScrollAnchor`）。
 *
 * 判据：面板内容因一次改动重排之后，**滚动位置不变**——用户刚点的那一行不会被顶出视野。
 *
 * jsdom 没有布局，`scrollTop` 是只读的 0，所以每个用例都用 `Object.defineProperty`
 * 造一个可读写的 `scrollTop`（与 `dragAutoScroll.test.ts` 同一手法）；
 * `getComputedStyle` 也只认内联样式，滚动容器必须用内联 `overflowY` 声明。
 */
import { fireEvent, render } from "@testing-library/react";
import type { CSSProperties } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePanelScrollAnchor } from "./usePanelScrollAnchor";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

/** 造一个可写 `scrollTop` 的滚动容器（返回读写当前值的闭包）。 */
function makeScrollable(element: HTMLElement, initial: number) {
  let value = initial;
  Object.defineProperty(element, "scrollTop", {
    configurable: true,
    get: () => value,
    set: (next: number) => {
      value = next;
    },
  });
  return {
    read: () => value,
    write: (next: number) => {
      value = next;
    },
  };
}

/** 面板：外层是可滚容器（内联 overflowY:auto），里层是被挂 ref 的内容节点。 */
function Panel({
  dep,
  overflowY = "auto",
}: {
  dep: unknown;
  overflowY?: CSSProperties["overflowY"];
}) {
  const ref = usePanelScrollAnchor<HTMLDivElement>(dep);
  return (
    <div style={{ overflowY, height: 100 }} data-testid="scroller">
      <div ref={ref} data-testid="content" style={{ height: 400 }} />
    </div>
  );
}

/**
 * 复刻生产形态：面板**条件渲染**（左栏结构页签首帧不存在），容器自己就是被挂 ref 的
 * 可滚节点（生产里它带 `data-panel-scroll="structure"`）。
 *
 * QA 复验的回归就是这条路径：首帧没有节点 → 早先的 `useEffect(..., [])` 挂不上监听、
 * 快照永远是初值 0 → 用户滚到 200 再改文档时被主动写回 0。
 */
function ConditionalPanel({ dep, show }: { dep: unknown; show: boolean }) {
  const ref = usePanelScrollAnchor<HTMLDivElement>(dep);
  // key 必须不同：生产里换页签是把整块面板换成**另一个**子树（DOM 节点会被重建）；
  // 没有 key 时 React 会复用同一个 div（只改 props），测试就测不到"节点重建"这条路径。
  if (!show) return <div key="placeholder" data-testid="placeholder" />;
  return (
    <div
      key="scroller"
      ref={ref}
      data-panel-scroll="structure"
      style={{ overflowY: "auto", height: 100 }}
      data-testid="scroller"
    >
      <div style={{ height: 400 }} />
    </div>
  );
}

describe("usePanelScrollAnchor（R-10）", () => {
  it("dep 变化后把 scrollTop 写回快照值（不被重排甩到顶部）", () => {
    const { getByTestId, rerender } = render(<Panel dep={1} />);
    const scroller = getByTestId("scroller");
    const state = makeScrollable(scroller, 0);

    // 用户滚到 120：scroll 事件刷新快照。
    state.write(120);
    fireEvent.scroll(scroller);

    // 重排：浏览器（或 antd 的 auto-scroll）把位置甩回顶部。
    state.write(0);
    rerender(<Panel dep={2} />);
    expect(state.read()).toBe(120);

    // 再换一次 dep：快照仍是 120（写回之后没有被改坏）。
    state.write(0);
    rerender(<Panel dep={3} />);
    expect(state.read()).toBe(120);
  });

  it("容器不滚动（overflowY: visible）时什么都不做，也不抛错", () => {
    const { getByTestId, rerender } = render(<Panel dep={1} overflowY="visible" />);
    const scroller = getByTestId("scroller");
    const state = makeScrollable(scroller, 0);
    state.write(80);

    expect(() => {
      fireEvent.scroll(scroller);
      rerender(<Panel dep={2} overflowY="visible" />);
    }).not.toThrow();
    // 找不到滚动容器 = 不锚定，位置由浏览器说了算。
    expect(state.read()).toBe(80);
  });

  it("卸载时移除 scroll 监听（不留悬挂监听）", () => {
    const addSpy = vi.spyOn(HTMLElement.prototype, "addEventListener");
    const removeSpy = vi.spyOn(HTMLElement.prototype, "removeEventListener");
    const { getByTestId, unmount } = render(<Panel dep={1} />);
    const scroller = getByTestId("scroller");
    makeScrollable(scroller, 0);

    const added = addSpy.mock.calls.filter(([type]) => type === "scroll");
    expect(added.length).toBeGreaterThan(0);
    const handler = added[added.length - 1][1];

    unmount();
    const removed = removeSpy.mock.calls.filter(
      ([type, candidate]) => type === "scroll" && candidate === handler,
    );
    expect(removed.length).toBeGreaterThan(0);
  });

  it("条件渲染：面板晚于首帧出现、用户滚过之后再改 dep，不会被写回 0（QA 复验回归）", () => {
    const { getByTestId, queryByTestId, rerender } = render(
      <ConditionalPanel dep={1} show={false} />,
    );
    // 首帧面板不存在（= 停留在「排版参数」页签，结构面板还没挂载）。
    expect(queryByTestId("scroller")).toBeNull();

    rerender(<ConditionalPanel dep={1} show />);
    const scroller = getByTestId("scroller");
    const state = makeScrollable(scroller, 0);

    // 用户把结构面板滚到 200：scroll 事件刷新快照。
    state.write(200);
    fireEvent.scroll(scroller);

    // 改一个条目（document 变 → dep 变）：位置必须是 200，**不是 0**。
    rerender(<ConditionalPanel dep={2} show />);
    expect(state.read()).toBe(200);

    // 浏览器在重排里把位置甩回顶部时，也要按快照恢复成 200。
    state.write(0);
    rerender(<ConditionalPanel dep={3} show />);
    expect(state.read()).toBe(200);
  });

  it("条件渲染：刚出现还没滚动就改 dep，不写回也不抛错（首次出现不建假快照）", () => {
    const { getByTestId, rerender } = render(<ConditionalPanel dep={1} show={false} />);
    rerender(<ConditionalPanel dep={1} show />);
    const scroller = getByTestId("scroller");
    const state = makeScrollable(scroller, 0);

    expect(() => rerender(<ConditionalPanel dep={2} show />)).not.toThrow();
    expect(state.read()).toBe(0);
  });

  it("切走页签再切回来要回顶部：节点卸载即丢弃快照，不恢复上次的 200", () => {
    const { getByTestId, queryByTestId, rerender } = render(
      <ConditionalPanel dep={1} show={false} />,
    );

    // 面板出现 → 用户滚到 200（快照 = 200）。
    rerender(<ConditionalPanel dep={1} show />);
    const first = makeScrollable(getByTestId("scroller"), 0);
    first.write(200);
    fireEvent.scroll(getByTestId("scroller"));

    // 切到别的页签：结构面板卸载（`changeTab` 同时把整列 scrollTop 归零）。
    rerender(<ConditionalPanel dep={1} show={false} />);
    expect(queryByTestId("scroller")).toBeNull();

    // 切回来：新节点从 0 开始，而且**不能**被旧快照拉回 200。
    rerender(<ConditionalPanel dep={1} show />);
    const second = makeScrollable(getByTestId("scroller"), 0);
    expect(second.read()).toBe(0);

    // 之后改文档（dep 变）也不会恢复成 200。
    rerender(<ConditionalPanel dep={2} show />);
    expect(second.read()).toBe(0);
  });

  /**
   * 「0 绝不主动写回」。
   *
   * 快照为 0 有一个几分钟内看不出来、但真实存在的来路：面板刚挂载的那几帧浏览器还没把
   * 用户原来的位置还原回来（自动还原 / 祖先容器的滚动锚定都可以晚于挂载）。此刻取到的 0
   * 不代表用户在看顶部，把它写回去就是把用户拽回顶部——正是本任务报的现象。
   */
  it("快照仍为 0 时绝不主动写 0（浏览器晚一步还原位置的空窗口）", () => {
    const { getByTestId, rerender } = render(<ConditionalPanel dep={1} show={false} />);
    rerender(<ConditionalPanel dep={1} show />);
    const scroller = getByTestId("scroller");
    // 挂载那一刻读到的是 0（监听是在这之后挂上的）。
    const state = makeScrollable(scroller, 0);

    // 浏览器随后把位置还原成 300，但没有派发 scroll 事件（自动还原不走事件）。
    state.write(300);

    rerender(<ConditionalPanel dep={2} show />);
    expect(state.read()).toBe(300);
  });

  it("亚像素差（≤1px）不写回：不打断浏览器的滚动锚定", () => {
    const { getByTestId, rerender } = render(<Panel dep={1} />);
    const scroller = getByTestId("scroller");
    const state = makeScrollable(scroller, 0);

    state.write(120);
    fireEvent.scroll(scroller); // 快照 = 120

    // 重排把位置挪了 0.6px：用户看不出来，别写。
    state.write(120.6);
    rerender(<Panel dep={2} />);
    expect(state.read()).toBe(120.6);
  });
});
