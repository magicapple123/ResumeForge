// SPDX-License-Identifier: Apache-2.0
/**
 * 资料分区排序的**焦点收尾**（R10）：换位后焦点必须回到被移动的那个分区。
 *
 * 从 `useProfileSectionReorder.test.tsx` 拆出（行数预算），共用脚手架在同目录
 * `profileReorderHarness.testkit.tsx`。用例名、注释与断言原样搬迁。
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  captureAnimationFrames,
  currentOrder,
  drainAnimationFrames,
  Harness,
  resetReorderTestState,
  stubSectionRects,
} from "./profileReorderHarness.testkit";

afterEach(() => {
  resetReorderTestState();
});

describe("useProfileSectionReorder 焦点收尾（R10）", () => {
  it("换位后焦点回到被移动的分区（优先把手），不落到会 disabled 的微调按钮上", () => {
    // R10：分区按 CSS order 摆放，换位后原来的焦点节点在 tab 序里的位置已经变了；
    // 不主动把焦点送回被移动的分区，键盘用户接着按方向键就会动到别人身上。
    stubSectionRects();
    const frames = captureAnimationFrames();
    render(<Harness />);

    fireEvent.click(screen.getByLabelText("上移projects"));
    const orderAfterMove = currentOrder();
    expect(orderAfterMove[1]).toBe("projects");

    // 焦点在下一帧落定（hook 用 rAF 等 DOM 的 order 生效）。
    drainAnimationFrames(frames);

    const moved = document.querySelector<HTMLElement>('[data-profile-section-key="projects"]');
    const handle = moved?.querySelector<HTMLElement>(".profile-section-drag-handle");
    expect(handle).not.toBeNull();
    expect(document.activeElement).toBe(handle);
    // 微调按钮越到边界越会 disabled —— 聚焦它们会让焦点掉回 body。
    expect(document.activeElement?.className).not.toContain("profile-section-nudge");
    // 焦点搬运不掺杂第二次 commit。
    expect(currentOrder()).toEqual(orderAfterMove);
  });

  it("没有把手的落点退到分区根节点（basic_info 之外的分区被清空把手时仍可继续操作）", () => {
    stubSectionRects();
    const frames = captureAnimationFrames();
    render(<Harness />);

    // 让被移动的分区暂时没有把手：模拟未来布局 / 无把手形态。
    const moved = document.querySelector<HTMLElement>('[data-profile-section-key="awards"]');
    moved?.querySelector(".profile-section-drag-handle")?.remove();

    fireEvent.click(screen.getByLabelText("上移awards"));
    drainAnimationFrames(frames);

    expect(document.activeElement).toBe(
      document.querySelector('[data-profile-section-key="awards"]'),
    );
  });
});
