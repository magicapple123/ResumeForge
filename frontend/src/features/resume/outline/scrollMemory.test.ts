// SPDX-License-Identifier: Apache-2.0
/** D01 滚动位置记忆/恢复（大纲树 + 画布 iframe）的纯逻辑。 */
import { describe, expect, it } from "vitest";
import {
  createScrollMemory,
  rememberElementScroll,
  rememberFrameScrolls,
  restoreElementScroll,
  restoreFrameScrolls,
  scrollTreeKeyIntoView,
} from "./scrollMemory";

describe("ScrollMemory（大纲树）", () => {
  it("记住 → 恢复；没有记忆时不把元素重置成 0", () => {
    const memory = createScrollMemory();
    const element = { scrollTop: 42 };
    expect(restoreElementScroll(memory, "tree", element)).toBe(false);
    expect(element.scrollTop).toBe(42);
    rememberElementScroll(memory, "tree", element);
    element.scrollTop = 0;
    expect(restoreElementScroll(memory, "tree", element)).toBe(true);
    expect(element.scrollTop).toBe(42);
    expect(memory.peek("tree")).toBe(42);
    memory.forget("tree");
    expect(memory.has("tree")).toBe(false);
  });

  it("空元素不覆盖已有记忆；负数收敛到 0", () => {
    const memory = createScrollMemory();
    memory.remember("tree", 10);
    rememberElementScroll(memory, "tree", null);
    expect(memory.peek("tree")).toBe(10);
    memory.remember("tree", -5);
    expect(memory.peek("tree")).toBe(0);
  });
});

interface FakeFrame {
  contentWindow: { scrollTop: number; scrollLeft: number } | null;
}

function hostOf(frames: FakeFrame[]) {
  return {
    // 与 DOM 的 querySelectorAll 同签名；测试里只有一种节点，参数只为类型兼容。
    querySelectorAll: (selector: string) => {
      void selector;
      return frames;
    },
  };
}

describe("FrameScroll（画布 iframe）", () => {
  it("按帧序保存/恢复 scrollTop 与 scrollLeft", () => {
    const host = hostOf([
      { contentWindow: { scrollTop: 120, scrollLeft: 0 } },
      { contentWindow: { scrollTop: 40, scrollLeft: 5 } },
    ]);
    const snapshot = rememberFrameScrolls(host);
    expect(snapshot).toEqual([
      { top: 120, left: 0 },
      { top: 40, left: 5 },
    ]);
    host.querySelectorAll("iframe")[0].contentWindow!.scrollTop = 0;
    host.querySelectorAll("iframe")[1].contentWindow!.scrollTop = 0;
    expect(restoreFrameScrolls(host, snapshot)).toBe(true);
    expect(host.querySelectorAll("iframe")[0].contentWindow!.scrollTop).toBe(120);
    expect(host.querySelectorAll("iframe")[1].contentWindow!.scrollLeft).toBe(5);
  });

  it("帧数量变化：只恢复仍然存在的帧；空容器/空快照返回 false", () => {
    const host = hostOf([{ contentWindow: { scrollTop: 0, scrollLeft: 0 } }]);
    const snapshot = [
      { top: 10, left: 0 },
      { top: 20, left: 0 },
    ];
    expect(restoreFrameScrolls(host, snapshot)).toBe(true);
    expect(host.querySelectorAll("iframe")[0].contentWindow!.scrollTop).toBe(10);
    expect(restoreFrameScrolls(hostOf([]), snapshot)).toBe(false);
    expect(restoreFrameScrolls(host, [])).toBe(false);
  });
});

describe("scrollTreeKeyIntoView", () => {
  it("按 data-tree-key 找行并 scrollIntoView；找不到/没有方法返回 false", () => {
    const calls: unknown[] = [];
    const node = { scrollIntoView: (options?: ScrollIntoViewOptions) => calls.push(options) };
    const container = {
      querySelector: (selector: string) =>
        selector === '[data-tree-key="entry:projects:ob_1"]' ? node : null,
    };
    expect(scrollTreeKeyIntoView(container, "entry:projects:ob_1")).toBe(true);
    expect(calls).toEqual([{ block: "nearest" }]);
    expect(scrollTreeKeyIntoView(container, "entry:projects:missing")).toBe(false);
    expect(scrollTreeKeyIntoView({ querySelector: () => ({}) }, "x")).toBe(false);
  });
});
