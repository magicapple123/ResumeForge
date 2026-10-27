// SPDX-License-Identifier: Apache-2.0
/**
 * 「有未保存的修改」确认卡片（R-26 的出口）。
 *
 * 覆盖四件事，每一件都对应一个真实踩过的坑：
 * 1. **它必须真的弹出来**：此前是页面最顶部的一条内联 Alert，触发按钮在页头甚至页外，
 *    用户点了「取消编辑」只看到页面闪一下，以为按钮没反应；
 * 2. **两种离开方式的正文不同**（切方案 / 取消编辑会丢的东西不一样），但动作一样；
 * 3. **Esc 与 × 都等于「继续编辑」**：关闭这张卡片是无损动作，不能把内容丢掉；
 * 4. **默认焦点落在「继续编辑」**：手快连按两下 Enter 不该放弃修改。
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import ProfileLeaveConfirmModal from "./ProfileLeaveConfirmModal";

function renderModal(kind: "navigate" | "switch-group" | "cancel" | null = "cancel") {
  const onDiscard = vi.fn();
  const onKeep = vi.fn();
  render(<ProfileLeaveConfirmModal open kind={kind} onDiscard={onDiscard} onKeep={onKeep} />);
  return { onDiscard, onKeep };
}

function keepButton(): HTMLElement {
  return screen.getByRole("button", { name: t("profileGroups.leave.keep") });
}

function discardButton(): HTMLElement {
  return screen.getByRole("button", { name: t("profileGroups.leave.discard") });
}

afterEach(() => {
  // 必须真的 unmount：Esc 由 Portal 的全局栈处理，只清 DOM 会留下已关闭实例，
  // 之后的 keydown 只会派给栈顶那个（top: true），本用例就收不到回调。
  cleanup();
  document.body.innerHTML = "";
});

describe("ProfileLeaveConfirmModal", () => {
  it("弹层出现，标题与两个动作都在", () => {
    renderModal();
    expect(screen.getByText(t("profileGroups.leave.title"))).toBeInTheDocument();
    expect(keepButton()).toBeEnabled();
    expect(discardButton()).toBeEnabled();
  });

  it("正文随离开方式变化（三种分支各有自己的文案）", () => {
    const cases = [
      ["switch-group", "profileGroups.leave.body.switchGroup"],
      ["navigate", "profileGroups.leave.body.navigate"],
      ["cancel", "profileGroups.leave.body.cancel"],
    ] as const;
    for (const [kind, key] of cases) {
      const view = render(
        <ProfileLeaveConfirmModal open kind={kind} onDiscard={vi.fn()} onKeep={vi.fn()} />,
      );
      expect(screen.getByText(t(key))).toBeInTheDocument();
      view.unmount();
    }
  });

  it("「放弃修改」执行挂起的动作，「继续编辑」只是留在本页", () => {
    const { onDiscard, onKeep } = renderModal();
    fireEvent.click(keepButton());
    expect(onKeep).toHaveBeenCalledTimes(1);
    expect(onDiscard).not.toHaveBeenCalled();

    fireEvent.click(discardButton());
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it("Esc 与「继续编辑」同义：不丢内容", () => {
    const { onDiscard, onKeep } = renderModal();
    // Esc 由 Portal 的**全局** keydown 监听处理（@rc-component/portal/useEscKeyDown），
    // 所以事件源是 window，不是弹层节点本身。
    fireEvent.keyDown(window, { key: "Escape", keyCode: 27 });
    expect(onKeep).toHaveBeenCalledTimes(1);
    expect(onDiscard).not.toHaveBeenCalled();
  });

  it("蒙层不可关闭：点空白不会走到任何一支动作", () => {
    const { onDiscard, onKeep } = renderModal();
    const wrap = document.querySelector(".ant-modal-wrap");
    if (!wrap) throw new Error("modal wrap not found");
    fireEvent.mouseDown(wrap);
    fireEvent.click(wrap);
    expect(onDiscard).not.toHaveBeenCalled();
    expect(onKeep).not.toHaveBeenCalled();
  });

  it("默认焦点落在安全项（继续编辑）上", async () => {
    renderModal();
    await waitFor(() => expect(document.activeElement).toBe(keepButton()));
  });
});
