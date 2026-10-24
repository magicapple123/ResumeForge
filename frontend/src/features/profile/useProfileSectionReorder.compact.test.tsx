// SPDX-License-Identifier: Apache-2.0
/**
 * 拖动激活期「全部大卡片折叠成紧凑条」（P3）+ 跟手与松手落点。
 *
 * 契约（用户需求）：
 * 1. 一开始拖，**所有**大分区都折叠成 52px 紧凑条（不只是被拖的那张），之后的换位按
 *    折叠后的紧凑布局计算；松手/取消立刻恢复展开；
 * 2. 跟手的是**卡片本身**（`transform` 直写 + `is-dragging`），没有额外浮条
 *    （原 `profileDragGhost.ts` 已删除，其「浮条在动 + 占位卡尺寸不变」的用例随之迁移）；
 * 3. 松手后视角滚回**被拖卡片居中**，而不是停在 `scrollTop = 0` 的页顶。
 *
 * 几何前提沿用 `profileReorderHarness.testkit.tsx`，但本文件的用例给 rect 桩注入
 * `compactHeight: 52`——折叠是真实的高度变化（CSS 的 `.is-compact`），只有让桩跟着
 * `is-compact` 变高度，紧凑布局下的行程/前缀和才与生产一致。
 *
 * 历史说明：浮条时代守着「占位卡几何零改动（高度仍 60px）」。P3 之后折叠是**有意**的
 * 真实高度变化，那条断言被本文件的紧凑高度断言取代；仍适用的「跟手 = desiredTop −
 * 当前布局上缘」「未越阈值不激活」「中途卸载收干净」三条保留在下面。
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SortableProfileSection } from "../../components/profile/ProfileSectionShell";
import {
  captureAnimationFrames,
  COMPACT_CLASS,
  COMPACT_HEIGHT_PX,
  currentOrder,
  drainAnimationFrames,
  draggedTransform,
  dragTo,
  Harness,
  resetReorderTestState,
  stubSectionRects,
} from "./profileReorderHarness.testkit";
import { centerElementInContainer } from "./profileCompactDrag";

afterEach(resetReorderTestState);

function sectionElements(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-profile-section-key]"));
}

function section(key: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-profile-section-key="${key}"]`);
}

/** 浮条已删除：任何时刻页面里都不该再出现这类节点。 */
function ghostBar(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".profile-section-drag-ghost");
}

/** 构造一个只带几何字段的 DOMRect（jsdom 无布局，桩一律手写）。 */
function rectOf(top: number, height: number): DOMRect {
  return {
    top,
    bottom: top + height,
    height,
    left: 0,
    right: 300,
    width: 300,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

/** 按下并只移动 4px：越过 6px 阈值之前的状态。 */
function pressWithoutActivating(key: string, fromY: number) {
  fireEvent.pointerDown(screen.getByLabelText(`拖动调整${key}顺序`), {
    clientX: 10,
    clientY: fromY,
    pointerId: 1,
  });
  fireEvent.pointerMove(document, { clientX: 10, clientY: fromY + 4, pointerId: 1 });
}

describe("拖动激活期全部折叠成紧凑条（P3）", () => {
  it("激活后**所有**分区都是紧凑态（含未被拖的），松手全部恢复展开", () => {
    stubSectionRects({ compactHeight: COMPACT_HEIGHT_PX });
    render(<Harness />);

    // 折叠前：一张紧凑的都没有。
    expect(sectionElements().some((el) => el.classList.contains(COMPACT_CLASS))).toBe(false);

    dragTo("projects", 440, 490);

    const sections = sectionElements();
    expect(sections).toHaveLength(8);
    for (const element of sections) {
      expect(element.classList.contains(COMPACT_CLASS)).toBe(true);
    }
    // 被拖卡也一样折叠（不再是"只有它变小"）：它的高度就是紧凑条高度。
    expect(section("projects")?.getBoundingClientRect().height).toBe(COMPACT_HEIGHT_PX);

    fireEvent.pointerUp(document, { clientX: 10, clientY: 490, pointerId: 1 });

    for (const element of sectionElements()) {
      expect(element.classList.contains(COMPACT_CLASS)).toBe(false);
    }
    // 跟手位移一并清空（否则卡片会停在半路）。
    expect(section("projects")?.style.transform).toBe("");
    // 顺序保留拖动中的最终态。
    expect(currentOrder()[4]).toBe("projects");
  });

  it("跟手的是卡片本身：没有浮条、没有占位类，transform 随指针改变", () => {
    stubSectionRects({ compactHeight: COMPACT_HEIGHT_PX });
    render(<Harness />);

    dragTo("projects", 440, 490);
    const dragged = section("projects");

    // 浮条与"原位占位"都已删除：页面里不存在 .profile-section-drag-ghost，
    // 被拖卡也不该带 is-drag-ghosted（否则内容会被 visibility: hidden 藏掉）。
    expect(ghostBar()).toBeNull();
    expect(dragged).not.toHaveClass("is-drag-ghosted");
    // 被拖卡是可见的紧凑条，并带拖动置顶类（z-index + 合成层）。
    expect(dragged).toHaveClass(COMPACT_CLASS);
    expect(dragged).toHaveClass("is-dragging");
    // 跟手模型未变：desiredTop 406 − 新布局上缘 408 = −2。
    expect(draggedTransform("projects")).toBe("translateY(-2px)");

    // 指针继续下行 10px（不足一档行程 48px，不换位）：卡片跟着走。
    fireEvent.pointerMove(document, { clientX: 10, clientY: 500, pointerId: 1 });
    expect(currentOrder()[4]).toBe("projects");
    expect(draggedTransform("projects")).toBe("translateY(8px)");
    expect(ghostBar()).toBeNull();

    fireEvent.pointerUp(document, { clientX: 10, clientY: 500, pointerId: 1 });
  });

  it("紧凑布局下换位与 transform 都按 52px 计算", () => {
    stubSectionRects({ compactHeight: COMPACT_HEIGHT_PX });
    render(<Harness />);

    // projects 折叠后在第 4 槽（200 + 3×52 = 356），指针从 440 拖到 490。
    // 折叠 + 补偿后被拖卡上缘 356，指针按下点 440 已落在 52px 条外（440−356 = 84），
    // 于是抓取偏移重设为 84：desiredTop = 490−84 = 406，行程 50 ≥ 48 → 推进一格。
    dragTo("projects", 440, 490);

    expect(currentOrder()[4]).toBe("projects");
    // 新布局上缘 = 200 + 4×52 = 408 → transform = 406 − 408 = −2。
    expect(draggedTransform("projects")).toBe("translateY(-2px)");

    // 继续下拖 60px：行程再推一格，布局上缘 200 + 5×52 = 460 → transform = +6。
    fireEvent.pointerMove(document, { clientX: 10, clientY: 550, pointerId: 1 });
    expect(currentOrder()[5]).toBe("projects");
    expect(draggedTransform("projects")).toBe("translateY(6px)");
    // 换位会重写分区壳的 className（React），紧凑态必须还在。
    expect(section("projects")?.classList.contains(COMPACT_CLASS)).toBe(true);

    fireEvent.pointerUp(document, { clientX: 10, clientY: 550, pointerId: 1 });
  });

  it("未越过阈值时不会进入紧凑态", () => {
    stubSectionRects({ compactHeight: COMPACT_HEIGHT_PX });
    render(<Harness />);

    pressWithoutActivating("projects", 440);

    expect(sectionElements().some((el) => el.classList.contains(COMPACT_CLASS))).toBe(false);
    expect(document.querySelector(".profile-section-drag-ghost")).toBeNull();
    expect(section("projects")?.style.transform).toBe("");

    fireEvent.pointerUp(document, { clientX: 10, clientY: 444, pointerId: 1 });
    expect(sectionElements().some((el) => el.classList.contains(COMPACT_CLASS))).toBe(false);
  });

  it("pointercancel 也恢复展开（不留持久紧凑态）", () => {
    stubSectionRects({ compactHeight: COMPACT_HEIGHT_PX });
    render(<Harness />);

    dragTo("projects", 440, 490);
    expect(section("skills")?.classList.contains(COMPACT_CLASS)).toBe(true);

    fireEvent.pointerCancel(document, { clientX: 10, clientY: 490, pointerId: 1 });

    expect(sectionElements().some((el) => el.classList.contains(COMPACT_CLASS))).toBe(false);
  });

  it("折叠造成的位移写进 scrollTop：被拖卡尽量留在原处", () => {
    stubSectionRects({ compactHeight: COMPACT_HEIGHT_PX });
    // 滚动容器（jsdom 里 resolveScrollParent 兜底到文档滚动元素）：给出可滚范围。
    let scrollTopValue = 400;
    Object.defineProperty(document.documentElement, "scrollTop", {
      configurable: true,
      get: () => scrollTopValue,
      set: (value: number) => {
        scrollTopValue = value;
      },
    });
    Object.defineProperty(document.documentElement, "scrollHeight", {
      configurable: true,
      value: 2000,
    });
    Object.defineProperty(document.documentElement, "clientHeight", {
      configurable: true,
      value: 800,
    });
    try {
      render(<Harness />);

      // 折叠前 projects 上缘 410（200 + 100 + 30 + 80），折叠后 356（200 + 3×52）：
      // 文档整体上移 54px，scrollTop 反向补 54 → 400 − 54 = 346，卡片留在原处。
      dragTo("projects", 440, 490);
      expect(scrollTopValue).toBe(346);

      fireEvent.pointerUp(document, { clientX: 10, clientY: 490, pointerId: 1 });
    } finally {
      Reflect.deleteProperty(document.documentElement, "scrollTop");
      Reflect.deleteProperty(document.documentElement, "scrollHeight");
      Reflect.deleteProperty(document.documentElement, "clientHeight");
    }
  });

  it("松手后视角滚回被拖卡片居中（不停在被夹到 0 的页顶）", () => {
    stubSectionRects({ compactHeight: COMPACT_HEIGHT_PX });
    // 容器视口：400px 高、内容 1200px 高 → 可滚范围 0~800。
    let scrollTopValue = 0;
    Object.defineProperty(document.documentElement, "scrollTop", {
      configurable: true,
      get: () => scrollTopValue,
      set: (value: number) => {
        scrollTopValue = value;
      },
    });
    Object.defineProperty(document.documentElement, "scrollHeight", {
      configurable: true,
      get: () => 1200,
    });
    Object.defineProperty(document.documentElement, "clientHeight", {
      configurable: true,
      get: () => 400,
    });
    // 真机上 documentElement 的视口矩形 top 恒为 0、高 = clientHeight。这里必须用
    // defineProperty 写成**自有属性**：`vi.spyOn(documentElement, …)` 会波及
    // Element.prototype 上的几何桩（本文件所有分区 rect 都靠它），整栈高度会一起失真。
    Object.defineProperty(document.documentElement, "getBoundingClientRect", {
      configurable: true,
      value: () => rectOf(0, 400),
    });
    // 补偿帧由用例显式排空（jsdom 的 rAF 依赖计时器，act 里不可靠）。
    const frames = captureAnimationFrames();
    try {
      render(<Harness />);
      // 8px：越过阈值激活，但不足一档行程 —— 不换位，projects 仍在第 4 槽。
      // 折叠后上缘 356，指针 440 落在 52px 条外 → 抓取偏移 84，transform = (448−84)−356 = 8。
      dragTo("projects", 440, 448);
      expect(currentOrder()[3]).toBe("projects");

      const dragged = section("projects");
      expect(dragged).not.toBeNull();
      // 折叠期 scrollTop 被夹在 0（页顶），补偿无处可写。
      expect(scrollTopValue).toBe(0);

      // 让被拖卡的 rect 像真机一样随 scrollTop 变化：折叠态上缘 356、展开态上缘 410。
      Object.defineProperty(dragged as HTMLElement, "getBoundingClientRect", {
        configurable: true,
        value: () =>
          (dragged as HTMLElement).classList.contains(COMPACT_CLASS)
            ? rectOf(356 - scrollTopValue, COMPACT_HEIGHT_PX)
            : rectOf(410 - scrollTopValue, 60),
      });

      // 松手：展开位移先由 compensateReleaseShift 收敛（beforeLayoutTop = 356 − 8 = 348，
      // 首帧残差 410 − 348 = 62 → scrollTop 62，随后两帧残差 0 判定稳定）。
      fireEvent.pointerUp(document, { clientX: 10, clientY: 448, pointerId: 1 });
      // 再跑到 afterRestore 里的居中：62 + (410−62) − (400−60)/2 = 240。
      drainAnimationFrames(frames);

      expect(scrollTopValue).toBe(240);
      // 语义断言：卡片（60px）在 400px 视口里垂直居中 —— 上缘 170、中线 200。
      const settled = (dragged as HTMLElement).getBoundingClientRect();
      expect(settled.top - 0).toBe((400 - settled.height) / 2);
      expect(settled.top + settled.height / 2).toBe(200);
      // 关键回归点：视角绝不能停在页顶。
      expect(scrollTopValue).not.toBe(0);
    } finally {
      Reflect.deleteProperty(document.documentElement, "scrollTop");
      Reflect.deleteProperty(document.documentElement, "scrollHeight");
      Reflect.deleteProperty(document.documentElement, "clientHeight");
      Reflect.deleteProperty(document.documentElement, "getBoundingClientRect");
    }
  });

  it("拖动中途卸载：紧凑类与跟手位移随 DOM 一起消失（不留浮条）", () => {
    stubSectionRects({ compactHeight: COMPACT_HEIGHT_PX });
    const { unmount } = render(<Harness />);
    dragTo("projects", 440, 490);
    expect(section("projects")?.classList.contains(COMPACT_CLASS)).toBe(true);
    expect(section("projects")?.style.transform).not.toBe("");
    expect(ghostBar()).toBeNull();

    unmount();

    // 拖拽被打断（切路由 / 退出编辑态）时没有 pointerup 收尾：紧凑类与位移都随 DOM 消失，
    // 也不能留下任何挂在 body 上的浮条。
    expect(sectionElements()).toHaveLength(0);
    expect(ghostBar()).toBeNull();
  });
});

/** 生产链路的落点：`compact` prop 由 ProfileSectionStack 从 store 快照下发到每个壳。 */
describe("SortableProfileSection 的 compact 开关", () => {
  function renderShell({ compact, collapsed = false }: { compact?: boolean; collapsed?: boolean }) {
    return render(
      <SortableProfileSection
        sectionKey="projects"
        order={2}
        editable
        reordering
        dragging={false}
        compact={compact}
        collapsed={collapsed}
        canMoveUp
        canMoveDown
        onToggleCollapsed={() => {}}
        onHandlePointerDown={() => {}}
        onMoveByOffset={() => {}}
      >
        <div>项目内容</div>
      </SortableProfileSection>,
    );
  }

  function shell(): HTMLElement | null {
    return document.querySelector<HTMLElement>('[data-profile-section-key="projects"]');
  }

  it("compact 为真时挂 is-compact，默认不挂（查看态折叠另走 is-collapsed）", () => {
    const { unmount } = renderShell({ compact: true });
    expect(shell()?.classList.contains(COMPACT_CLASS)).toBe(true);
    // 折叠只影响拖拽期：查看态的 is-collapsed 是另一条路径，不会顺带挂上紧凑类。
    expect(shell()?.classList.contains("is-collapsed")).toBe(false);
    unmount();

    renderShell({ collapsed: true });
    expect(shell()?.classList.contains(COMPACT_CLASS)).toBe(false);
    expect(shell()?.classList.contains("is-collapsed")).toBe(true);
  });
});

/** 松手落点的纯函数层（`profileCompactDrag.centerElementInContainer`）。 */
describe("centerElementInContainer", () => {
  /** 造一个可滚容器：内容 scrollHeight 与视口 clientHeight 手写，getBoundingClientRect 桩掉。 */
  function makeScroller({
    scrollTop = 0,
    scrollHeight = 2000,
    clientHeight = 500,
    top = 0,
  }: {
    scrollTop?: number;
    scrollHeight?: number;
    clientHeight?: number;
    top?: number;
  }) {
    const container = document.createElement("div");
    let current = scrollTop;
    Object.defineProperty(container, "scrollTop", {
      configurable: true,
      get: () => current,
      set: (value: number) => {
        current = value;
      },
    });
    Object.defineProperty(container, "scrollHeight", { configurable: true, value: scrollHeight });
    Object.defineProperty(container, "clientHeight", { configurable: true, value: clientHeight });
    vi.spyOn(container, "getBoundingClientRect").mockImplementation(() =>
      rectOf(top, clientHeight),
    );
    return { container, scrollTop: () => current };
  }

  it("把元素滚到容器视口中央", () => {
    const { container, scrollTop } = makeScroller({ scrollTop: 100, clientHeight: 500 });
    const element = document.createElement("div");
    vi.spyOn(element, "getBoundingClientRect").mockImplementation(() => rectOf(700, 100));

    centerElementInContainer(element, container);

    // 100 + (700 − 0) − (500 − 100)/2 = 600。
    expect(scrollTop()).toBe(600);
  });

  it("目标越界时夹在可滚范围内（不能滚出内容）", () => {
    const { container, scrollTop } = makeScroller({ scrollTop: 0, clientHeight: 500 });
    const element = document.createElement("div");
    vi.spyOn(element, "getBoundingClientRect").mockImplementation(() => rectOf(9000, 100));

    centerElementInContainer(element, container);

    // 9000 − 200 = 8800 ≫ 2000 − 500 = 1500 → 夹到 1500。
    expect(scrollTop()).toBe(1500);
  });

  it("容器不可滚时不写 scrollTop（内容没超高）", () => {
    const { container, scrollTop } = makeScroller({
      scrollTop: 0,
      scrollHeight: 400,
      clientHeight: 500,
    });
    const element = document.createElement("div");
    const rectSpy = vi
      .spyOn(element, "getBoundingClientRect")
      .mockImplementation(() => rectOf(900, 100));

    centerElementInContainer(element, container);

    expect(scrollTop()).toBe(0);
    // 提前返回：连 rect 都不必量（省一次强制布局）。
    expect(rectSpy).not.toHaveBeenCalled();
  });

  it("拿不到滚动容器时退回 scrollIntoView({block:center})", () => {
    const element = document.createElement("div");
    const scrollIntoView = vi.fn();
    element.scrollIntoView = scrollIntoView;

    centerElementInContainer(element, null);

    // 不用 smooth：松手即到位，动画会让「刚拖完」的反馈滞后。
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "auto" });
  });

  it("元素缺失时静默返回（拖拽未激活/已卸载的兜底路径）", () => {
    const { container } = makeScroller({});
    expect(() => centerElementInContainer(null, container)).not.toThrow();
  });
});
