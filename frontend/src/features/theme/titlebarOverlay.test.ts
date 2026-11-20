// SPDX-License-Identifier: Apache-2.0
/**
 * 标题栏覆盖层配色（2026-11-20 第 3 / 4 条）的纯逻辑用例。
 *
 * 覆盖四块：
 *  1. **缓动复刻**：`easeProgress` 必须与 `styles/theme-transition.css` 的
 *     `cubic-bezier(0.22, 0.61, 0.36, 1)` 同一条曲线（端点、单调、可逆）；
 *  2. **换色窗口**：圆边缘扫过按钮区的 enter / leave 时刻；
 *  3. **颜色**：CSS 计算值读取、sRGB 直插、非法值不落库；
 *  4. **驱动**：窗内只发有变化的帧、结束落到终值、过渡期间丢弃普通上报、
 *     连续切换只有最新一代能写。
 *
 * 关于时间：任务书给的是 `enter≈93 / leave≈129`（560ms），那是按线性/`ease` 估算的。
 * 按 CSS 真正用的 `cubic-bezier(0.22, 0.61, 0.36, 1)`，这条曲线前 20% 时间就走完 ~44%
 * 半径，**93ms 时半径已有 631px、早就越过按钮区最远点（531px）**——所以 enter 只能是
 * 55ms 左右，129ms 更是落在"已经全变色"之后。这里按 CSS 的真实曲线断言，见
 * `overlayFlipWindow` 的用例注释。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TITLEBAR_BG_VAR,
  TITLEBAR_SYMBOL_VAR,
  beginTitlebarOverlayFlip,
  easeProgress,
  farthestDistanceToPlate,
  lerpHexColor,
  mixOverlayColors,
  nearestDistanceToPlate,
  overlayCoverage,
  overlayFlipWindow,
  publishTitlebarOverlay,
  readTitlebarOverlayColors,
  resetTitlebarOverlayState,
  setTitlebarOverlaySink,
  timeFractionAtProgress,
  titlebarOverlayPlate,
  type OverlayFlipRuntime,
  type TitlebarOverlayPayload,
} from "./titlebarOverlay";

const originalGetComputedStyle = window.getComputedStyle;
const originalInnerWidth = window.innerWidth;

/** 固定"当前配色"：读 CSS 变量时返回这两串。 */
function stubColors(color: string, symbolColor: string) {
  const values: Record<string, string> = {
    [TITLEBAR_BG_VAR]: ` ${color} `,
    [TITLEBAR_SYMBOL_VAR]: symbolColor,
  };
  vi.stubGlobal(
    "getComputedStyle",
    vi.fn(() => ({
      getPropertyValue: (name: string) => values[name] ?? "",
    })),
  );
}

/** 假帧循环：`advance(ms)` 手动推进时间并跑一帧。 */
function fakeRuntime(): OverlayFlipRuntime & { advance(ms: number): void; frames: number } {
  let clock = 0;
  let pending: (() => void) | null = null;
  const timers: { at: number; callback: () => void }[] = [];
  const runtime = {
    frames: 0,
    now: () => clock,
    requestFrame: (callback: () => void) => {
      pending = callback;
      return 1;
    },
    cancelFrame: () => {
      pending = null;
    },
    setTimer: (callback: () => void, ms: number) => {
      timers.push({ at: clock + ms, callback });
      return timers.length;
    },
    clearTimer: () => {
      timers.length = 0;
    },
    advance(ms: number) {
      clock += ms;
      for (const timer of [...timers]) {
        if (clock >= timer.at) timer.callback();
      }
      const next = pending;
      pending = null;
      if (next) {
        runtime.frames += 1;
        next();
      }
    },
  };
  return runtime;
}

beforeEach(() => {
  resetTitlebarOverlayState();
});

afterEach(() => {
  resetTitlebarOverlayState();
  vi.stubGlobal("getComputedStyle", originalGetComputedStyle);
  Object.defineProperty(window, "innerWidth", { configurable: true, value: originalInnerWidth });
  vi.unstubAllGlobals();
});

// ---- 1. 缓动 ----------------------------------------------------------------

describe("easeProgress（复刻 CSS 的 cubic-bezier(0.22, 0.61, 0.36, 1)）", () => {
  it("端点是 0 / 1，区间内单调递增", () => {
    expect(easeProgress(0)).toBe(0);
    expect(easeProgress(1)).toBe(1);
    let previous = -1;
    for (let step = 0; step <= 100; step += 1) {
      const value = easeProgress(step / 100);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it("越界输入被夹住（负值 / 大于 1）", () => {
    expect(easeProgress(-3)).toBe(0);
    expect(easeProgress(4)).toBe(1);
  });

  it("前期极快：20% 时间已走完约 50% 半径（这条曲线就是'闪'的根源）", () => {
    // 手算：x=0.2 时 y≈0.501。与 CSS 里那条曲线一致，说明我们复刻的是同一份。
    // 这一点也是"任务书的 93ms 站不住"的证据：93/560=0.166 时半径已经 0.43×1467≈631px，
    // 远超按钮区最远点 531px。
    expect(easeProgress(0.2)).toBeGreaterThan(0.48);
    expect(easeProgress(0.2)).toBeLessThan(0.52);
  });

  it("timeFractionAtProgress 是它的反函数", () => {
    for (const time of [0.05, 0.1, 0.25, 0.5, 0.75, 0.95]) {
      expect(timeFractionAtProgress(easeProgress(time))).toBeCloseTo(time, 2);
    }
  });
});

// ---- 2. 换色窗口 ------------------------------------------------------------

describe("overlayFlipWindow（圆边缘扫过按钮区的时刻）", () => {
  // 任务书实测那组输入：视口 1650×997、圆心 (1122,52)、按钮区 = 右侧 138×32。
  const input = {
    origin: { x: 1122, y: 52 },
    plate: { x: 1512, y: 0, width: 138, height: 32 },
    radius: 1467,
  };

  it("near / far 就是圆心到按钮区最近点 / 最远角的距离", () => {
    const window = overlayFlipWindow({ ...input, durationMs: 560 });
    expect(window.near).toBeCloseTo(391, 0);
    expect(window.far).toBeCloseTo(531, 0);
  });

  it("亮→暗（560ms）：enter≈55ms、leave≈77ms —— 圆在这 22ms 内扫过按钮区", () => {
    const flip = overlayFlipWindow({ ...input, durationMs: 560 });
    // ⚠️ 任务书写的是 93 / 129。按 CSS 真正用的曲线，93ms 时半径 = ease(0.166)×1467 ≈ 631，
    // 已经越过按钮区最远点（531），也就是"早就全变色了"——与"leave=129"自相矛盾。
    // 以 CSS 的真实曲线为准（否则对齐就没意义），这里钉住算出来的值。
    expect(flip.enterMs).toBeCloseTo(55.2, 0);
    expect(flip.leaveMs).toBeCloseTo(76.7, 0);
    expect(flip.leaveMs - flip.enterMs).toBeGreaterThan(16); // 至少覆盖 1 帧
    expect(flip.leaveMs).toBeLessThan(560 / 4); // 远早于过渡结束
  });

  it("暗→亮（460ms）：窗口按同一比例缩短", () => {
    const flip = overlayFlipWindow({ ...input, durationMs: 460 });
    expect(flip.enterMs).toBeCloseTo(45.3, 0);
    expect(flip.leaveMs).toBeCloseTo(63, 0);
  });

  it("radius 为 0 或 durationMs 为 0 时窗口退化为 0（不产生 NaN）", () => {
    expect(overlayFlipWindow({ ...input, radius: 0, durationMs: 560 })).toMatchObject({
      enterMs: 0,
      leaveMs: 0,
    });
    const zeroDuration = overlayFlipWindow({ ...input, durationMs: 0 });
    expect(Number.isFinite(zeroDuration.enterMs)).toBe(true);
    expect(zeroDuration.leaveMs).toBe(0);
  });

  it("圆心在按钮区内（极端布局）时 near = 0、enter = 0", () => {
    const flip = overlayFlipWindow({
      origin: { x: 1560, y: 16 },
      plate: { x: 1512, y: 0, width: 138, height: 32 },
      radius: 100,
      durationMs: 560,
    });
    expect(flip.near).toBe(0);
    expect(flip.enterMs).toBe(0);
    expect(flip.far).toBeGreaterThan(0);
  });
});

describe("距离与覆盖比例", () => {
  const plate = { x: 100, y: 10, width: 50, height: 20 };

  it("最近距离：圆心在矩形内为 0，否则取夹紧后的欧氏距离", () => {
    expect(nearestDistanceToPlate({ x: 120, y: 20 }, plate)).toBe(0);
    expect(nearestDistanceToPlate({ x: 0, y: 20 }, plate)).toBe(100);
    expect(nearestDistanceToPlate({ x: 120, y: 0 }, plate)).toBe(10);
  });

  it("最远距离取四个角里最远的那个", () => {
    expect(farthestDistanceToPlate({ x: 0, y: 0 }, plate)).toBeCloseTo(Math.hypot(150, 30));
  });

  it("coverage：near 之前 0、far 之后 1、中间线性", () => {
    expect(overlayCoverage({ radius: 10, near: 20, far: 60 })).toBe(0);
    expect(overlayCoverage({ radius: 70, near: 20, far: 60 })).toBe(1);
    expect(overlayCoverage({ radius: 40, near: 20, far: 60 })).toBeCloseTo(0.5);
    // near === far（退化）时不除零。
    expect(overlayCoverage({ radius: 30, near: 20, far: 20 })).toBe(1);
  });
});

// ---- 3. 颜色 ----------------------------------------------------------------

describe("颜色读取与插值", () => {
  it("读 CSS 计算值：去掉空白、统一小写", () => {
    stubColors("#FFE9C7", "#3D4A5C");
    expect(readTitlebarOverlayColors()).toEqual({ color: "#ffe9c7", symbolColor: "#3d4a5c" });
  });

  it("只接受不透明 #rrggbb：rgba / 8 位 hex / 空值都不上报", () => {
    stubColors("rgba(255, 255, 255, 0.5)", "#f5f7fa80");
    expect(readTitlebarOverlayColors()).toEqual({});
  });

  it("sRGB 直插：两端精确、中点是通道均值", () => {
    expect(lerpHexColor("#000000", "#ffffff", 0)).toBe("#000000");
    expect(lerpHexColor("#000000", "#ffffff", 1)).toBe("#ffffff");
    expect(lerpHexColor("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(lerpHexColor("#f5f7fa", "#151b23", 0.5)).toBe("#85898f");
    // 奇数差向上取整（250 → 35 的中点是 142.5）。
  });

  it("非法色返回 null，mixOverlayColors 直接退化为终值（宁可突变也不发非法色）", () => {
    expect(lerpHexColor(undefined, "#ffffff", 0.5)).toBeNull();
    expect(lerpHexColor("#ffffff", "not-a-color", 0.5)).toBeNull();
    expect(
      mixOverlayColors({ color: "#000000" }, { color: "#ffffff", symbolColor: "#ffffff" }, 0.5),
    ).toEqual({ color: "#808080", symbolColor: "#ffffff" });
  });
});

// ---- 4. 按钮区几何 ----------------------------------------------------------

describe("titlebarOverlayPlate", () => {
  function fakeWindow(area: DOMRect | null, width = 1650) {
    return {
      innerWidth: width,
      navigator: { windowControlsOverlay: { getTitlebarAreaRect: () => area } },
    } as unknown as Window;
  }

  it("按钮区 = titlebar-area 右侧剩下的那一条", () => {
    const win = fakeWindow({ x: 0, y: 0, width: 1512, height: 32 } as DOMRect);
    expect(titlebarOverlayPlate(win)).toEqual({ x: 1512, y: 0, width: 138, height: 32 });
  });

  it("API 缺失 / 面积为零 / 抛错时返回 null（调用方退化为一次切换）", () => {
    expect(
      titlebarOverlayPlate({ innerWidth: 100, navigator: {} } as unknown as Window),
    ).toBeNull();
    expect(titlebarOverlayPlate(fakeWindow(null))).toBeNull();
    expect(
      titlebarOverlayPlate(fakeWindow({ x: 0, y: 0, width: 1650, height: 32 } as DOMRect)),
    ).toBeNull();
    const throwing = {
      innerWidth: 1650,
      navigator: {
        windowControlsOverlay: {
          getTitlebarAreaRect: () => {
            throw new Error("boom");
          },
        },
      },
    } as unknown as Window;
    expect(titlebarOverlayPlate(throwing)).toBeNull();
  });
});

// ---- 5. 上报与驱动 ----------------------------------------------------------

describe("publishTitlebarOverlay / beginTitlebarOverlayFlip", () => {
  function collect() {
    const sent: TitlebarOverlayPayload[] = [];
    setTitlebarOverlaySink((payload) => sent.push(payload));
    return sent;
  }

  /**
   * 让 `titlebarOverlayPlate()` 拿到一块按钮区（`null` = 模拟没有 WCO 的旧壳/浏览器）。
   * jsdom 的 `innerWidth` 默认 1024，而按钮区在 1512 之后——不一起改就会被判成
   * "面积为零"而退化成一次切换，用例会假装通过（这里是踩过的坑）。
   */
  function stubPlate(area: { x: number; y: number; width: number; height: number } | null) {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1650 });
    vi.stubGlobal("navigator", {
      ...window.navigator,
      windowControlsOverlay: area ? { getTitlebarAreaRect: () => area } : undefined,
    });
  }

  /** 任务书实测那组几何：1650 宽、可拖拽区 1512 → 按钮区 138×32。 */
  const PLATE = { x: 0, y: 0, width: 1512, height: 32 };
  const ORIGIN = { x: 1122, y: 52 };

  it("没有注册出口（浏览器版）时什么都不做，且 begin 返回 inactive", () => {
    expect(publishTitlebarOverlay({ theme: "dark", color: "#151b23" })).toBe(false);
    const handle = beginTitlebarOverlayFlip({
      next: "dark",
      origin: { x: 0, y: 0 },
      durationMs: 460,
      radius: 100,
    });
    expect(handle.active).toBe(false);
    expect(() => handle.start()).not.toThrow();
  });

  it("普通上报：主题与颜色一起推给主进程", () => {
    const sent = collect();
    stubColors("#f5f7fa", "#3d4a5c");
    expect(publishTitlebarOverlay({ theme: "light", ...readTitlebarOverlayColors() })).toBe(true);
    expect(sent).toEqual([{ theme: "light", color: "#f5f7fa", symbolColor: "#3d4a5c" }]);
  });

  it("窗内只发有变化的帧，结束精确落到终值（不是中间色）", () => {
    const sent = collect();
    stubPlate(PLATE);
    stubColors("#f5f7fa", "#3d4a5c");
    // 先给出旧色（begin 会在 apply 之前读一次）。
    const runtime = fakeRuntime();
    const handle = beginTitlebarOverlayFlip({
      next: "dark",
      origin: ORIGIN,
      durationMs: 560,
      radius: 1467,
      runtime,
    });
    // apply() 落地：CSS 变量变成新主题的值。
    stubColors("#151b23", "#c9d4e0");
    handle.start();
    for (let index = 0; index < 6; index += 1) runtime.advance(16);
    // 窗口 55—77ms：至少要有 1 帧中间色 + 1 帧终值（只有终值说明退化成了"一次切换"）。
    expect(sent.length).toBeGreaterThanOrEqual(2);
    expect(sent.length).toBeLessThanOrEqual(4);
    // 最后一条必须是终值本身。
    expect(sent[sent.length - 1]).toEqual({
      theme: "dark",
      color: "#151b23",
      symbolColor: "#c9d4e0",
    });
    // 中间帧必须是真正的中间色（sRGB 直插的结果，不是端点）。
    const middle = sent.slice(0, -1).map((frame) => frame.color);
    for (const color of middle) {
      expect(color).not.toBe("#f5f7fa");
      expect(color).not.toBe("#151b23");
    }
  });

  it("过渡进行中丢弃普通上报（第 4 条修的就是这个'第 0 帧突变'）", () => {
    const sent = collect();
    stubPlate(PLATE);
    stubColors("#f5f7fa", "#3d4a5c");
    const runtime = fakeRuntime();
    const handle = beginTitlebarOverlayFlip({
      next: "dark",
      origin: ORIGIN,
      durationMs: 560,
      radius: 1467,
      runtime,
    });
    stubColors("#151b23", "#c9d4e0");
    // 模拟 DesktopTitleBar 的 useEffect：主题一变就上报。
    expect(
      publishTitlebarOverlay({ theme: "dark", color: "#151b23", symbolColor: "#c9d4e0" }),
    ).toBe(false);
    expect(sent).toHaveLength(0);
    handle.start();
    for (let index = 0; index < 6; index += 1) runtime.advance(16);
    // 过渡结束后普通上报恢复可用。
    expect(publishTitlebarOverlay({ theme: "dark", color: "#151b23" })).toBe(true);
  });

  it("快速连切：只有最新一代能写入，旧一代一帧都发不出去", () => {
    const sent = collect();
    stubPlate(PLATE);
    stubColors("#f5f7fa", "#3d4a5c");
    const runtime = fakeRuntime();
    const first = beginTitlebarOverlayFlip({
      next: "dark",
      origin: ORIGIN,
      durationMs: 560,
      radius: 1467,
      runtime,
    });
    const second = beginTitlebarOverlayFlip({
      next: "light",
      origin: { x: 1200, y: 52 },
      durationMs: 460,
      radius: 1467,
      runtime,
    });
    stubColors("#151b23", "#c9d4e0");
    first.start(); // 已经被顶掉：start 之后也写不进去
    for (let index = 0; index < 4; index += 1) runtime.advance(16);
    expect(sent).toHaveLength(0);

    stubColors("#f5f7fa", "#3d4a5c");
    second.start();
    for (let index = 0; index < 6; index += 1) runtime.advance(16);
    // 只出现第二代（light）的终值。
    expect(sent.every((frame) => frame.theme === "light")).toBe(true);
    expect(sent[sent.length - 1]).toMatchObject({ theme: "light", color: "#f5f7fa" });
  });

  it("cancel 落到**当前** CSS 值并停掉帧循环（过渡被打断时不留中间色）", () => {
    const sent = collect();
    stubPlate(PLATE);
    stubColors("#f5f7fa", "#3d4a5c");
    const runtime = fakeRuntime();
    const handle = beginTitlebarOverlayFlip({
      next: "dark",
      origin: ORIGIN,
      durationMs: 560,
      radius: 1467,
      runtime,
    });
    stubColors("#151b23", "#c9d4e0");
    handle.start();
    runtime.advance(64); // 落在窗内，可能已发过一帧中间色
    const before = sent.length;
    handle.cancel();
    expect(sent[before]).toEqual({ theme: "dark", color: "#151b23", symbolColor: "#c9d4e0" });
    const afterCancel = sent.length;
    runtime.advance(64);
    expect(sent.length).toBe(afterCancel); // 取消之后不再有帧
    handle.cancel(); // 幂等
    expect(sent.length).toBe(afterCancel);
  });

  it("拿不到按钮区（浏览器版 / 旧壳）时延迟 0、一次切换", () => {
    const sent = collect();
    stubPlate(null);
    stubColors("#f5f7fa", "#3d4a5c");
    const runtime = fakeRuntime();
    const handle = beginTitlebarOverlayFlip({
      next: "dark",
      origin: { x: 10, y: 10 },
      durationMs: 560,
      radius: 1467,
      runtime,
    });
    stubColors("#151b23", "#c9d4e0");
    handle.start();
    expect(sent).toEqual([{ theme: "dark", color: "#151b23", symbolColor: "#c9d4e0" }]);
    expect(runtime.frames).toBe(0);
  });
});
