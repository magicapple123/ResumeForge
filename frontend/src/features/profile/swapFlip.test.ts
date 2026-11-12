// SPDX-License-Identifier: Apache-2.0
/** 换位 FLIP 动画：First 采集、Invert-Play 参数、被拖卡排除、连续换位重定向。 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { captureFlipTops, FLIP_SWAP_MS, playSwapFlip } from "./swapFlip";

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

/** 给元素注入 WAAPI 桩：记录 animate 调用与可控的 running 动画。 */
function stubAnimate(element: HTMLElement) {
  const calls: Array<{ keyframes: Keyframe[]; options: KeyframeAnimationOptions }> = [];
  const animations: Array<{ cancel: ReturnType<typeof vi.fn> }> = [];
  (element as HTMLElement).animate = ((
    keyframes: Keyframe[],
    options: KeyframeAnimationOptions,
  ) => {
    calls.push({ keyframes, options });
    const animation = { cancel: vi.fn() };
    animations.push(animation);
    return animation as unknown as Animation;
  }) as HTMLElement["animate"];
  (element as HTMLElement).getAnimations = (() =>
    animations as unknown as Animation[]) as HTMLElement["getAnimations"];
  return { calls, animations };
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("captureFlipTops（First）", () => {
  it("采集 root 内命中选择器的各元素视觉上缘；root 为 null 返回空表", () => {
    const a = document.createElement("div");
    a.className = "row";
    const b = document.createElement("div");
    b.className = "row";
    document.body.append(a, b);
    const spy = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
      this: Element,
    ) {
      return rect(this === a ? 100 : 240);
    });
    const tops = captureFlipTops(document.body, ".row");
    expect(tops.get(a)).toBe(100);
    expect(tops.get(b)).toBe(240);
    expect(tops.size).toBe(2);
    expect(captureFlipTops(null, ".row").size).toBe(0);
    spy.mockRestore();
  });
});

describe("playSwapFlip（Last-Invert-Play）", () => {
  it("位置变化的卡片从旧位置（旧−新）滑到 0，时长 150ms", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const { calls } = stubAnimate(el);
    const spy = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockImplementation(() => rect(100));
    const prevTops = new Map([[el, 240]]); // First：旧位置 240
    playSwapFlip(prevTops, null);
    // Last=100 → delta = 240 − 100 = +140（从下方 140px 处滑回 0）。
    expect(calls).toHaveLength(1);
    expect(calls[0].keyframes[0].transform).toBe("translateY(140px)");
    expect(calls[0].keyframes[1].transform).toBe("translateY(0px)");
    expect(calls[0].options.duration).toBe(FLIP_SWAP_MS);
    expect(FLIP_SWAP_MS).toBe(150);
    // 匀速：验收判据「邻卡相邻帧位移 ≤120px」按匀速折算，ease-out 的起步峰值会击穿。
    expect(calls[0].options.easing).toBe("linear");
    spy.mockRestore();
  });

  it("被拖卡（exclude）绝不参与动画（1:1 跟手红线）", () => {
    const dragged = document.createElement("div");
    const neighbor = document.createElement("div");
    document.body.append(dragged, neighbor);
    const draggedStub = stubAnimate(dragged);
    const neighborStub = stubAnimate(neighbor);
    const spy = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockImplementation((...args) => {
        // 区分两个元素：spy 拿不到 this，这里给两个元素各自 stub getBoundingClientRect。
        void args;
        return rect(0);
      });
    dragged.getBoundingClientRect = () => rect(0);
    neighbor.getBoundingClientRect = () => rect(200);
    const prevTops = new Map([
      [dragged, 300],
      [neighbor, 200],
    ]);
    playSwapFlip(prevTops, dragged);
    expect(draggedStub.calls).toHaveLength(0);
    expect(neighborStub.calls).toHaveLength(0); // 邻卡没挪位（旧=新=200）
    // 邻卡真的挪位时才播。
    const prevTops2 = new Map([[neighbor, 320]]);
    playSwapFlip(prevTops2, dragged);
    expect(neighborStub.calls).toHaveLength(1);
    expect(neighborStub.calls[0].keyframes[0].transform).toBe("translateY(120px)");
    spy.mockRestore();
  });

  it("位移 <1px 不播（零补偿 no-op）；没有 animate 能力（jsdom）安全跳过", () => {
    const still = document.createElement("div");
    const legacy = document.createElement("div");
    document.body.append(still, legacy);
    const stillStub = stubAnimate(still);
    still.getBoundingClientRect = () => rect(100);
    playSwapFlip(new Map([[still, 100.5]]), null);
    expect(stillStub.calls).toHaveLength(0);
    // legacy：没有 animate/getAnimations（jsdom 默认）——不抛异常。
    legacy.getBoundingClientRect = () => rect(0);
    expect(() => playSwapFlip(new Map([[legacy, 500]]), null)).not.toThrow();
  });

  it("连续换位：必须先 cancel 再量——从「当前视觉位置」起播而不是上一轮布局位", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    // 有状态的动画桩，复现真实 WAAPI 时序：animate 创建运行中动画（视觉 = 布局 +
    // 播放偏移 o）；cancel 让视觉瞬间回到布局位；getAnimations 返回运行中的动画。
    const layoutTop = 200;
    let runningOffset = 0; // 运行中动画的当前偏移；cancel 时归零
    let current: { cancel: ReturnType<typeof vi.fn> } | null = null;
    const created: Array<{ cancel: ReturnType<typeof vi.fn> }> = [];
    const calls: Array<{ keyframes: Keyframe[]; options: KeyframeAnimationOptions }> = [];
    (el as HTMLElement).animate = ((keyframes: Keyframe[], options: KeyframeAnimationOptions) => {
      calls.push({ keyframes, options });
      const animation = {
        cancel: vi.fn(() => {
          runningOffset = 0;
          current = null;
        }),
      };
      created.push(animation);
      current = animation;
      return animation as unknown as Animation;
    }) as HTMLElement["animate"];
    (el as HTMLElement).getAnimations = (() =>
      current ? [current] : []) as unknown as HTMLElement["getAnimations"];
    el.getBoundingClientRect = () => rect(layoutTop + runningOffset);

    // 第 1 轮换位：First = 320（旧布局位）→ 提交后布局 200 → delta = +120，起播视觉 320。
    playSwapFlip(new Map([[el, 320]]), null);
    expect(calls).toHaveLength(1);
    expect(calls[0].keyframes[0].transform).toBe("translateY(120px)");
    // 动画播到偏移 −40（视觉位 160）；期间第 2 轮换位提交（布局位不变，仍是 200）。
    runningOffset = -40;
    // 第 2 轮换位：First = 160（当前视觉位）。有缺陷的实现（先量后 cancel）里
    // rect = 160+... 与 First 含同一偏移 → delta = 0 → <1px 早退（瞬移一槽再回滑）；
    // 正确实现先 cancel（视觉回布局位 200）再量 → delta = 160 − 200 = −40，
    // 起播视觉 = 200 + (−40) = 160 = 当前视觉位置（无缝重定向）。
    playSwapFlip(new Map([[el, 160]]), null);
    expect(created[0].cancel).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(2);
    expect(calls[1].keyframes[0].transform).toBe("translateY(-40px)");
    expect(calls[1].keyframes[1].transform).toBe("translateY(0px)");
  });

  it("连续换位（经典桩）：先 cancel 上一段动画再重播，无叠加", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const { calls, animations } = stubAnimate(el);
    el.getBoundingClientRect = () => rect(100); // 动画期间量到的视觉位置
    playSwapFlip(new Map([[el, 200]]), null);
    expect(animations).toHaveLength(1);
    // 第二次换位：上一段动画仍在播（getAnimations 返回它），必须先取消。
    playSwapFlip(new Map([[el, 150]]), null);
    expect(animations[0].cancel).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(2);
    expect(calls[1].keyframes[0].transform).toBe("translateY(50px)");
  });

  it("reduced-motion（系统减弱动态效果）下不加动画", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const { calls } = stubAnimate(el);
    el.getBoundingClientRect = () => rect(100);
    const mediaSpy = vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: true,
      media: "(prefers-reduced-motion: reduce)",
    } as MediaQueryList);
    playSwapFlip(new Map([[el, 200]]), null);
    expect(calls).toHaveLength(0);
    mediaSpy.mockRestore();
    // 偏好关闭后恢复动画。
    playSwapFlip(new Map([[el, 200]]), null);
    expect(calls).toHaveLength(1);
  });
});
