// SPDX-License-Identifier: Apache-2.0
/**
 * T06 面板滚动锚定：**元素锚定**的契约。
 *
 * 旧模型记 `scrollTop` 数字再写回，补丁补不掉"数字会过期"；这里测的是新模型的四条硬规则：
 * 1. 锚点还在 → 只按"同一节点的新旧偏移差"写**一次**；
 * 2. 锚点找不到 → **什么都不做**（绝不回落到旧数字）；
 * 3. `≤1px` 不写（不打断浏览器的滚动锚定）；
 * 4. 容器没真滚（`scrollHeight <= clientHeight`）时不当滚动容器。
 *
 * jsdom 没有布局：`scrollTop` 只读、`getBoundingClientRect` 恒 0，所以逐节点桩掉这三样
 * （手法同 `dragAutoScroll.test.ts`）。
 */
import { fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePanelScrollAnchor } from "./usePanelScrollAnchor";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

/** 可写 `scrollTop` + 固定几何的"滚动容器"。 */
function makeScroller(element: HTMLElement, initial = 0) {
  let value = initial;
  Object.defineProperty(element, "scrollTop", {
    configurable: true,
    get: () => value,
    set: (next: number) => {
      value = next;
    },
  });
  Object.defineProperty(element, "scrollHeight", { configurable: true, get: () => 1000 });
  Object.defineProperty(element, "clientHeight", { configurable: true, get: () => 100 });
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ top: 100, bottom: 200, left: 0, right: 300, width: 300, height: 100 }),
  });
  return {
    read: () => value,
    write: (next: number) => {
      value = next;
    },
  };
}

/** 叶子行：只桩 `top`，模拟"上方内容增高/变矮把它推走"。 */
function makeLeaf(element: HTMLElement, top: () => number) {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ top: top(), bottom: top() + 20, left: 0, right: 300, width: 300, height: 20 }),
  });
}

/**
 * `setup` 在 callback ref 里跑：那一刻节点已进 DOM、但 hook 的被动 effect 还没执行，
 * 所以锚点第一次 capture 就能读到桩好的几何（jsdom 的默认值是 0，桩晚了就抓不到）。
 */
function Panel({ dep, setup }: { dep: unknown; setup?: (panel: HTMLElement) => void }) {
  const ref = usePanelScrollAnchor<HTMLDivElement>(dep);
  return (
    <div
      ref={(node) => {
        if (node && setup) setup(node);
        ref(node);
      }}
      data-panel-scroll="structure"
      data-testid="panel"
      // jsdom 的 getComputedStyle 只认内联样式：不写这一行，`overflow-y` 读出来是默认值，
      // `isScrollable` 直接判 false（这不是产品 bug，是测试环境的限制）。
      style={{ overflowY: "auto", height: 100 }}
    >
      <span data-testid="leaf">row</span>
    </div>
  );
}

describe("usePanelScrollAnchor（T06 元素锚定）", () => {
  it("锚点还在：按同一节点的新旧偏移差写一次", () => {
    let leafTop = 200;
    let scroller: ReturnType<typeof makeScroller> | null = null;
    const { rerender } = render(
      <Panel
        dep={1}
        setup={(panel) => {
          scroller = makeScroller(panel, 0);
          makeLeaf(panel.querySelector("[data-testid=leaf]") as HTMLElement, () => leafTop);
        }}
      />,
    );

    // 上方内容长高 60px：这一行被推下去 60。
    leafTop = 260;
    rerender(
      <Panel
        dep={2}
        setup={(panel) => {
          scroller = makeScroller(panel, 0);
          makeLeaf(panel.querySelector("[data-testid=leaf]") as HTMLElement, () => leafTop);
        }}
      />,
    );
    expect(scroller!.read()).toBe(60);
  });

  it("锚点节点没了（被重排换掉）：什么都不做，不回落到旧数字", () => {
    let leafTop = 200;
    const { getByTestId, rerender } = render(<Panel dep={1} />);
    const panel = getByTestId("panel");
    const scroller = makeScroller(panel, 40);
    const leaf = getByTestId("leaf");
    makeLeaf(leaf, () => leafTop);
    fireEvent.scroll(panel);

    // 锚点被移出文档树：`isConnected === false`。
    leaf.remove();
    leafTop = 500;
    rerender(<Panel dep={2} />);
    expect(scroller.read()).toBe(40);
  });

  it("1px 以内的差不动（不打断浏览器的滚动锚定）", () => {
    let leafTop = 200;
    const { getByTestId, rerender } = render(<Panel dep={1} />);
    const panel = getByTestId("panel");
    const scroller = makeScroller(panel, 0);
    makeLeaf(getByTestId("leaf"), () => leafTop);
    fireEvent.scroll(panel);

    leafTop = 200.6;
    rerender(<Panel dep={2} />);
    expect(scroller.read()).toBe(0);
  });

  it("面板没真滚（内容比容器短）时不当滚动容器，也不写", () => {
    const { getByTestId, rerender } = render(<Panel dep={1} />);
    const panel = getByTestId("panel");
    const scroller = makeScroller(panel, 0);
    // 内容没超出：scrollHeight == clientHeight。
    Object.defineProperty(panel, "scrollHeight", { configurable: true, get: () => 100 });

    expect(() => rerender(<Panel dep={2} />)).not.toThrow();
    expect(scroller.read()).toBe(0);
  });

  it("卸载时移除 scroll 监听（不留悬挂监听）", () => {
    const addSpy = vi.spyOn(HTMLElement.prototype, "addEventListener");
    const removeSpy = vi.spyOn(HTMLElement.prototype, "removeEventListener");
    const { unmount } = render(<Panel dep={1} setup={(panel) => makeScroller(panel, 0)} />);

    const added = addSpy.mock.calls.filter(([type]) => type === "scroll");
    expect(added.length).toBeGreaterThan(0);
    const handler = added[added.length - 1][1];

    unmount();
    const removed = removeSpy.mock.calls.filter(
      ([type, candidate]) => type === "scroll" && candidate === handler,
    );
    expect(removed.length).toBeGreaterThan(0);
  });

  it("用户自己滚动不会被拽回去（只在 dep 变化时校正）", () => {
    const leafTop = 200;
    const { getByTestId } = render(<Panel dep={1} />);
    const panel = getByTestId("panel");
    const scroller = makeScroller(panel, 0);
    makeLeaf(getByTestId("leaf"), () => leafTop);
    fireEvent.scroll(panel);

    // 纯滚动：不触发任何写。
    scroller.write(320);
    fireEvent.scroll(panel);
    expect(scroller.read()).toBe(320);
  });
});
