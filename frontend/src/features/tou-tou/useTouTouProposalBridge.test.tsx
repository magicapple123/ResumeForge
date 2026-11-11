// SPDX-License-Identifier: Apache-2.0
/**
 * 写操作 → 投投提案卡的订阅桥（#27F × #13D）：只按公开 store 出口订阅，不碰 w1 文件。
 * 用假 adapter 直接驱动，不需要真的发流。
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { AssistantToolCall } from "../../types";
import { getTouTouProposal, resetTouTouProposal, clearTouTouProposal } from "./touTouProposalStore";
import {
  useTouTouProposalBridge,
  type TouTouProposalStreamAdapter,
} from "./useTouTouProposalBridge";

const PREVIEW = {
  before: "负责后端开发",
  after: "用 Go 重构订单服务",
  version_id: 7,
  undo_text: "整份简历恢复到版本「助手修改前」",
  resume_id: 3,
  revision: 12,
};

function executedCall(versionId = 7): AssistantToolCall {
  return {
    name: "update_resume_field",
    arguments: {},
    summary: "改了一段经历",
    link: "",
    ok: true,
    error: "",
    preview: { ...PREVIEW, version_id: versionId },
  };
}

function fakeAdapter(initial: AssistantToolCall[] = []) {
  let tools: AssistantToolCall[] = initial;
  const listeners = new Set<() => void>();
  const adapter: TouTouProposalStreamAdapter = {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getTools: () => tools,
  };
  return {
    adapter,
    push(next: AssistantToolCall[]) {
      tools = next;
      for (const listener of Array.from(listeners)) listener();
    },
    listenerCount: () => listeners.size,
  };
}

afterEach(() => {
  resetTouTouProposal();
});

describe("useTouTouProposalBridge", () => {
  it("工具结果到达 → 出提案卡（已执行态、带撤销）", () => {
    const fake = fakeAdapter([executedCall()]);
    renderHook(() => useTouTouProposalBridge(fake.adapter));

    const proposal = getTouTouProposal();
    expect(proposal).not.toBeNull();
    expect(proposal).toMatchObject({
      initialStatus: "applied",
      versionId: 7,
      before: PREVIEW.before,
      after: PREVIEW.after,
    });
    expect(typeof proposal?.undo).toBe("function");
  });

  it("同一条写操作重复通知只出一次卡（用户关掉后不会又被 delta 弹出来）", () => {
    const fake = fakeAdapter();
    renderHook(() => useTouTouProposalBridge(fake.adapter));

    act(() => fake.push([executedCall()]));
    expect(getTouTouProposal()?.id).toContain("tt-executed");
    clearTouTouProposal();
    // 同一个版本再通知一次：已经见过了，不重新提案。
    act(() => fake.push([executedCall()]));
    expect(getTouTouProposal()).toBeNull();
    // 新版本 → 新卡。
    act(() => fake.push([executedCall(8)]));
    expect(getTouTouProposal()?.versionId).toBe(8);
  });

  it("失败的写操作不提案；多个新写操作按出现顺序最后一次生效", () => {
    const fake = fakeAdapter();
    renderHook(() => useTouTouProposalBridge(fake.adapter));

    act(() => fake.push([{ ...executedCall(), ok: false }]));
    expect(getTouTouProposal()).toBeNull();

    act(() => fake.push([executedCall(7), executedCall(9)]));
    expect(getTouTouProposal()?.versionId).toBe(9);
  });

  it("卸载后取消订阅（不会在离开页面后继续弹卡）", () => {
    const fake = fakeAdapter();
    const view = renderHook(() => useTouTouProposalBridge(fake.adapter));
    expect(fake.listenerCount()).toBe(1);
    view.unmount();
    expect(fake.listenerCount()).toBe(0);
  });
});
