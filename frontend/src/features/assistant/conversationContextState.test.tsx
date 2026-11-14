// SPDX-License-Identifier: Apache-2.0
/**
 * 对话级上下文状态（阈值 / 连续超限计数）只活在内存里：A 对话的设置不能漏到 B；
 * 离开再进入回到默认；只有**连续**的 context-length 失败才计数；清空覆盖后回到全局
 * 触发线；窗口变小时要把保留的绝对阈值夹回上限。
 *
 * 刻意不落 localStorage：这类「临时调整」一旦持久化，用户开新对话会被上一次的设置影响，
 * 而且很难归因。
 */
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const streamState = vi.hoisted(() => ({ contextUsage: null, contextUsageConversationId: null }));
vi.mock("../../api/assistant", () => ({
  getAssistantContextUsage: vi.fn().mockResolvedValue(null),
}));
vi.mock("./hooks/assistantStreamStore", () => ({
  getAssistantStreamState: () => streamState,
  subscribeAssistantStream: () => () => {},
}));

import { t } from "../../i18n";
import type { ContextUsage } from "../../types";
import CompactionThresholdControl from "./components/composer/CompactionThresholdControl";
import {
  clearConversationContext,
  getConversationContextState,
  recordContextResult,
  setConversationThreshold,
} from "./conversationContextState";
import { useAssistantContextUsage } from "./hooks/useAssistantContextUsage";

const usage: ContextUsage = {
  buckets: [],
  total: 1,
  window: 1_000_000,
  percent: 0,
  partial: false,
  usage_actual: null,
  trigger_tokens: 200_000,
  default_trigger_tokens: 750_000,
};

afterEach(() => {
  cleanup();
  clearConversationContext(1);
  clearConversationContext(2);
});

describe("transient conversation context", () => {
  it("isolates A's threshold from B without local/session storage", () => {
    const local = vi.spyOn(Storage.prototype, "setItem");
    setConversationThreshold(1, 200_000);
    expect(getConversationContextState(1).thresholdTokens).toBe(200_000);
    expect(getConversationContextState(2).thresholdTokens).toBeNull();
    expect(local).not.toHaveBeenCalled();
    local.mockRestore();
  });

  it("resets defaults when leaving and reopening a conversation", () => {
    const hook = renderHook(({ id }) => useAssistantContextUsage(id), { initialProps: { id: 1 } });
    act(() => setConversationThreshold(1, 200_000));
    hook.rerender({ id: 2 });
    expect(getConversationContextState(1).thresholdTokens).toBeNull();
    hook.rerender({ id: 1 });
    expect(getConversationContextState(1).thresholdTokens).toBeNull();
    act(() => setConversationThreshold(1, 10_000));
    hook.unmount();
    expect(getConversationContextState(1).thresholdTokens).toBeNull();
  });

  it("counts only consecutive context-length failures and resets on other results", () => {
    recordContextResult(1, "context_length");
    expect(getConversationContextState(1).contextErrors).toBe(1);
    recordContextResult(1, "context_length");
    expect(getConversationContextState(1).contextErrors).toBe(2);
    expect(getConversationContextState(2).contextErrors).toBe(0);
    recordContextResult(1, "other");
    expect(getConversationContextState(1).contextErrors).toBe(0);
    recordContextResult(1, "context_length");
    recordContextResult(1);
    expect(getConversationContextState(1).contextErrors).toBe(0);
  });

  it("shows the global trigger when clearing a threshold after a streamed override", () => {
    setConversationThreshold(1, 200_000);
    render(<CompactionThresholdControl usage={usage} conversationId={1} />);
    expect(
      screen.getByText(t("contextUsage.early.trigger", { trigger: "200.0K", percent: "20%" })),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "" } });
    expect(getConversationContextState(1).thresholdTokens).toBeNull();
    expect(
      screen.getByText(t("contextUsage.early.trigger", { trigger: "750.0K", percent: "75%" })),
    ).toBeInTheDocument();
  });

  it("clamps a retained absolute threshold after switching to a smaller window", () => {
    setConversationThreshold(1, 200_000);
    render(<CompactionThresholdControl usage={{ ...usage, window: 100_000 }} conversationId={1} />);
    expect(screen.getByRole("spinbutton")).toHaveValue("90000");
    expect(screen.getByRole("spinbutton")).toHaveAttribute("aria-valuemax", "90000");
    expect(
      screen.getByText(t("contextUsage.early.trigger", { trigger: "90.0K", percent: "90%" })),
    ).toBeInTheDocument();
  });
});
