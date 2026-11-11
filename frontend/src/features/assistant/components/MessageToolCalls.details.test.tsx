// SPDX-License-Identifier: Apache-2.0
/** Tool card details (#13C arguments / #13D diff + undo): render, confirm wording, success and rollback. */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantToolCall } from "../../../types";
import { t } from "../../../i18n";

const restoreVersion = vi.fn();
vi.mock("../../resume-versions/versionsApi", () => ({
  restoreVersion: (...args: unknown[]) => restoreVersion(...args),
}));

import { MessageToolCalls } from "./MessageToolCalls";

function call(overrides: Partial<AssistantToolCall> = {}): AssistantToolCall {
  return {
    name: "update_resume_field",
    arguments: { resume_id: 3, path: "education.ob_en_1.ob_it_2", value: "3.9/4.0" },
    args_preview: [{ key: "resume_id", value: "3" }, { key: "path" }, { key: "value" }],
    preview: {
      before: "3.8/4.0",
      after: "3.9/4.0",
      version_id: 12,
      undo_text: "Assistant snapshot before edit",
      resume_id: 3,
      revision: 9,
    },
    summary: "Updated the GPA of the resume",
    link: "/resumes",
    ok: true,
    error: "",
    changed: true,
    ...overrides,
  };
}

function renderCalls(calls: AssistantToolCall[]) {
  return render(
    <AntdApp>
      <MessageToolCalls calls={calls} />
    </AntdApp>,
  );
}

async function expandPanel() {
  const header = t("toolCalls.header", { count: 1 }).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  fireEvent.click(screen.getByRole("button", { name: new RegExp(header) }));
  await screen.findByText(t("assistantUi.toolCalls.args"));
}

/** Icon aria-labels prefix the accessible name, so match the translated text as a regex. */
function buttonName(key: Parameters<typeof t>[0]) {
  return new RegExp(t(key));
}

beforeEach(() => {
  restoreVersion.mockReset();
  restoreVersion.mockResolvedValue({});
});

afterEach(() => {
  cleanup();
});

describe("tool card details", () => {
  it("renders the whitelisted arguments and hides non-whitelisted values", async () => {
    renderCalls([call()]);
    await expandPanel();
    expect(screen.getByText("resume_id")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    // path is internal locating info (contains object ids): name only, never the value.
    expect(screen.getByText("path")).toBeTruthy();
    expect(screen.queryByText(/ob_en_1/)).toBeNull();
    expect(screen.getByText("value")).toBeTruthy();
  });

  it("shows the no-public-arguments hint instead of an empty table", async () => {
    renderCalls([call({ args_preview: [{ key: "path" }, { key: "value" }], preview: null })]);
    await expandPanel();
    expect(screen.getByText(t("assistantUi.toolCalls.noPublicArgs"))).toBeTruthy();
  });

  it("shows old -> new values and the undo entry for document writes", async () => {
    renderCalls([call()]);
    await expandPanel();
    expect(screen.getByText(t("assistantUi.toolCalls.diffBefore"))).toBeTruthy();
    expect(screen.getByText(t("assistantUi.toolCalls.diffAfter"))).toBeTruthy();
    expect(screen.getByText("3.8/4.0")).toBeTruthy();
    expect(screen.getByText("3.9/4.0")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: buttonName("assistantUi.toolCalls.undo") }),
    ).toBeTruthy();
  });

  it("confirm wording states the whole resume is restored; success marks it undone", async () => {
    renderCalls([call()]);
    await expandPanel();
    fireEvent.click(screen.getByRole("button", { name: buttonName("assistantUi.toolCalls.undo") }));
    // The semantics must be explicit: restore the whole resume, not just this field.
    expect(
      await screen.findByText(t("assistantUi.toolCalls.undoConfirmContent", { version: 12 })),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: t("assistantUi.toolCalls.undoConfirmOk") }));
    await waitFor(() => expect(restoreVersion).toHaveBeenCalledWith(3, 12, 9));
    expect(
      (await screen.findAllByText(t("assistantUi.toolCalls.undoDone"))).length,
    ).toBeGreaterThan(0);
  });

  it("rolls the card state back and reports the error when restore fails", async () => {
    restoreVersion.mockRejectedValue(new Error("version deleted"));
    renderCalls([call()]);
    await expandPanel();
    fireEvent.click(screen.getByRole("button", { name: buttonName("assistantUi.toolCalls.undo") }));
    fireEvent.click(
      await screen.findByRole("button", { name: t("assistantUi.toolCalls.undoConfirmOk") }),
    );
    expect(await screen.findByText("version deleted")).toBeTruthy();
    // Back to the undoable state (not stuck on "undoing", not pretending it worked).
    expect(
      screen.getByRole("button", { name: buttonName("assistantUi.toolCalls.undo") }),
    ).toBeTruthy();
    expect(screen.queryByText(t("assistantUi.toolCalls.undoDone"))).toBeNull();
  });

  it("marks other write tools as not undoable", async () => {
    renderCalls([
      call({ name: "update_profile", preview: null, args_preview: [], summary: "Updated profile" }),
    ]);
    await expandPanel();
    expect(screen.getByText(t("assistantUi.toolCalls.undoUnsupported"))).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: buttonName("assistantUi.toolCalls.undo") }),
    ).toBeNull();
  });
});
