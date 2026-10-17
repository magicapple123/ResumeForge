/** 拖拽重排的渲染成本守卫（React Profiler 计数）。
 *
 * 背景：用户实测拖拽排序仍卡顿。根因不在 memo 链路（QA 审过），而在顺序状态走页面级
 * React state——每次实时 splice 打穿 `resumeContent`/`workspaceTabs` 的 useMemo，
 * antd Form 换 context、全部 Form.Item 陪跑（单次实测 170ms）。order 外部 store 化后：
 *
 * 1. 拖拽中的每次 splice 只重渲订阅 store 的分区栈（本文件用同样的消费方式建模）；
 * 2. 分区内容子树被 memo + 稳定 children 钉住，**一次都不应重渲**；
 * 3. DOM 顺序固定为默认序（视觉顺序走 CSS order），被拖分区的 DOM 节点全程不换。
 *
 * 注意：jsdom 的 Profiler duration 不可信，这里只断言**次数**（行为计数），不碰动画
 * 中间态、不比对毫秒数。计数器用组件内 useRef 持有（React Compiler 禁止改 props，
 * 也不能在渲染期读 ref——计数器经 effect 注册给测试，读取发生在渲染之外）。
 */

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import {
  Profiler,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SECTION_ORDER,
  SECTION_LABELS,
} from "../../components/profile/ProfileSectionConfig";
import type { ProfileSectionKey } from "../../components/profile/ProfileSectionConfig";
import { SortableProfileSection } from "../../components/profile/ProfileSectionShell";
import type { ReorderRenderCounters } from "./useProfileSectionReorder";
import { useProfileSectionReorder } from "./useProfileSectionReorder";

/** 每个分区的高度（jsdom 无布局，测试里用 getBoundingClientRect 桩出栈式布局）。
 * summary ≥ ENTRY_MARGIN_PX（24）：保证「拖到 clamp 上限可达末位」的几何前提成立。 */
const HEIGHTS: Record<ProfileSectionKey, number> = {
  basic_info: 100,
  experiences: 80,
  projects: 60,
  skills: 40,
  educations: 30,
  awards: 20,
  campus_experiences: 20,
  summary: 40,
};
const STACK_TOP = 200;

/** 按视觉序（CSS order）从 STACK_TOP 桩出垂直栈；与真实 flex + order 布局同构。 */
function stubSectionRects() {
  return vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
    this: Element,
  ) {
    const key = (this as HTMLElement).dataset?.profileSectionKey ?? "";
    const siblings = this.parentElement ? Array.from(this.parentElement.children) : [];
    const visualOrder = (sibling: Element) =>
      Number((sibling as HTMLElement).style?.order ?? "0") || 0;
    const visualSiblings = [...siblings].sort((a, b) => visualOrder(a) - visualOrder(b));
    let top = STACK_TOP;
    for (const sibling of visualSiblings) {
      if (sibling === this) break;
      const siblingKey = (sibling as HTMLElement).dataset?.profileSectionKey ?? "";
      top += HEIGHTS[siblingKey as ProfileSectionKey] ?? 0;
    }
    const height = HEIGHTS[key as ProfileSectionKey] ?? 0;
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
  });
}

function PerfHarness({
  registerCounters,
}: {
  registerCounters: (counters: ReorderRenderCounters) => void;
}) {
  const reorder = useProfileSectionReorder({ editing: true, saving: false, photoReading: false });
  const { sectionOrder, reordering } = useSyncExternalStore(
    reorder.sectionOrderStore.subscribe,
    reorder.sectionOrderStore.getSnapshot,
  );

  // 计数器放在组件内 ref 里：onRender 回调写 ref 属事件时刻行为，编译器允许。
  const contentRenders = useRef(0);
  const commits = useRef(0);
  const counters = useMemo(() => ({ contentRenders, commits }), [contentRenders, commits]);
  useEffect(() => {
    registerCounters(counters);
  }, [counters, registerCounters]);

  // 生产实现里回调经 ref 转发保持引用稳定（ProfilePage 同款）；这里照抄，
  // 让 memo 化的分区壳在 splice 时能真正跳过未变化的分区。
  const reorderRef = useRef(reorder);
  useEffect(() => {
    reorderRef.current = reorder;
  });
  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, key: ProfileSectionKey) => {
      reorderRef.current.handleSectionPointerDown(event, key);
    },
    [],
  );
  const moveByOffset = useCallback((key: ProfileSectionKey, offset: -1 | 1) => {
    reorderRef.current.moveSectionByOffset(key, offset);
  }, []);
  const noop = useCallback(() => {}, []);

  // 分区内容整体 memo（ProfileSectionStack 的 sectionContent 同款）：元素引用恒定，
  // 配合壳的 memo，拖拽重排时内容子树应整块跳过——Profiler 计数守住这条不变量。
  const content = useMemo(() => {
    const map = {} as Record<ProfileSectionKey, ReactNode>;
    for (const key of DEFAULT_SECTION_ORDER) {
      map[key] = (
        <Profiler
          id={`content:${key}`}
          onRender={() => {
            contentRenders.current += 1;
          }}
        >
          <div>{key} 的分区内容</div>
        </Profiler>
      );
    }
    return map;
  }, []);

  return (
    <Profiler
      id="section-stack"
      onRender={() => {
        commits.current += 1;
      }}
    >
      <div
        className="profile-section-stack"
        data-order={sectionOrder.join(",")}
        data-testid="section-stack"
      >
        {DEFAULT_SECTION_ORDER.map((key) => (
          <SortableProfileSection
            key={key}
            sectionKey={key}
            order={sectionOrder.indexOf(key)}
            editable
            reordering={reordering}
            dragging={false}
            collapsed={false}
            canMoveUp={sectionOrder.indexOf(key) > 1}
            canMoveDown={sectionOrder.indexOf(key) < sectionOrder.length - 1}
            onToggleCollapsed={noop}
            onHandlePointerDown={handlePointerDown}
            onMoveByOffset={moveByOffset}
          >
            {content[key]}
          </SortableProfileSection>
        ))}
      </div>
    </Profiler>
  );
}

function dragHandle(key: ProfileSectionKey, fromY: number) {
  // 真实壳的 aria-label 用的是人话分区名（SECTION_LABELS）。
  fireEvent.pointerDown(
    document.querySelector(`[aria-label="拖动调整${SECTION_LABELS[key]}顺序"]`) as HTMLElement,
    { clientX: 10, clientY: fromY, pointerId: 1 },
  );
}

/**
 * 激活与几何采集都在第一个 pointermove 里同步完成（拖拽期不塌缩、不改布局，
 * 没有待提交的补偿），所以这里不需要任何 flush / 等待。
 */
async function flushCollapse() {
  await act(async () => {});
}

/** 激活后分三档移动，制造 3 次实时 splice（跨 3 个分区）。 */
async function dragSteps(key: ProfileSectionKey, fromY: number, toY: number) {
  dragHandle(key, fromY);
  fireEvent.pointerMove(document, {
    clientX: 10,
    clientY: fromY + (toY - fromY) / 3,
    pointerId: 1,
  });
  await flushCollapse();
  fireEvent.pointerMove(document, {
    clientX: 10,
    clientY: fromY + (2 * (toY - fromY)) / 3,
    pointerId: 1,
  });
  fireEvent.pointerMove(document, { clientX: 10, clientY: toY, pointerId: 1 });
  fireEvent.pointerUp(document, { clientX: 10, clientY: toY, pointerId: 1 });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("拖拽重排渲染成本（Profiler 计数）", () => {
  it("拖 projects 跨 3 个分区：分区内容零重渲、提交数有界、DOM 节点不换", async () => {
    stubSectionRects();
    // 用 holder 而不是 let + 闭包赋值：TS 对闭包内的赋值不做收窄，let 会被推成 never。
    const holder: { current: ReorderRenderCounters | null } = { current: null };
    const registerCounters = (registered: ReorderRenderCounters) => {
      holder.current = registered;
    };
    render(<PerfHarness registerCounters={registerCounters} />);
    const counters = holder.current;
    if (!counters) throw new Error("counters not registered");

    // 挂载基线：8 个分区内容各渲染 1 次（提交次数受 antd 内部挂载影响，只记数不断言）。
    const commitsAtMount = counters.commits.current;
    const contentRendersAtMount = counters.contentRenders.current;
    expect(commitsAtMount).toBeGreaterThan(0);
    expect(contentRendersAtMount).toBe(DEFAULT_SECTION_ORDER.length);

    // projects 在视觉栈的 380-440；拖到 y=560，每档指针行程 50px ≥ 步长 48，
    // 三档各推进一格（实测每档一次实时 splice，共 3 次）。
    const projectsNode = document.querySelector<HTMLElement>(
      '[data-profile-section-key="projects"]',
    );
    await dragSteps("projects", 410, 560);

    // 核心不变量：分区内容子树一次都没重渲（memo + 稳定 children 真实生效）。
    expect(counters.contentRenders.current).toBe(contentRendersAtMount);

    // 提交次数有界：激活 1 + 实时 splice 3 + 松手清理 1 ≈ 5；给点余量防 React
    // 版本差异导致的拆分 commit，但绝不允许随分区数/拖动距离线性增长。
    const commitDelta = counters.commits.current - commitsAtMount;
    expect(commitDelta).toBeLessThanOrEqual(8);

    // DOM 顺序固定：被拖分区的 DOM 节点全程同一个（不重挂、不移动），只有
    // CSS order 内联样式跟着视觉顺序更新。
    const projectsAfter = document.querySelector<HTMLElement>(
      '[data-profile-section-key="projects"]',
    );
    expect(projectsAfter).toBe(projectsNode);
    const finalOrder = (projectsAfter?.style.order ?? "").toString();
    expect(finalOrder).toBe("5");

    // 松手后顺序落到 store（视觉序），且拖拽态清理干净。
    expect(
      (document.querySelector('[data-testid="section-stack"]')?.getAttribute("data-order") ?? "")
        .split(",")
        .indexOf("projects"),
    ).toBe(5);
    expect(projectsAfter?.classList.contains("is-dragging")).toBe(false);
    expect(projectsAfter?.style.transform).toBe("");
  });
});
