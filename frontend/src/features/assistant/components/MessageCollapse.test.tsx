// SPDX-License-Identifier: Apache-2.0
/** MessageCollapse (#13B): >480px collapses, expands, assistant-only. */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import MessageCollapse from "./MessageCollapse";

const LONG_TEXT = "This is a very long answer line.\n".repeat(120);

/** Locale-agnostic name matcher: the label is translated, the line count is dynamic. */
function expandName() {
  return new RegExp(t("assistantUi.collapse.expand").split("{lines}")[0]);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mockScrollHeight(value: number) {
  // jsdom does no layout: scrollHeight is always 0, so the measured height must be mocked.
  return vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(value);
}

describe("MessageCollapse", () => {
  it("collapses above the threshold and removes the limit after expanding", () => {
    mockScrollHeight(900);
    render(
      <MessageCollapse enabled content={LONG_TEXT}>
        <p>first conclusion</p>
        <p>last detail</p>
      </MessageCollapse>,
    );
    // (900 - 480) / 24 (default line height) = 17.5 -> 18 lines.
    const expand = screen.getByRole("button", { name: expandName() });
    expect(expand.getAttribute("aria-expanded")).toBe("false");
    expect(expand.textContent).toContain(t("assistantUi.collapse.expand", { lines: 18 }));
    // Collapsing is display-only: the content and the toggle both remain.
    expect(screen.getByText("last detail")).toBeTruthy();

    fireEvent.click(expand);
    const collapse = screen.getByRole("button", {
      name: new RegExp(t("assistantUi.collapse.collapse")),
    });
    expect(collapse.getAttribute("aria-expanded")).toBe("true");
  });

  it("renders no collapse entry under the threshold", () => {
    mockScrollHeight(400);
    render(
      <MessageCollapse enabled content="short answer">
        <p>short answer</p>
      </MessageCollapse>,
    );
    expect(screen.queryByRole("button", { name: expandName() })).toBeNull();
    expect(screen.getByText("short answer")).toBeTruthy();
  });

  it("never collapses non-assistant messages (enabled=false ignores tall content)", () => {
    mockScrollHeight(2000);
    render(
      <MessageCollapse enabled={false} content={LONG_TEXT}>
        <p>user message</p>
      </MessageCollapse>,
    );
    expect(screen.queryByRole("button", { name: expandName() })).toBeNull();
  });
});
