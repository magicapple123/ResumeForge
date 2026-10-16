/** 资料分区拖拽重排（order 外部 store 化后）：高度前缀和、实时重排、零 elementFromPoint、
 *  order 变化的布局位移补偿（被拖卡片视觉连续跟手）。 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SECTION_ORDER } from "../../components/profile/ProfileSectionConfig";
import type { ProfileSectionKey } from "../../components/profile/ProfileSectionConfig";
import { draggedLayoutShift, useProfileSectionReorder } from "./useProfileSectionReorder";

/** 每个分区的高度（jsdom 无布局，测试里用 getBoundingClientRect 桩出栈式布局）。 */
const HEIGHTS: Record<ProfileSectionKey, number> = {
  basic_info: 100,
  experiences: 80,
  projects: 60,
  skills: 40,
  educations: 30,
  awards: 20,
  campus_experiences: 20,
  summary: 20,
};
const STACK_TOP = 200;

/** 当前顺序直接从 DOM 的 data-order 属性读回，测试里不持有模块级可变状态。 */
function currentOrder(): ProfileSectionKey[] {
  const raw = screen.getByTestId("section-stack").getAttribute("data-order") ?? "";
  return raw.split(",").filter(Boolean) as ProfileSectionKey[];
}

function Harness({ editing = true }: { editing?: boolean }) {
  const reorder = useProfileSectionReorder({ editing, saving: false, photoReading: false });
  // 与 ProfileSectionStack 相同的消费方式：顺序经外部 store 订阅。
  const { sectionOrder } = useSyncExternalStore(
    reorder.sectionOrderStore.subscribe,
    reorder.sectionOrderStore.getSnapshot,
  );
  return (
    <div
      className="profile-section-stack"
      data-order={sectionOrder.join(",")}
      data-testid="section-stack"
    >
      {/* 与生产实现一致：DOM 顺序固定为默认序，视觉顺序交给 CSS order。 */}
      {DEFAULT_SECTION_ORDER.map((key) => (
        <div key={key} data-profile-section-key={key} style={{ order: sectionOrder.indexOf(key) }}>
          <button
            type="button"
            aria-label={`拖动调整${key}顺序`}
            onPointerDown={(event) => reorder.handleSectionPointerDown(event, key)}
          />
          <button
            type="button"
            aria-label={`上移${key}`}
            onClick={() => reorder.moveSectionByOffset(key, -1)}
          />
          <button
            type="button"
            aria-label={`下移${key}`}
            onClick={() => reorder.moveSectionByOffset(key, 1)}
          />
          <button
            type="button"
            aria-label={`重置${key}`}
            onClick={() => reorder.resetSectionReorder(DEFAULT_SECTION_ORDER)}
          />
        </div>
      ))}
    </div>
  );
}

/** 把分区高度桩成按 **视觉序（CSS order）** 从 STACK_TOP 起的垂直栈（gap=0）。
 * 真实浏览器里 flex 容器按 order 摆放分区；jsdom 没有布局，这里按各分区当前的
 * order 内联样式排序模拟——每次 rect 查询都现算，splice 更新 order 后立刻反映。 */
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

function dragTo(key: ProfileSectionKey, fromY: number, toY: number) {
  fireEvent.pointerDown(screen.getByLabelText(`拖动调整${key}顺序`), {
    clientX: 10,
    clientY: fromY,
    pointerId: 1,
  });
  fireEvent.pointerMove(document, { clientX: 10, clientY: toY, pointerId: 1 });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useProfileSectionReorder（order 外部 store 化）", () => {
  it("拖动中即时重排：目标 index 变化即生效，不等 pointerup；松手保留", () => {
    stubSectionRects();
    // jsdom 没有实现 document.elementFromPoint：先补一个可观测的桩，
    // 全流程断言它从未被调用（T05 核心约束：零 DOM 命中测试）。
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => null),
    });
    const elementFromPoint = document.elementFromPoint as unknown as ReturnType<typeof vi.fn>;
    render(<Harness />);

    // projects 卡片在默认布局的 380-440；手柄按下约在其内部 y=410。
    dragTo("projects", 410, 412);
    // 未过阈值（6px）：不激活、不重排。
    expect(currentOrder()).toEqual(DEFAULT_SECTION_ORDER);

    // 拖到 y=430：越过 skills 中心（移除被拖项后的布局中为 400）→ 实时重排。
    fireEvent.pointerMove(document, { clientX: 10, clientY: 430, pointerId: 1 });
    expect(currentOrder()).toEqual([
      "basic_info",
      "experiences",
      "skills",
      "projects",
      "educations",
      "awards",
      "campus_experiences",
      "summary",
    ]);
    // 跟手视觉：被拖分区 transform 直改。指针位移 430-410=+20，但 splice 把
    // projects 从第 3 位挪到第 4 位，盒子布局位置下移 40px（skills 高度），
    // transform 补偿布局位移：20-40=-20。视觉位置 = 新布局 420 + (-20) = 400，
    // 与重排前一致（380+20）——卡片始终钉在鼠标上。
    const dragged = document.querySelector<HTMLElement>('[data-profile-section-key="projects"]');
    expect(dragged?.style.transform).toBe("translateY(-20px)");
    // 拖动中挂 is-dragging（置顶 + 合成层提示，见 profile.css）；顺序虽变，DOM 节点不换。
    expect(dragged?.classList.contains("is-dragging")).toBe(true);

    // 松手保留：顺序就是拖动中的最终态。
    fireEvent.pointerUp(document, { clientX: 10, clientY: 430, pointerId: 1 });
    expect(currentOrder()).toEqual([
      "basic_info",
      "experiences",
      "skills",
      "projects",
      "educations",
      "awards",
      "campus_experiences",
      "summary",
    ]);
    // 松手后清理抬起态。
    expect(dragged?.classList.contains("is-dragging")).toBe(false);
    expect(dragged?.style.transform).toBe("");
    // 全程零 elementFromPoint（T05 核心约束）。
    expect(elementFromPoint).not.toHaveBeenCalled();
  });

  it("basic_info 固定首位：向上拖不可越过，transform 钳在栈范围内", () => {
    stubSectionRects();
    render(<Harness />);

    dragTo("projects", 410, 210);
    // 指针已到栈顶以上：插入位钳为 1，basic_info 仍在首位。
    expect(currentOrder()[0]).toBe("basic_info");
    expect(currentOrder()).toEqual([
      "basic_info",
      "projects",
      "experiences",
      "skills",
      "educations",
      "awards",
      "campus_experiences",
      "summary",
    ]);
    // 指针位移 -200 被钳到 minTranslate = 200-380 = -180；splice 把 projects 挪到
    // 第 2 位（布局位置上移 80px → 位移补偿 -80）：transform = -180-(-80) = -100。
    // 视觉位置 = 新布局 300 + (-100) = 200 = 栈顶，卡片贴住上边界不越界。
    const dragged = document.querySelector<HTMLElement>('[data-profile-section-key="projects"]');
    expect(dragged?.style.transform).toBe("translateY(-100px)");
  });

  it("上移/下移按钮（键盘可访问性）语义不变，basic_info 不可被顶替", () => {
    stubSectionRects();
    render(<Harness />);

    fireEvent.click(screen.getByLabelText("上移educations"));
    expect(currentOrder()).toEqual([
      "basic_info",
      "experiences",
      "projects",
      "educations",
      "skills",
      "awards",
      "campus_experiences",
      "summary",
    ]);

    // experiences 的上一位是 basic_info：按上移不动。
    fireEvent.click(screen.getByLabelText("上移experiences"));
    expect(currentOrder()[1]).toBe("experiences");

    // basic_info 自身不可移动。
    fireEvent.click(screen.getByLabelText("上移basic_info"));
    fireEvent.click(screen.getByLabelText("下移basic_info"));
    expect(currentOrder()[0]).toBe("basic_info");
  });

  it("pointercancel 清理：transform 复位，后续移动不再改顺序", () => {
    stubSectionRects();
    render(<Harness />);

    dragTo("projects", 410, 430);
    expect(currentOrder()[3]).toBe("projects");
    const orderAtDrag = [...currentOrder()];

    fireEvent.pointerCancel(document, { clientX: 10, clientY: 470, pointerId: 1 });
    const dragged = document.querySelector<HTMLElement>('[data-profile-section-key="projects"]');
    expect(dragged?.style.transform).toBe("");

    // 取消后指针再动：没有激活的拖拽，顺序冻结。
    fireEvent.pointerMove(document, { clientX: 10, clientY: 200, pointerId: 1 });
    expect(currentOrder()).toEqual(orderAtDrag);
  });

  it("重置（取消编辑回滚）恢复传入顺序", () => {
    stubSectionRects();
    render(<Harness />);

    dragTo("projects", 410, 430);
    fireEvent.pointerUp(document, { clientX: 10, clientY: 430, pointerId: 1 });
    expect(currentOrder()[2]).toBe("skills");

    fireEvent.click(screen.getByLabelText("重置projects"));
    expect(currentOrder()).toEqual(DEFAULT_SECTION_ORDER);
  });

  it("编辑态门控：非编辑态下 pointerdown 不进入排序、不响应拖动", () => {
    stubSectionRects();
    render(<Harness editing={false} />);

    dragTo("projects", 410, 430);
    expect(currentOrder()).toEqual(DEFAULT_SECTION_ORDER);
    const dragged = document.querySelector<HTMLElement>('[data-profile-section-key="projects"]');
    expect(dragged?.style.transform).toBe("");
  });
});

describe("draggedLayoutShift（实时重排的布局位移补偿，纯计算）", () => {
  // heights=[100, 80, 60, 40]、gap=10 时各位置的盒子 top：
  // 0→0、1→110、2→200、3→270（前 index 个「高度+gap」之和）。
  const heights = [100, 80, 60, 40];
  const gap = 10;

  it("向下移动：盒子布局位置下移，位移为正（transform 需减去它）", () => {
    // 从第 3 位（top 200）挪到第 4 位：新前缀不含被拖项自身（60+10），
    // top = (100+10)+(80+10)+(40+10) = 250。
    expect(draggedLayoutShift(heights, gap, 2, 3)).toBe(50);
  });

  it("向上移动：盒子布局位置上移，位移为负", () => {
    // 从第 4 位（top 270）挪到第 2 位（top 110）。
    expect(draggedLayoutShift(heights, gap, 3, 1)).toBe(-160);
  });

  it("跨多位移动：位移是新旧两个前缀和之差，与路径无关", () => {
    // 从第 1 位（top 0）挪到第 4 位：新前缀不含自身（100+10），
    // top = (80+10)+(60+10)+(40+10) = 210。
    expect(draggedLayoutShift(heights, gap, 0, 3)).toBe(210);
  });

  it("目标与来源相同：位移为 0（不产生补偿）", () => {
    expect(draggedLayoutShift(heights, gap, 1, 1)).toBe(0);
  });

  it("gap=0：位移退化为纯高度前缀和之差", () => {
    // top: 0→0、2→180；2→1 即 100-180=-80。
    expect(draggedLayoutShift([100, 80, 60], 0, 2, 1)).toBe(-80);
  });

  it("索引越界：返回 0（防御性，不产生错误补偿）", () => {
    expect(draggedLayoutShift(heights, gap, -1, 2)).toBe(0);
    expect(draggedLayoutShift(heights, gap, 2, 4)).toBe(0);
    expect(draggedLayoutShift([], gap, 0, 0)).toBe(0);
  });
});
