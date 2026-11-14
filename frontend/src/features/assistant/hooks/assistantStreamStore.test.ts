// SPDX-License-Identifier: Apache-2.0
/**
 * 发送请求体里的两轴权限（T11）：四档解算发生在 store 里。
 *
 * 硬约束：请求体**永远**发送解算后的 relaxed_mode / allow_write 两个布尔，不发 undefined、
 * 也不发 "follow" 中间态。跟随全局时用全局默认解算；有会话覆盖时直接用覆盖值。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const assistantApiMocks = vi.hoisted(() => ({ sendAssistantMessage: vi.fn() }));
const permissionApiMocks = vi.hoisted(() => ({
  getAssistantPermission: vi.fn(),
  saveAssistantPermission: vi.fn(),
}));

vi.mock("../../../api/assistant", () => assistantApiMocks);
vi.mock("../../../api/assistantPermission", () => permissionApiMocks);

import {
  resetAssistantStreamForTests,
  sendAssistantStreamMessage,
  type SendAssistantStreamOptions,
} from "./assistantStreamStore";
import { permissionStorageKey, resetAssistantPermissionForTests } from "../assistantPermission";
import {
  clearConversationContext,
  getConversationContextState,
  setConversationThreshold,
} from "../conversationContextState";

const CONVERSATION_ID = 7;

function sendOptions(
  overrides: Partial<SendAssistantStreamOptions> = {},
): SendAssistantStreamOptions {
  return {
    activeIdRef: { current: CONVERSATION_ID },
    reloadConversations: vi.fn().mockResolvedValue(undefined),
    loadDetail: vi.fn().mockResolvedValue(undefined),
    createConversation: vi.fn().mockResolvedValue(99),
    clearAttachments: vi.fn(),
    attachmentReadsRef: { current: 0 },
    attachmentsRef: { current: [] },
    setTouTouStatus: vi.fn(),
    jobId: undefined,
    resumeId: undefined,
    webSearch: false,
    reasoningEffort: "",
    surface: "page",
    quotedMessageId: null,
    clearQuote: vi.fn(),
    ...overrides,
  };
}

/** 跑一次发送并取出请求体。 */
async function sendAndGetPayload(
  overrides: Partial<SendAssistantStreamOptions> = {},
): Promise<Record<string, unknown>> {
  await sendAssistantStreamMessage("你好", vi.fn(), sendOptions(overrides));
  expect(assistantApiMocks.sendAssistantMessage).toHaveBeenCalledTimes(1);
  return assistantApiMocks.sendAssistantMessage.mock.calls[0][1] as Record<string, unknown>;
}

beforeEach(() => {
  clearConversationContext(CONVERSATION_ID);
  resetAssistantStreamForTests();
  resetAssistantPermissionForTests();
  window.localStorage.clear();
  assistantApiMocks.sendAssistantMessage.mockReset();
  assistantApiMocks.sendAssistantMessage.mockResolvedValue(undefined);
  permissionApiMocks.getAssistantPermission.mockReset();
  permissionApiMocks.getAssistantPermission.mockResolvedValue({ permission: "read_only" });
  permissionApiMocks.saveAssistantPermission.mockReset();
});

afterEach(() => {
  clearConversationContext(CONVERSATION_ID);
  resetAssistantStreamForTests();
  resetAssistantPermissionForTests();
  window.localStorage.clear();
});

describe("请求体两轴（四档解算）", () => {
  it("会话覆盖为「完全权限」：relaxed_mode=true 且 allow_write=true，不请求全局", async () => {
    window.localStorage.setItem(permissionStorageKey(CONVERSATION_ID), "write_full");

    const payload = await sendAndGetPayload();

    expect(payload.relaxed_mode).toBe(true);
    expect(payload.allow_write).toBe(true);
    expect(permissionApiMocks.getAssistantPermission).not.toHaveBeenCalled();
  });

  it.each([
    ["read_only", false, false],
    ["read_full", true, false],
    ["write_confirm", false, true],
    ["write_full", true, true],
  ] as const)("会话覆盖为 %s：请求体两轴分别为 %s / %s", async (level, relaxed, allowWrite) => {
    window.localStorage.setItem(permissionStorageKey(CONVERSATION_ID), level);

    const payload = await sendAndGetPayload();

    expect(payload.relaxed_mode).toBe(relaxed);
    expect(payload.allow_write).toBe(allowWrite);
  });

  it("跟随全局：用全局默认档位解算（且两个值都是布尔，不是 follow）", async () => {
    permissionApiMocks.getAssistantPermission.mockResolvedValue({
      permission: "write_confirm",
    });

    const payload = await sendAndGetPayload();

    expect(payload.relaxed_mode).toBe(false);
    expect(payload.allow_write).toBe(true);
    expect(typeof payload.relaxed_mode).toBe("boolean");
    expect(typeof payload.allow_write).toBe("boolean");
  });

  it("取不到全局设置时按「仅查看」发送（保守），请求仍然发出", async () => {
    permissionApiMocks.getAssistantPermission.mockRejectedValue(new Error("offline"));

    const payload = await sendAndGetPayload();

    expect(payload.relaxed_mode).toBe(false);
    expect(payload.allow_write).toBe(false);
  });

  it("新会话先建会话再解算：用新会话 id 读覆盖值", async () => {
    window.localStorage.setItem(permissionStorageKey(12), "read_full");
    const options = sendOptions({
      activeIdRef: { current: null },
      createConversation: vi.fn().mockResolvedValue(12),
    });

    await sendAssistantStreamMessage("你好", vi.fn(), options);

    const call = assistantApiMocks.sendAssistantMessage.mock.calls[0];
    expect(call[0]).toBe(12);
    expect(call[1].relaxed_mode).toBe(true);
    expect(call[1].allow_write).toBe(false);
  });
});

describe("transient context request wiring", () => {
  it("sends A's threshold and leaves B on the global default", async () => {
    setConversationThreshold(CONVERSATION_ID, 200_000);
    const payload = await sendAndGetPayload();
    expect(payload.compaction_threshold_tokens).toBe(200_000);
    assistantApiMocks.sendAssistantMessage.mockClear();
    const other = await sendAndGetPayload({ activeIdRef: { current: 8 } });
    expect(other.compaction_threshold_tokens).toBeNull();
  });

  it("records typed SSE context errors and resets the counter after success", async () => {
    assistantApiMocks.sendAssistantMessage.mockImplementation(async (_id, _payload, onEvent) => {
      onEvent({ type: "error", code: "context_length", message: "context too long" });
    });
    await sendAssistantStreamMessage("first", vi.fn(), sendOptions());
    await sendAssistantStreamMessage("second", vi.fn(), sendOptions());
    expect(getConversationContextState(CONVERSATION_ID).contextErrors).toBe(2);
    assistantApiMocks.sendAssistantMessage.mockImplementation(async (_id, _payload, onEvent) => {
      onEvent({ type: "done" });
    });
    await sendAssistantStreamMessage("retry", vi.fn(), sendOptions());
    expect(getConversationContextState(CONVERSATION_ID).contextErrors).toBe(0);
  });

  it("a transport failure breaks the consecutive provider-error sequence", async () => {
    assistantApiMocks.sendAssistantMessage.mockImplementationOnce(
      async (_id, _payload, onEvent) => {
        onEvent({ type: "error", code: "context_length", message: "context too long" });
      },
    );
    await sendAssistantStreamMessage("first", vi.fn(), sendOptions());
    assistantApiMocks.sendAssistantMessage.mockRejectedValueOnce(new Error("network unavailable"));
    await sendAssistantStreamMessage("second", vi.fn(), sendOptions());
    expect(getConversationContextState(CONVERSATION_ID).contextErrors).toBe(0);
  });
});
