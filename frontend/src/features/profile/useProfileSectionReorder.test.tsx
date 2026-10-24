// SPDX-License-Identifier: Apache-2.0
/** 资料分区拖拽重排：按下不塌缩、实时重排、前缘插入判定、直接算目标位置的跟手视觉。
 *
 * 第二轮修复后的行为契约（jsdom 只能验证算术与事件流，真机行为由
 * `.workbuddy/tmp/drag-repro/verify.cjs` 在真实 Chromium 里验收）：
 * 1. 拖拽期**不改变布局**（塌缩与跟手在几何上不兼容，见 hook 注释）；
 * 2. 插入判定用被拖项**前缘**，clamp 上限处一定能到达末位（旧实现的死锁回归）；
 * 3. `transform = 视觉目标位置 − 当前顺序下的布局位置`，不做累加补偿。
 *
 * 焦点收尾（R10）的两条用例拆到了 `useProfileSectionReorder.focus.test.tsx`，
 * 共用脚手架在同目录 `profileReorderHarness.testkit.tsx`（行数预算）。
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SECTION_ORDER } from "../../components/profile/ProfileSectionConfig";
import {
  currentOrder,
  dragTo,
  draggedTransform,
  Harness,
  resetReorderTestState,
  STACK_TOP,
  stubSectionRects,
} from "./profileReorderHarness.testkit";

afterEach(() => {
  resetReorderTestState();
});

describe("useProfileSectionReorder（order 外部 store 化）", () => {
  it("按下不塌缩：未过阈值不动布局；拖动中即时重排，松手保留", () => {
    stubSectionRects();
    // jsdom 没有实现 document.elementFromPoint：先补一个可观测的桩，
    // 全流程断言它从未被调用（T05 核心约束：零 DOM 命中测试）。
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => null),
    });
    const elementFromPoint = document.elementFromPoint as unknown as ReturnType<typeof vi.fn>;
    render(<Harness />);

    // projects 卡片在默认布局的 410-470；手柄按在 440（距卡片上缘 30）。
    fireEvent.pointerDown(screen.getByLabelText("拖动调整projects顺序"), {
      clientX: 10,
      clientY: 440,
      pointerId: 1,
    });
    // 未过阈值（6px）：不激活、不重排。
    fireEvent.pointerMove(document, { clientX: 10, clientY: 442, pointerId: 1 });
    expect(currentOrder()).toEqual(DEFAULT_SECTION_ORDER);

    // 拖到 490：越过阈值激活（激活时不改布局），行程 = 460−410 = 50 ≥ 步长 48
    // → 推进一格，目标位 4，实时重排。
    fireEvent.pointerMove(document, { clientX: 10, clientY: 490, pointerId: 1 });
    expect(currentOrder()).toEqual([
      "basic_info",
      "educations",
      "experiences",
      "skills",
      "projects",
      "campus_experiences",
      "awards",
      "summary",
    ]);
    // 跟手：desiredTop = 490-30 = 460；重排后 projects 在第 5 位（index 4），
    // 布局上缘 = 200+100+30+80+40 = 450 → transform = 460-450 = +10。
    // 视觉位置 = 450+10 = 460 = 指针 490 - grabOffset 30，卡片钉在鼠标下。
    expect(draggedTransform("projects")).toBe("translateY(10px)");
    // 拖动中挂 is-dragging（置顶 + 合成层提示，见 profile.css）；顺序虽变，DOM 节点不换。
    const dragged = document.querySelector<HTMLElement>('[data-profile-section-key="projects"]');
    expect(dragged?.classList.contains("is-dragging")).toBe(true);

    // 松手保留：顺序就是拖动中的最终态；同时退出拖拽态（content-visibility 复位）。
    fireEvent.pointerUp(document, { clientX: 10, clientY: 490, pointerId: 1 });
    expect(currentOrder()).toEqual([
      "basic_info",
      "educations",
      "experiences",
      "skills",
      "projects",
      "campus_experiences",
      "awards",
      "summary",
    ]);
    expect(dragged?.classList.contains("is-dragging")).toBe(false);
    expect(dragged?.style.transform).toBe("");
    expect(document.querySelector(".profile-section-stack")?.className).toBe(
      "profile-section-stack",
    );
    // 全程零 elementFromPoint（T05 核心约束）。
    expect(elementFromPoint).not.toHaveBeenCalled();
  });

  it("激活瞬间不跳位：越过阈值那一步的顺序与位置都由指针决定", () => {
    stubSectionRects();
    render(<Harness />);

    // 按下 experiences（330-410，按在 370），只移动 8px（刚过 6px 阈值）。
    fireEvent.pointerDown(screen.getByLabelText("拖动调整experiences顺序"), {
      clientX: 10,
      clientY: 370,
      pointerId: 1,
    });
    fireEvent.pointerMove(document, { clientX: 10, clientY: 378, pointerId: 1 });
    // 顺序不变（旧实现塌缩后这里会凭空上移两位）。
    expect(currentOrder()).toEqual(DEFAULT_SECTION_ORDER);
    // 跟手：grabOffset = 370-330 = 40，desiredTop = 378-40 = 338，
    // 布局上缘 330 → transform = +8px，与指针位移完全一致（没有跳变、没有被甩出去）。
    expect(draggedTransform("experiences")).toBe("translateY(8px)");
    // 卡片没有被甩出栈顶，也没有脱离指针。
    expect(338).toBeGreaterThanOrEqual(STACK_TOP);
  });

  it("末位可达：拖到 clamp 上限一定换到最后一格并错开", () => {
    stubSectionRects();
    render(<Harness />);

    // 指针拖到很远（10000）：desiredTop 被钳到 stackBottom-60 = 630，
    // 行程 = 630−410 = 220 = 4 步 → 3+4 钳到 7（末位）。
    dragTo("projects", 440, 10_000);
    expect(currentOrder()).toEqual([
      "basic_info",
      "educations",
      "experiences",
      "skills",
      "campus_experiences",
      "awards",
      "summary",
      "projects",
    ]);
    // 末位布局上缘 630，视觉位置 = 630 + 0。行程制下钳位保证大行程必然到达末位。
    expect(draggedTransform("projects")).toBe("translateY(0px)");
  });

  it("basic_info 固定首位：向上拖不可越过，transform 钳在栈范围内", () => {
    stubSectionRects();
    render(<Harness />);

    dragTo("projects", 440, 210);
    // 指针已到栈顶以上：desiredTop 钳为 200，插入位钳为 1，basic_info 仍在首位。
    expect(currentOrder()[0]).toBe("basic_info");
    expect(currentOrder()).toEqual([
      "basic_info",
      "projects",
      "educations",
      "experiences",
      "skills",
      "campus_experiences",
      "awards",
      "summary",
    ]);
    // 视觉目标位置 200；重排后 projects 在第 1 位，布局上缘 300 → transform = -100。
    expect(draggedTransform("projects")).toBe("translateY(-100px)");
  });

  it("交换帧一致：store 提交后分区 order 与被拖分区 transform 同步落定（flushSync 契约）", () => {
    stubSectionRects();
    render(<Harness />);

    fireEvent.pointerDown(screen.getByLabelText("拖动调整projects顺序"), {
      clientX: 10,
      clientY: 440,
      pointerId: 1,
    });

    // 用原生 dispatchEvent 而不是 fireEvent：fireEvent 结束时会兜底 flush React
    // 更新，错帧窗口就被掩盖了。这里在「分派同步返回后、React 兜底提交之前」的
    // 窗口内断言——修复前 CSS order 还是旧值（2）而 transform 已按新布局写入，
    // 本用例必挂；修复后（flushSync 包住 commitOrder）顺序提交与 transform 同帧生效。
    act(() => {
      document.dispatchEvent(
        new MouseEvent("pointermove", { bubbles: true, clientX: 10, clientY: 490 }),
      );

      const dragged = document.querySelector<HTMLElement>('[data-profile-section-key="projects"]');
      // 顺序已提交：projects 的 CSS order 内联样式是 4（新序）。
      expect(dragged?.style.order).toBe("4");
      // 跟手 transform 与新布局一致：desiredTop = 460，新布局上缘 450 → +10。
      expect(dragged?.style.transform).toBe("translateY(10px)");
    });

    fireEvent.pointerUp(document, { clientX: 10, clientY: 490, pointerId: 1 });
  });

  it("上移/下移按钮（键盘可访问性）语义不变，basic_info 不可被顶替", () => {
    stubSectionRects();
    render(<Harness />);

    // educations 紧跟在页眉之后：目标位 ≤ 0 直接放弃（页眉固定在首位）。
    fireEvent.click(screen.getByLabelText("上移educations"));
    expect(currentOrder()).toEqual(DEFAULT_SECTION_ORDER);

    // experiences 的上一位是 educations，不是页眉：按上移真的换位。
    fireEvent.click(screen.getByLabelText("上移experiences"));
    expect(currentOrder()).toEqual([
      "basic_info",
      "experiences",
      "educations",
      "projects",
      "skills",
      "campus_experiences",
      "awards",
      "summary",
    ]);

    // basic_info 自身不可移动。
    fireEvent.click(screen.getByLabelText("上移basic_info"));
    fireEvent.click(screen.getByLabelText("下移basic_info"));
    expect(currentOrder()[0]).toBe("basic_info");
  });

  it("外部滚动只平移几何、不动闩锁锚点：不换位且仍跟手", () => {
    stubSectionRects();
    // 模拟滚动容器（jsdom 无布局 → resolveScrollParent 兜底到 document.documentElement）
    let scrollTopValue = 0;
    Object.defineProperty(document.documentElement, "scrollTop", {
      configurable: true,
      get: () => scrollTopValue,
      set: (value: number) => {
        scrollTopValue = value;
      },
    });
    render(<Harness />);

    // experiences（330-410）按在 370，移动 8px 激活：desiredTop = 338，闩锁锚点 = 330。
    dragTo("experiences", 370, 378);
    expect(currentOrder()).toEqual(DEFAULT_SECTION_ORDER);
    expect(draggedTransform("experiences")).toBe("translateY(8px)");

    // 外部滚动 60px（浏览器 scroll anchoring / 用户滚轮）：只平移几何，**不动锚点**。
    // 若锚点也跟着平移 60（上一版），距离 60 ≥ latch 12 就会立刻换位 → 与 anchoring
    // 形成正反馈（QA 实测 10/10 翻转、邻卡 890px 弹跳）。
    act(() => {
      scrollTopValue = 60;
      document.documentElement.dispatchEvent(new Event("scroll"));
    });
    expect(currentOrder()).toEqual(DEFAULT_SECTION_ORDER);
    // 几何平移后第 3 位布局上缘 = 200+100+30-60 = 270 → transform = 338-270 = 68（跟手不漂移）。
    expect(draggedTransform("experiences")).toBe("translateY(68px)");

    // 之后再微抖 ±2px：锚点没被推开，仍然不换位。
    fireEvent.pointerMove(document, { clientX: 10, clientY: 380, pointerId: 1 });
    fireEvent.pointerMove(document, { clientX: 10, clientY: 376, pointerId: 1 });
    expect(currentOrder()).toEqual(DEFAULT_SECTION_ORDER);

    fireEvent.pointerUp(document, { clientX: 10, clientY: 376, pointerId: 1 });
    Reflect.deleteProperty(document.documentElement, "scrollTop");
  });

  it("拖拽期关闭 overflow-anchor，松手后在补偿帧里恢复", () => {
    stubSectionRects();
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {
      frames.length = 0;
    });
    // 原本有内联值：应恢复成原值而不是清空。
    document.documentElement.style.setProperty("overflow-anchor", "auto");
    render(<Harness />);

    dragTo("projects", 440, 448);
    // 激活即关锚定（换位造成的布局变动不会再被 anchoring 反向补偿）。
    expect(document.documentElement.style.getPropertyValue("overflow-anchor")).toBe("none");

    fireEvent.pointerUp(document, { clientX: 10, clientY: 448, pointerId: 1 });
    // 补偿 rAF 执行之前不能恢复，否则 anchoring 会和补偿双重补偿。
    expect(document.documentElement.style.getPropertyValue("overflow-anchor")).toBe("none");

    // 收敛阶段：只写 scrollTop，不恢复锚定。
    act(() => {
      frames.shift()?.(0);
    });
    expect(document.documentElement.style.getPropertyValue("overflow-anchor")).toBe("none");
    // 排空后续收敛帧后，才在最后一帧恢复（避免 anchoring 与补偿叠加）。
    act(() => {
      let guard = 0;
      while (frames.length > 0 && guard < 30) {
        frames.shift()?.(0);
        guard += 1;
      }
    });
    expect(document.documentElement.style.getPropertyValue("overflow-anchor")).toBe("auto");
    document.documentElement.style.removeProperty("overflow-anchor");
  });

  it("上一次补偿收敛期间开始新拖拽：锚定全程保持 none，结束后才清空", () => {
    stubSectionRects();
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {
      frames.length = 0;
    });
    render(<Harness />);
    const anchorAttr = () => document.documentElement.style.getPropertyValue("overflow-anchor");

    // 拖拽 A：激活 → 关闭锚定；松手 → 补偿开始按帧收敛（帧还没跑）
    dragTo("projects", 440, 448);
    expect(anchorAttr()).toBe("none");
    fireEvent.pointerUp(document, { clientX: 10, clientY: 448, pointerId: 1 });

    // A 还在收敛窗口里，立刻开始拖拽 B
    dragTo("skills", 490, 498);
    expect(anchorAttr()).toBe("none");

    // 排空 A 的收敛帧（含 A 的恢复回调）：B 仍持有一份，锚定必须还是 none
    act(() => {
      let guard = 0;
      while (frames.length > 0 && guard < 30) {
        frames.shift()?.(0);
        guard += 1;
      }
    });
    expect(anchorAttr()).toBe("none");

    // B 松手并排空：两次都释放后才真正清空
    fireEvent.pointerUp(document, { clientX: 10, clientY: 498, pointerId: 1 });
    act(() => {
      let guard = 0;
      while (frames.length > 0 && guard < 30) {
        frames.shift()?.(0);
        guard += 1;
      }
    });
    expect(anchorAttr()).toBe("");
  });

  it("pointercancel 清理：transform 复位，后续移动不再改顺序", () => {
    stubSectionRects();
    render(<Harness />);

    dragTo("projects", 440, 490);
    expect(currentOrder()[4]).toBe("projects");
    const orderAtDrag = [...currentOrder()];

    fireEvent.pointerCancel(document, { clientX: 10, clientY: 500, pointerId: 1 });
    const dragged = document.querySelector<HTMLElement>('[data-profile-section-key="projects"]');
    expect(dragged?.style.transform).toBe("");

    // 取消后指针再动：没有激活的拖拽，顺序冻结。
    fireEvent.pointerMove(document, { clientX: 10, clientY: 200, pointerId: 1 });
    expect(currentOrder()).toEqual(orderAtDrag);
  });

  it("重置（取消编辑回滚）恢复传入顺序", () => {
    stubSectionRects();
    render(<Harness />);

    dragTo("projects", 440, 490);
    fireEvent.pointerUp(document, { clientX: 10, clientY: 490, pointerId: 1 });
    expect(currentOrder()[3]).toBe("skills");

    fireEvent.click(screen.getByLabelText("重置projects"));
    expect(currentOrder()).toEqual(DEFAULT_SECTION_ORDER);
  });

  it("编辑态门控：非编辑态下 pointerdown 不进入排序、不响应拖动", () => {
    stubSectionRects();
    render(<Harness editing={false} />);

    dragTo("projects", 440, 470);
    expect(currentOrder()).toEqual(DEFAULT_SECTION_ORDER);
    const dragged = document.querySelector<HTMLElement>('[data-profile-section-key="projects"]');
    expect(dragged?.style.transform).toBe("");
  });
});
