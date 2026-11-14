// SPDX-License-Identifier: Apache-2.0
/**
 * F36 的页面级不变量：发送后 / 切换会话后，岗位与简历必须一起被丢掉。
 *
 * 这两条很容易只做一半（清了岗位忘了简历、发送清了切会话忘了清），而后果是
 * 「对话 A 的岗位跟着对话 B 的下一条消息发出去」——在界面上完全看不出来。
 */
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import {
  useAssistantContextSelection,
  useContextResetOnSwitch,
} from "./useAssistantContextSelection";

function wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

describe("assistant context selection (F36)", () => {
  it("reads the deep link on the first frame", () => {
    const { result } = renderHook(
      () => useAssistantContextSelection(new URLSearchParams("job_id=7&resume_id=9")),
      { wrapper },
    );
    expect(result.current.jobId).toBe(7);
    expect(result.current.resumeId).toBe(9);
  });

  it("ignores invalid ids instead of selecting #0", () => {
    const { result } = renderHook(
      () => useAssistantContextSelection(new URLSearchParams("job_id=abc")),
      { wrapper },
    );
    expect(result.current.jobId).toBeUndefined();
  });

  it("clears both selections together", () => {
    const { result } = renderHook(
      () => useAssistantContextSelection(new URLSearchParams("job_id=7&resume_id=9")),
      { wrapper },
    );
    act(() => result.current.clearContextRefs());
    expect(result.current.jobId).toBeUndefined();
    expect(result.current.resumeId).toBeUndefined();
  });

  it("clears before running the original sidebar action", () => {
    const order: string[] = [];
    const clear = vi.fn(() => order.push("clear"));
    const create = vi.fn(() => order.push("create"));
    const select = vi.fn(() => order.push("select"));

    const { result } = renderHook(() => useContextResetOnSwitch(clear, create, select));

    act(() => result.current.handleCreate());
    act(() => result.current.handleSelect(12));

    expect(order).toEqual(["clear", "create", "clear", "select"]);
    expect(select).toHaveBeenCalledWith(12);
  });
});
