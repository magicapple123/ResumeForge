/** 拖拽自动滚动：边缘判定（纯函数）+ 逐帧滚动器 + 滚动父级定位。 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AUTO_SCROLL_EDGE_PX,
  AUTO_SCROLL_MAX_STEP_PX,
  compensateReleaseShift,
  createEdgeAutoScroller,
  disableScrollAnchoring,
  RELEASE_SETTLE_MAX_FRAMES,
  edgeScrollDelta,
  layoutTopWithoutTransform,
  readTranslateY,
  resolveScrollParent,
} from "./dragAutoScroll";

/** 造一个只有 top 有意义的 DOMRect。 */
function rect(top: number): DOMRect {
  return {
    top,
    bottom: top + 10,
    height: 10,
    left: 0,
    right: 10,
    width: 10,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

/** 可视区 0~800，边缘带 64。 */
const TOP = 0;
const BOTTOM = 800;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("edgeScrollDelta", () => {
  it("提速后每帧最大步长是 28px（旧行为 14px 的一半时间跨屏）", () => {
    expect(AUTO_SCROLL_MAX_STEP_PX).toBe(28);
  });

  it("指针落在中间区域不滚动（含边缘带边界本身）", () => {
    expect(edgeScrollDelta(400, TOP, BOTTOM)).toBe(0);
    // 边界值不算进入带状区（严格小于 / 大于）。
    expect(edgeScrollDelta(TOP + AUTO_SCROLL_EDGE_PX, TOP, BOTTOM)).toBe(0);
    expect(edgeScrollDelta(BOTTOM - AUTO_SCROLL_EDGE_PX, TOP, BOTTOM)).toBe(0);
  });

  it("贴上边缘时达到最大步长，越靠内线性变小", () => {
    expect(edgeScrollDelta(TOP, TOP, BOTTOM)).toBe(-AUTO_SCROLL_MAX_STEP_PX);
    expect(edgeScrollDelta(BOTTOM, TOP, BOTTOM)).toBe(AUTO_SCROLL_MAX_STEP_PX);
    // 刚进入带状区 1px：仍有 1px 的步长（不会卡住不动）。
    expect(edgeScrollDelta(TOP + AUTO_SCROLL_EDGE_PX - 1, TOP, BOTTOM)).toBe(-1);
    expect(edgeScrollDelta(BOTTOM - AUTO_SCROLL_EDGE_PX + 1, TOP, BOTTOM)).toBe(1);
    // 中间位置：线性且不超过最大步长。
    const mid = edgeScrollDelta(TOP + AUTO_SCROLL_EDGE_PX / 2, TOP, BOTTOM);
    expect(mid).toBeLessThan(0);
    expect(mid).toBeGreaterThanOrEqual(-AUTO_SCROLL_MAX_STEP_PX);
  });

  it("指针在可视区之外也按最大步长滚（拖出容器时不留死区）", () => {
    expect(edgeScrollDelta(-500, TOP, BOTTOM)).toBe(-AUTO_SCROLL_MAX_STEP_PX);
    expect(edgeScrollDelta(5000, TOP, BOTTOM)).toBe(AUTO_SCROLL_MAX_STEP_PX);
  });

  it("退化输入不滚动", () => {
    expect(edgeScrollDelta(400, TOP, BOTTOM, 0)).toBe(0);
    expect(edgeScrollDelta(400, TOP, BOTTOM, 64, 0)).toBe(0);
    expect(edgeScrollDelta(400, 300, 300)).toBe(0);
  });
});

describe("resolveScrollParent", () => {
  it("向上找到第一个 overflow-y:auto 且内容超高的祖先", () => {
    const outer = document.createElement("div");
    outer.style.overflowY = "auto";
    Object.defineProperty(outer, "scrollHeight", { configurable: true, value: 1200 });
    Object.defineProperty(outer, "clientHeight", { configurable: true, value: 800 });
    const middle = document.createElement("div");
    const inner = document.createElement("div");
    middle.appendChild(inner);
    outer.appendChild(middle);
    document.body.appendChild(outer);

    expect(resolveScrollParent(inner)).toBe(outer);
  });

  it("内容没有超高时不算滚动容器（不误判成 overflow:auto 的静态盒子）", () => {
    const outer = document.createElement("div");
    outer.style.overflowY = "auto";
    Object.defineProperty(outer, "scrollHeight", { configurable: true, value: 800 });
    Object.defineProperty(outer, "clientHeight", { configurable: true, value: 800 });
    const inner = document.createElement("div");
    outer.appendChild(inner);
    document.body.appendChild(outer);

    expect(resolveScrollParent(inner)).not.toBe(outer);
  });

  it("找不到滚动祖先时退回文档滚动元素（兜底不为 null）", () => {
    const inner = document.createElement("div");
    document.body.appendChild(inner);
    const resolved = resolveScrollParent(inner);
    expect(resolved).toBeTruthy();
    expect(resolved).toBe(
      document.scrollingElement instanceof HTMLElement
        ? document.scrollingElement
        : document.documentElement,
    );
  });
});

describe("disableScrollAnchoring（拖拽期关 overflow-anchor）", () => {
  it("置为 none；恢复时回到原内联值，且幂等", () => {
    const container = document.createElement("div");
    container.style.setProperty("overflow-anchor", "auto");
    const restore = disableScrollAnchoring(container);
    expect(container.style.getPropertyValue("overflow-anchor")).toBe("none");
    restore();
    restore();
    expect(container.style.getPropertyValue("overflow-anchor")).toBe("auto");
  });

  it("原本没有内联值时恢复为清空（removeProperty）", () => {
    const container = document.createElement("div");
    const restore = disableScrollAnchoring(container);
    expect(container.style.getPropertyValue("overflow-anchor")).toBe("none");
    restore();
    expect(container.style.getPropertyValue("overflow-anchor")).toBe("");
    expect(container.getAttribute("style") ?? "").not.toContain("overflow-anchor");
  });

  it("引用计数：旧拖拽的恢复不能把新拖拽的锚定重新打开", () => {
    const container = document.createElement("div");
    // 拖拽 A 开始
    const restoreA = disableScrollAnchoring(container);
    expect(container.style.getPropertyValue("overflow-anchor")).toBe("none");
    // A 松手后补偿还在收敛，用户又开拖拽 B（B 再次 disable）
    const restoreB = disableScrollAnchoring(container);
    expect(container.style.getPropertyValue("overflow-anchor")).toBe("none");
    // A 的恢复晚到：只还掉自己那份计数，样式保持 none（B 仍持有）
    restoreA();
    restoreA();
    expect(container.style.getPropertyValue("overflow-anchor")).toBe("none");
    // B 释放后才真正恢复成空
    restoreB();
    expect(container.style.getPropertyValue("overflow-anchor")).toBe("");
  });
});

describe("readTranslateY / layoutTopWithoutTransform", () => {
  it("解析 translateY；无 transform 或非法值一律 0", () => {
    expect(readTranslateY("translateY(-12.5px)")).toBe(-12.5);
    expect(readTranslateY("translateY(0px)")).toBe(0);
    expect(readTranslateY("translateY( 8px )")).toBe(8);
    expect(readTranslateY("")).toBe(0);
    expect(readTranslateY("translateX(3px)")).toBe(0);
  });

  it("布局上缘 = rect.top − translateY（补偿锚点不能用视觉位置）", () => {
    const element = document.createElement("div");
    element.style.transform = "translateY(-12px)";
    element.getBoundingClientRect = () => rect(300);
    expect(layoutTopWithoutTransform(element)).toBe(312);
    element.style.transform = "";
    expect(layoutTopWithoutTransform(element)).toBe(300);
  });
});

describe("compensateReleaseShift（松手后 content-visibility 回落的补偿）", () => {
  function makeContainer(initialScrollTop: number) {
    const container = document.createElement("div");
    let scrollTopValue = initialScrollTop;
    Object.defineProperty(container, "scrollTop", {
      configurable: true,
      get: () => scrollTopValue,
      set: (value: number) => {
        scrollTopValue = Math.max(0, value);
      },
    });
    return container;
  }

  it("按布局上缘变化反向补偿 scrollTop（在 React 提交后的那一帧执行）", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    const container = makeContainer(2003);
    const element = document.createElement("div");
    let top = 958;
    element.getBoundingClientRect = () => rect(top);

    compensateReleaseShift(element, container, 958);
    // 提交前不动：此时量到的还是拖拽期的布局位置。
    expect(container.scrollTop).toBe(2003);

    // 提交后离屏分区退回占位高度 → 内容整体上移 466px。
    top = 492;
    frames.shift()?.(0);
    expect(container.scrollTop).toBe(2003 - 466);
  });

  it("补偿写完之后才回调恢复 overflow-anchor（避免双重补偿）", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    const container = makeContainer(1000);
    const element = document.createElement("div");
    let top = 900;
    element.getBoundingClientRect = () => rect(top);
    const events: string[] = [];
    const snapContainer = container;
    Object.defineProperty(snapContainer, "scrollTop", {
      configurable: true,
      get: () => 1000,
      set: () => {
        events.push("scroll-adjusted");
      },
    });
    compensateReleaseShift(element, container, 900, () => {
      events.push("anchor-restored");
    });
    top = 500;
    frames.shift()?.(0);
    // 收敛阶段只做补偿，不恢复锚定（恢复太早 Chrome 会把布局变动重新纳入锚定）。
    expect(events).not.toContain("anchor-restored");
    // 继续排空收敛帧，最后才是恢复帧。
    let guard = 0;
    while (frames.length > 0 && guard < 10) {
      frames.shift()?.(0);
      guard += 1;
    }
    expect(events[events.length - 1]).toBe("anchor-restored");
    expect(events.filter((e) => e === "anchor-restored")).toHaveLength(1);
  });

  it("跨帧回落（B9b 回归）：晚一帧才回落的 38.3px 也要补上，稳定两帧后才恢复", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    const container = makeContainer(2506);
    const element = document.createElement("div");
    let top = 416.8;
    element.getBoundingClientRect = () => rect(top);
    const events: string[] = [];
    const snapped = container;
    let scrollTopValue = 2506;
    Object.defineProperty(snapped, "scrollTop", {
      configurable: true,
      get: () => scrollTopValue,
      set: (value: number) => {
        // 只记录 scrollTop；卡片位置在测试里逐帧显式模拟（见下面的 top 赋值）。
        scrollTopValue = value;
      },
    });
    compensateReleaseShift(element, snapped, 416.8, () => events.push("restored"));

    // 第 1 帧：basic_info 还没回落，残差 0（稳定 1 帧）
    frames.shift()?.(0);
    expect(events).not.toContain("restored");
    // 第 2 帧：basic_info 420 → 458.3，卡片被推下 38.3px → 必须补
    top = 455.1;
    frames.shift()?.(0);
    expect(scrollTopValue).toBe(2506 + 38.3);
    expect(events).not.toContain("restored"); // 只稳定了 0 帧
    // 第 3、4 帧都稳定（残差 0 + 补偿后位置对齐），两帧后恢复
    top = 416.8;
    frames.shift()?.(0);
    frames.shift()?.(0);
    expect(events).not.toContain("restored");
    frames.shift()?.(0); // 恢复帧
    expect(events.filter((e) => e === "restored")).toHaveLength(1);
  });

  it("连续不稳定时最多等 RELEASE_SETTLE_MAX_FRAMES 帧也要恢复锚定（绝不常驻 none）", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    const container = makeContainer(1000);
    const element = document.createElement("div");
    let top = 0;
    element.getBoundingClientRect = () => rect(top);
    const events: string[] = [];
    compensateReleaseShift(element, container, 0, () => events.push("restored"));
    let guard = 0;
    while (events.length === 0 && guard < 40) {
      top += 5; // 每帧都在变，永远不稳定
      frames.shift()?.(0);
      guard += 1;
    }
    expect(events).toEqual(["restored"]);
    expect(guard).toBeLessThanOrEqual(RELEASE_SETTLE_MAX_FRAMES + 2);
  });

  it("变化 ≤1px 不补偿（浏览器滚动锚定已处理过时不重复补偿）", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    const container = makeContainer(500);
    const element = document.createElement("div");
    let top = 300;
    element.getBoundingClientRect = () => rect(top);
    compensateReleaseShift(element, container, 300);
    top = 300.5;
    frames.shift()?.(0);
    expect(container.scrollTop).toBe(500);
  });
});

describe("createEdgeAutoScroller", () => {
  /** 造一个可控滚动容器：getBoundingClientRect 固定、scrollTop 可写。 */
  function makeContainer(initialScrollTop: number) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    let scrollTopValue = initialScrollTop;
    Object.defineProperty(container, "scrollTop", {
      configurable: true,
      get: () => scrollTopValue,
      set: (value: number) => {
        // 与真实 DOM 一致：scrollTop 不允许为负（夹到 0），applied 可能因此为 0。
        scrollTopValue = Math.max(0, value);
      },
    });
    container.getBoundingClientRect = () =>
      ({
        top: 0,
        bottom: 800,
        height: 800,
        left: 0,
        right: 600,
        width: 600,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    return container;
  }

  it("按帧滚动并把滚动量回调出去；离开边缘带后不再排帧", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {
      frames.length = 0;
    });

    const container = makeContainer(100);
    const onTick = vi.fn();
    const scroller = createEdgeAutoScroller({ container, onTick });

    // 指针贴上边缘：起一帧 → 执行 → 真的滚了 → 回调滚动量 → 又排下一帧。
    scroller.update(0);
    expect(frames).toHaveLength(1);
    const first = frames.shift();
    first?.(0);
    expect(container.scrollTop).toBe(100 - AUTO_SCROLL_MAX_STEP_PX);
    expect(onTick).toHaveBeenCalledWith(-AUTO_SCROLL_MAX_STEP_PX);
    expect(frames).toHaveLength(1);

    // 指针回到中间：这一帧不滚、不回调、也不再排帧（不空转）。
    scroller.update(400);
    const second = frames.shift();
    second?.(0);
    expect(container.scrollTop).toBe(100 - AUTO_SCROLL_MAX_STEP_PX);
    expect(onTick).toHaveBeenCalledTimes(1);
    expect(frames).toHaveLength(0);

    // stop 幂等，之后再 update 也不再起帧。
    scroller.stop();
    scroller.stop();
    scroller.update(0);
    expect(frames).toHaveLength(0);
  });

  it("canScroll 返回 false 时不滚动、不回调、也不再排帧（clamp 后停滚）", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {
      frames.length = 0;
    });
    const container = makeContainer(100);
    const onTick = vi.fn();
    const canScroll = vi.fn(() => false);
    const scroller = createEdgeAutoScroller({ container, onTick, canScroll });
    scroller.update(0);
    frames.shift()?.(0);
    expect(canScroll).toHaveBeenCalledWith(-AUTO_SCROLL_MAX_STEP_PX);
    expect(container.scrollTop).toBe(100);
    expect(onTick).not.toHaveBeenCalled();
    // 不继续排帧：空转的 rAF 会一直烧 CPU，也要留给下一次 update 重新起帧。
    expect(frames).toHaveLength(0);
    // 空间恢复后再 update 仍能重新起帧。
    canScroll.mockReturnValue(true);
    scroller.update(0);
    expect(frames).toHaveLength(1);
    scroller.stop();
  });

  it("滚到边界（applied=0）时不回调，避免几何被重复平移", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {
      frames.length = 0;
    });
    const container = makeContainer(0);
    const onTick = vi.fn();
    const scroller = createEdgeAutoScroller({ container, onTick });
    scroller.update(0);
    frames.shift()?.(0);
    // scrollTop 已经是 0，再往上滚不产生位移。
    expect(onTick).not.toHaveBeenCalled();
    scroller.stop();
  });
});
