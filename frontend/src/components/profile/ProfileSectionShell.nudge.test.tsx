/**
 * 分区把手上移/下移微调按钮（SectionNudgeButtons）：
 * - 复用键盘排序路径（同一个 onMoveByOffset 回调），点击移动一位；
 * - `basic_info` 固定首位 → 第 1 个可拖分区的 ↑ 禁用，末位的 ↓ 禁用；
 * - 点击绝不进入拖拽态（不触发 onHandlePointerDown，无 is-dragging 残留）；
 * - 悬停/焦点可见性由 CSS（.profile-section-sortable:hover/:focus-within）驱动，
 *   jsdom 不计算外部样式表，这里断言类名钩子与 focusable 性，真机视觉由 QA 覆盖。
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SortableProfileSection } from "./ProfileSectionShell";
import { DEFAULT_SECTION_ORDER } from "./ProfileSectionConfig";
import type { ProfileSectionKey } from "./ProfileSectionConfig";

afterEach(() => {
  cleanup();
});

interface HarnessProps {
  order: ProfileSectionKey;
  editable?: boolean;
  onHandlePointerDown?: (
    event: ReactPointerEvent<HTMLButtonElement>,
    key: ProfileSectionKey,
  ) => void;
  onMoveByOffset?: (sectionKey: ProfileSectionKey, offset: -1 | 1) => void;
}

/** 单分区壳 + 可控顺序：默认序里 skills 是第 4 位（order 3），awards 是末位。 */
function NudgeHarness({
  order,
  editable = true,
  onHandlePointerDown,
  onMoveByOffset,
}: HarnessProps) {
  const [draggingKey] = useState<ProfileSectionKey | null>(null);
  const pointerDown =
    onHandlePointerDown ??
    vi.fn((event: ReactPointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
    });
  const move = onMoveByOffset ?? vi.fn();
  return (
    <SortableProfileSection
      sectionKey={order}
      order={DEFAULT_SECTION_ORDER.indexOf(order)}
      editable={editable}
      reordering={editable}
      dragging={draggingKey === order}
      collapsed={false}
      canMoveUp={DEFAULT_SECTION_ORDER.indexOf(order) > 1}
      canMoveDown={DEFAULT_SECTION_ORDER.indexOf(order) < DEFAULT_SECTION_ORDER.length - 1}
      onToggleCollapsed={vi.fn()}
      onHandlePointerDown={pointerDown}
      onMoveByOffset={move}
    >
      <div>{order} 内容</div>
    </SortableProfileSection>
  );
}

describe("分区微调按钮（上移/下移）", () => {
  it("编辑态渲染 ↑/↓ 两个按钮，带分区名的 aria-label；basic_info 不渲染", () => {
    render(<NudgeHarness order="skills" />);
    expect(screen.getByRole("button", { name: "上移专业技能" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下移专业技能" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上移专业技能" })).toHaveClass(
      "profile-section-nudge",
      "profile-section-nudge-up",
    );
    expect(screen.getByRole("button", { name: "下移专业技能" })).toHaveClass(
      "profile-section-nudge",
      "profile-section-nudge-down",
    );

    cleanup();
    render(<NudgeHarness order="basic_info" />);
    expect(screen.queryByRole("button", { name: "上移基本信息" })).toBeNull();
    expect(screen.queryByRole("button", { name: "下移基本信息" })).toBeNull();
  });

  it("查看态不渲染微调按钮", () => {
    render(<NudgeHarness order="skills" editable={false} />);
    expect(screen.queryByRole("button", { name: "上移专业技能" })).toBeNull();
    expect(screen.queryByRole("button", { name: "下移专业技能" })).toBeNull();
  });

  it("边界 disabled：第 1 个可拖分区的 ↑ 禁用，末位的 ↓ 禁用，中间两者可用", () => {
    // 默认序 experiences（order 1，basic_info 之后第一位）。
    const { unmount: unmountFirst } = render(<NudgeHarness order="experiences" />);
    expect(screen.getByRole("button", { name: "上移实习/工作经历" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "下移实习/工作经历" })).toBeEnabled();
    unmountFirst();

    // 末位 summary。
    const { unmount: unmountLast } = render(<NudgeHarness order="summary" />);
    expect(screen.getByRole("button", { name: "下移个人总结 / 自我评价" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "上移个人总结 / 自我评价" })).toBeEnabled();
    unmountLast();

    // 中间位两者都可用。
    render(<NudgeHarness order="skills" />);
    expect(screen.getByRole("button", { name: "上移专业技能" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "下移专业技能" })).toBeEnabled();
  });

  it("点击 ↑/↓ 各调用一次 onMoveByOffset(key, ∓1)——与键盘排序同一条路径", () => {
    const onMoveByOffset = vi.fn();
    render(<NudgeHarness order="skills" onMoveByOffset={onMoveByOffset} />);

    fireEvent.click(screen.getByRole("button", { name: "上移专业技能" }));
    expect(onMoveByOffset).toHaveBeenCalledWith("skills", -1);

    fireEvent.click(screen.getByRole("button", { name: "下移专业技能" }));
    expect(onMoveByOffset).toHaveBeenCalledWith("skills", 1);
    expect(onMoveByOffset).toHaveBeenCalledTimes(2);
  });

  it("点击不进入拖拽态：onHandlePointerDown 不被调用，无 is-dragging/transform 残留", () => {
    const onHandlePointerDown = vi.fn();
    render(<NudgeHarness order="skills" onHandlePointerDown={onHandlePointerDown} />);
    const section = document.querySelector<HTMLElement>('[data-profile-section-key="skills"]');
    expect(section).not.toBeNull();

    // pointerdown + click 完整走一遍（真实点击是先按下再抬起）。
    const up = screen.getByRole("button", { name: "上移专业技能" });
    fireEvent.pointerDown(up, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.click(up);
    fireEvent.pointerUp(up, { clientX: 10, clientY: 10, pointerId: 1 });

    expect(onHandlePointerDown).not.toHaveBeenCalled();
    expect(section?.classList.contains("is-dragging")).toBe(false);
    expect(section?.style.transform).toBe("");
  });

  it("微调按钮可聚焦（键盘可达），禁用位不在 Tab 序；可见性类钩子齐备", () => {
    const { unmount } = render(<NudgeHarness order="summary" />);
    const up = screen.getByRole("button", { name: "上移个人总结 / 自我评价" });
    const down = screen.getByRole("button", { name: "下移个人总结 / 自我评价" });
    // 可见性由 .profile-section-sortable:hover / :focus-within 驱动（profile.css），
    // jsdom 不算外部样式表，这里守住「按钮在分区内、类钩子正确」的 DOM 契约。
    expect(up.closest(".profile-section-sortable")).not.toBeNull();
    expect(up).toHaveClass("profile-section-nudge");
    // 可用按钮可聚焦；disabled 按钮聚焦无效（不进入 Tab 序）。
    up.focus();
    expect(document.activeElement).toBe(up);
    up.blur();
    down.focus(); // disabled：不会获得焦点
    expect(document.activeElement).not.toBe(down);
    unmount();
  });
});

describe("分区根节点的键盘换位与播报（R10）", () => {
  it("根节点可编程聚焦（tabIndex=-1），方向键在根上能继续换位", () => {
    // 移动后焦点若只落在把手，遇到边界（把手仍在）还好；但 basic_info 没有把手，
    // 以及将来把手被移除时，根节点必须是那个可聚焦的落点。
    const onMoveByOffset = vi.fn();
    render(<NudgeHarness order="skills" onMoveByOffset={onMoveByOffset} />);
    const root = document.querySelector<HTMLElement>('[data-profile-section-key="skills"]');
    expect(root).not.toBeNull();
    expect(root).toHaveAttribute("tabindex", "-1");

    root?.focus();
    expect(document.activeElement).toBe(root);

    fireEvent.keyDown(root as HTMLElement, { key: "ArrowDown" });
    expect(onMoveByOffset).toHaveBeenCalledWith("skills", 1);
    fireEvent.keyDown(root as HTMLElement, { key: "ArrowUp" });
    expect(onMoveByOffset).toHaveBeenCalledWith("skills", -1);
    expect(onMoveByOffset).toHaveBeenCalledTimes(2);
  });

  it("分区内容里的方向键不改顺序（只处理根节点自身的事件）", () => {
    // 回归防线：onKeyDown 挂在根节点上，若不判 target === currentTarget，那么在
    // 「个人总结」里按方向键移动光标就会把整个分区换位。
    const onMoveByOffset = vi.fn();
    render(<NudgeHarness order="skills" onMoveByOffset={onMoveByOffset} />);
    fireEvent.keyDown(screen.getByText("skills 内容"), { key: "ArrowDown" });
    expect(onMoveByOffset).not.toHaveBeenCalled();
  });

  it("根节点上的方向键不会与把手的处理重复触发（一次按键只换一位）", () => {
    const onMoveByOffset = vi.fn();
    render(<NudgeHarness order="skills" onMoveByOffset={onMoveByOffset} />);
    fireEvent.keyDown(screen.getByRole("button", { name: "拖动调整专业技能顺序" }), {
      key: "ArrowDown",
    });
    // 把手的 keydown 冒泡到根节点时被 target !== currentTarget 挡掉。
    expect(onMoveByOffset).toHaveBeenCalledTimes(1);
  });

  it("basic_info 不接受方向键换位", () => {
    const onMoveByOffset = vi.fn();
    render(<NudgeHarness order="basic_info" onMoveByOffset={onMoveByOffset} />);
    const root = document.querySelector<HTMLElement>('[data-profile-section-key="basic_info"]');
    fireEvent.keyDown(root as HTMLElement, { key: "ArrowDown" });
    expect(onMoveByOffset).not.toHaveBeenCalled();
  });

  it("aria-live 播报当前位次，并随 order 变化更新", () => {
    function OrderHarness({ orderIndex }: { orderIndex: number }) {
      return (
        <SortableProfileSection
          sectionKey="skills"
          order={orderIndex}
          editable
          reordering
          dragging={false}
          collapsed={false}
          canMoveUp={orderIndex > 1}
          canMoveDown
          onToggleCollapsed={vi.fn()}
          onHandlePointerDown={vi.fn()}
          onMoveByOffset={vi.fn()}
        >
          <div>内容</div>
        </SortableProfileSection>
      );
    }

    const { rerender } = render(<OrderHarness orderIndex={3} />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent("专业技能 已移到第 4 位");

    rerender(<OrderHarness orderIndex={1} />);
    expect(screen.getByRole("status")).toHaveTextContent("专业技能 已移到第 2 位");
  });
});
