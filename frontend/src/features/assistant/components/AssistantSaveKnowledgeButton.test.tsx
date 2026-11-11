// SPDX-License-Identifier: Apache-2.0
/** AssistantSaveKnowledgeButton (#29B): prefill, category, success link/toast, failure path. */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantMessage } from "../../../types";
import { KNOWLEDGE_CATEGORIES } from "../../../types";
import { t } from "../../../i18n";

const createKnowledge = vi.fn();
vi.mock("../../../api/knowledge", () => ({
  createKnowledge: (...args: unknown[]) => createKnowledge(...args),
}));

import AssistantSaveKnowledgeButton from "./AssistantSaveKnowledgeButton";

const FIRST_LINE = "First line conclusion";

function message(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    id: 11,
    conversation_id: 3,
    role: "assistant",
    content: `${FIRST_LINE}\n\nBody detail line one.\nBody detail line two.`,
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

function renderButton(target: AssistantMessage = message()) {
  return render(
    <AntdApp>
      <AssistantSaveKnowledgeButton message={target} />
    </AntdApp>,
  );
}

function name(key: Parameters<typeof t>[0]) {
  return new RegExp(t(key));
}

async function openModal() {
  fireEvent.click(screen.getByRole("button", { name: name("assistantUi.saveKnowledge.button") }));
  // findByText would match both the trigger button and the modal title; wait on the dialog.
  return screen.findByRole("dialog");
}

beforeEach(() => {
  createKnowledge.mockReset();
  createKnowledge.mockResolvedValue({ id: 21, title: FIRST_LINE });
});

afterEach(() => {
  cleanup();
});

describe("AssistantSaveKnowledgeButton", () => {
  it("prefills the title from the first line and saves the full Markdown body", async () => {
    renderButton();
    await openModal();
    const titleInput = screen.getByRole("textbox", {
      name: t("assistantUi.saveKnowledge.titleLabel"),
    });
    expect((titleInput as HTMLInputElement).value).toBe(FIRST_LINE);
    fireEvent.change(titleInput, { target: { value: "Edited title" } });
    fireEvent.click(screen.getByRole("button", { name: t("assistantUi.saveKnowledge.save") }));
    await waitFor(() => expect(createKnowledge).toHaveBeenCalledTimes(1));
    expect(createKnowledge).toHaveBeenCalledWith({
      title: "Edited title",
      category: "",
      tags: [],
      content: message().content,
      source: t("assistantUi.saveKnowledge.source"),
    });
    // Success: toast names the object and the button becomes a saved link.
    expect(
      await screen.findByText(t("assistantUi.saveKnowledge.toast", { title: FIRST_LINE })),
    ).toBeTruthy();
    const link = screen.getByRole("link", {
      name: t("assistantUi.saveKnowledge.saved", { title: FIRST_LINE }),
    });
    expect(link.getAttribute("href")).toBe(`/knowledge?q=${encodeURIComponent(FIRST_LINE)}`);
  });

  it("can save into the interview-notes category (protocol value from types)", async () => {
    renderButton();
    await openModal();
    fireEvent.mouseDown(
      screen.getByRole("combobox", { name: t("assistantUi.saveKnowledge.categoryLabel") }),
    );
    // The selected value and the dropdown option share the same label: click the last match.
    const options = await screen.findAllByText(
      t("enumsKnowledge.category.knowledge.interviewNotes"),
    );
    fireEvent.click(options[options.length - 1]);
    fireEvent.click(screen.getByRole("button", { name: t("assistantUi.saveKnowledge.save") }));
    await waitFor(() => expect(createKnowledge).toHaveBeenCalledTimes(1));
    expect(createKnowledge.mock.calls[0][0]).toMatchObject({ category: KNOWLEDGE_CATEGORIES[0] });
  });

  it("reports where to go when saving fails and keeps the button usable", async () => {
    createKnowledge.mockRejectedValue(new Error("backend down"));
    renderButton();
    await openModal();
    fireEvent.click(screen.getByRole("button", { name: t("assistantUi.saveKnowledge.save") }));
    expect(
      await screen.findByText(t("assistantUi.saveKnowledge.failed", { error: "backend down" })),
    ).toBeTruthy();
    // The modal stays open for a retry decision, and the entry button is still there after closing.
    // Ant Design inserts a space between two CJK characters in a button label; match loosely.
    const cancelName = new RegExp(t("common.action.cancel").split("").join("\\s*"));
    fireEvent.click(screen.getByRole("button", { name: cancelName }));
    expect(
      screen.getByRole("button", { name: name("assistantUi.saveKnowledge.button") }),
    ).toBeTruthy();
  });

  it("cannot submit an empty title", async () => {
    renderButton();
    await openModal();
    const titleInput = screen.getByRole("textbox", {
      name: t("assistantUi.saveKnowledge.titleLabel"),
    });
    fireEvent.change(titleInput, { target: { value: "   " } });
    expect(
      screen.getByRole("button", { name: t("assistantUi.saveKnowledge.save") }),
    ).toBeDisabled();
  });
});
