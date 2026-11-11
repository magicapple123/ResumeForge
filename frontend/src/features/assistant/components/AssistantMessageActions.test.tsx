// SPDX-License-Identifier: Apache-2.0
/** AssistantMessageActions (#13A): copy full text + clipboard fallback, regenerate visibility, delete confirm. */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssistantMessage } from "../../../types";
import { t } from "../../../i18n";
import AssistantMessageActions from "./AssistantMessageActions";

function message(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    id: 7,
    conversation_id: 1,
    role: "assistant",
    // Much longer than the collapse threshold: copy must use the full body.
    content: `Conclusion: rewrite the projects first.\n${"detail ".repeat(400)}`,
    quoted_message_id: null,
    attachments: [],
    context: {},
    status: "complete",
    error: "",
    model: "test-model",
    created_at: "2026-08-20T10:00:00",
    ...overrides,
  };
}

const onQuote = vi.fn();
const onDelete = vi.fn();
const onRegenerate = vi.fn();

function renderActions(
  props: {
    showRegenerate?: boolean;
    regenerateDisabled?: boolean;
    overrides?: Partial<AssistantMessage>;
  } = {},
) {
  return render(
    <AntdApp>
      <AssistantMessageActions
        message={message(props.overrides)}
        showRegenerate={props.showRegenerate ?? false}
        regenerateDisabled={props.regenerateDisabled ?? false}
        onQuote={onQuote}
        onDelete={onDelete}
        onRegenerate={onRegenerate}
      />
    </AntdApp>,
  );
}

/** Button names come from the language pack; icons add their own aria-label prefix. */
function buttonName(key: Parameters<typeof t>[0]) {
  return new RegExp(t(key));
}

function mockClipboard(writeText: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  onQuote.mockReset();
  onDelete.mockReset();
  onRegenerate.mockReset();
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
});

describe("AssistantMessageActions", () => {
  it("copies the full body (not the collapsed visible part) and toasts success", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    mockClipboard(writeText);
    renderActions();
    fireEvent.click(
      screen.getByRole("button", { name: buttonName("assistantUi.messageActions.copy") }),
    );
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(message().content));
    expect(await screen.findByText(t("assistantUi.messageList.toast.copied"))).toBeTruthy();
  });

  it("falls back to execCommand when the Clipboard API fails", async () => {
    mockClipboard(vi.fn().mockRejectedValue(new Error("not allowed")));
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", { configurable: true, value: execCommand });
    renderActions();
    fireEvent.click(
      screen.getByRole("button", { name: buttonName("assistantUi.messageActions.copy") }),
    );
    await waitFor(() => expect(execCommand).toHaveBeenCalledWith("copy"));
    expect(await screen.findByText(t("assistantUi.messageList.toast.copied"))).toBeTruthy();
  });

  it("warns when both copy channels fail", async () => {
    mockClipboard(vi.fn().mockRejectedValue(new Error("not allowed")));
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: () => {
        throw new Error("execCommand unavailable");
      },
    });
    renderActions();
    fireEvent.click(
      screen.getByRole("button", { name: buttonName("assistantUi.messageActions.copy") }),
    );
    expect(await screen.findByText(t("assistantUi.messageList.toast.copyFailed"))).toBeTruthy();
  });

  it("shows regenerate only on the last assistant answer", () => {
    renderActions();
    expect(
      screen.queryByRole("button", { name: buttonName("assistantUi.messageActions.regenerate") }),
    ).toBeNull();
    cleanup();
    renderActions({ showRegenerate: true });
    expect(
      screen.getByRole("button", { name: buttonName("assistantUi.messageActions.regenerate") }),
    ).toBeTruthy();
  });

  it("disables regenerate while generating and never fires the callback", () => {
    renderActions({ showRegenerate: true, regenerateDisabled: true });
    const button = screen.getByRole("button", {
      name: buttonName("assistantUi.messageActions.regenerate"),
    });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onRegenerate).not.toHaveBeenCalled();
  });

  it("offers save-as-knowledge only for assistant answers", () => {
    renderActions();
    expect(
      screen.getByRole("button", { name: buttonName("assistantUi.saveKnowledge.button") }),
    ).toBeTruthy();
    cleanup();
    renderActions({ overrides: { role: "user", content: "a question" } });
    expect(
      screen.queryByRole("button", { name: buttonName("assistantUi.saveKnowledge.button") }),
    ).toBeNull();
  });

  it("quotes and deletes through existing callbacks; delete needs confirmation", async () => {
    renderActions();
    fireEvent.click(
      screen.getByRole("button", { name: buttonName("assistantUi.messageActions.quote") }),
    );
    expect(onQuote).toHaveBeenCalledWith(message());

    fireEvent.click(
      screen.getByRole("button", { name: buttonName("assistantUi.messageActions.delete") }),
    );
    const confirm = await screen.findByRole("button", {
      name: t("assistantUi.messageList.action.delete"),
    });
    fireEvent.click(confirm);
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(message()));
  });
});
