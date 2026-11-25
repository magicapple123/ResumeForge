// SPDX-License-Identifier: Apache-2.0
/** 桌面系统通知的点击回执（CR-24）：主进程恢复窗口后，渲染层按 deep_link 跳转。 */
import { App as AntdApp } from "antd";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerTaskNavigate } from "../../utils/taskNotify";
import NotifyHostBridge from "./NotifyHostBridge";

vi.mock("../../utils/backgroundTasks", () => ({
  restoreBackgroundTasks: vi.fn().mockResolvedValue(undefined),
}));

type ClickListener = (deepLink: string | null) => void;

afterEach(() => {
  cleanup();
  registerTaskNavigate(null);
  delete (window as unknown as { resumeForge?: unknown }).resumeForge;
});

describe("NotifyHostBridge", () => {
  it("订阅 notify:click，按 deep_link 跳转；空链接不跳；卸载时退订", async () => {
    const bridge: { fire: ClickListener | null } = { fire: null };
    const unsubscribe = vi.fn();
    (window as unknown as { resumeForge?: unknown }).resumeForge = {
      onNotifyClick: (listener: ClickListener) => {
        bridge.fire = listener;
        return unsubscribe;
      },
    };
    const navigate = vi.fn();
    registerTaskNavigate(navigate);

    const { unmount } = render(
      <AntdApp>
        <NotifyHostBridge />
      </AntdApp>,
    );
    await waitFor(() => expect(bridge.fire).not.toBeNull());

    bridge.fire?.("/resumes?resume_id=42");
    expect(navigate).toHaveBeenCalledWith("/resumes?resume_id=42");
    bridge.fire?.(null);
    expect(navigate).toHaveBeenCalledTimes(1);

    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
