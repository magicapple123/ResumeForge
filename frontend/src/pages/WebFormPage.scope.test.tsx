// SPDX-License-Identifier: Apache-2.0
/**
 * Web-form page: the data-range switch (`current plan only` vs `all data`).
 *
 * One choice, three consumers. The page state feeds the picker list and the batch
 * preview, localStorage remembers the habit for the next visit, and a running live
 * session lives in the backend. If the switch only moves the page state, the user sees
 * "the page says all data, the browser panel still says current plan" -- which is the
 * exact failure these cases are here to catch.
 *
 * Copy is always reached through the message keys, never through a literal: the i18n
 * ratchet guards new test files, and a hard-coded translation would turn it red.
 *
 * Mocks and helpers are copied from `WebFormPage.live.test.tsx` / `WebFormPage.records.test.tsx`
 * on purpose (the hoisted `vi.mock` facts have to live in the same file); the only
 * addition is `setWebFormLiveScope`, the endpoint this page now calls.
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserStatus, WebFormLive, WebFormPreview, WebFormSnapshot } from "../types";
import { t } from "../i18n";
import {
  DEFAULT_WEB_FORM_SCOPE,
  webFormScopeStorageKey,
} from "../features/webform/webFormScopeStorage";
import WebFormPage from "./WebFormPage";

const apiMocks = vi.hoisted(() => ({
  listWebFormFields: vi.fn(),
  getWebFormBrowserStatus: vi.fn(),
  startWebFormBrowser: vi.fn(),
  stopWebFormBrowser: vi.fn(),
  takeWebFormSnapshot: vi.fn(),
  previewWebForm: vi.fn(),
  fillWebForm: vi.fn(),
  getWebFormLiveStatus: vi.fn(),
  startWebFormLive: vi.fn(),
  setWebFormLiveEnabled: vi.fn(),
  // The endpoint this page reaches when the range changes while a session is running.
  setWebFormLiveScope: vi.fn(),
  stopWebFormLive: vi.fn(),
  getWebFormMemoryTargets: vi.fn(),
  rememberWebFormLive: vi.fn(),
  listWebFormRecords: vi.fn(),
  listWebFormRecordsPage: vi.fn(),
  getWebFormRecord: vi.fn(),
  deleteWebFormRecord: vi.fn(),
  listWebFormUrlHistory: vi.fn(),
  deleteWebFormUrlHistory: vi.fn(),
  openWebFormUrl: vi.fn(),
  listWebFormBrowserTargets: vi.fn(),
  setWebFormBrowserTargetLive: vi.fn(),
}));

vi.mock("../api/webform", () => apiMocks);

/**
 * Stand-in for the task foundation (see `src/test/aiTaskEntryBridge.ts`): with the AI
 * switch on, "read the form" goes through a background task that still calls the same
 * `previewWebForm` stub, so "which range was it read with" stays assertable.
 */
vi.mock("../utils/aiTaskEntry", async () => {
  const { createAiTaskEntryBridge } = await import("../test/aiTaskEntryBridge");
  return createAiTaskEntryBridge({
    run: async (payload) => {
      const snapshotId = String(payload.snapshot_id);
      const report = await apiMocks.previewWebForm(snapshotId, true);
      return { snapshot_id: snapshotId, webform: 1, preview: report };
    },
  });
});

const settingsMocks = vi.hoisted(() => ({ getLLMConfig: vi.fn() }));

vi.mock("../api/settings", () => settingsMocks);

function browserStatus(overrides: Partial<BrowserStatus> = {}): BrowserStatus {
  return {
    state: "running",
    port: 9333,
    profile_dir: "D:/ResumeForge/backend/data/browser-profile",
    browser_path: "C:/chrome.exe",
    browser_name: "Google Chrome",
    entry_url: "",
    logged_in_hint: "",
    ...overrides,
  } as BrowserStatus;
}

function preview(overrides: Partial<WebFormPreview> = {}): WebFormPreview {
  return {
    snapshot_id: "snap-1",
    page: { url: "https://example.com/apply", title: "Application", control_count: 1 },
    items: [
      {
        index: 0,
        field: "name",
        field_label: "Name",
        value: "Ada",
        control_label: "Name",
        control_type: "text",
        status: "ready",
        source: "rule",
        current_value: "",
        options: [],
        note: "",
      },
    ],
    missing_data: [],
    unrecognized: [],
    blocked: [],
    default_indexes: [0],
    learning: { candidates: [] },
    ...overrides,
  };
}

function liveStatus(overrides: Partial<WebFormLive> = {}): WebFormLive {
  return {
    running: false,
    field_label: "",
    value: "",
    status: "",
    note: "",
    source: "",
    alternatives: [],
    filled: 0,
    remember_pending: null,
    ...overrides,
  };
}

function renderPage(initialEntries: string[] = ["/webform"]) {
  return render(
    <AntdApp>
      <MemoryRouter initialEntries={initialEntries}>
        <WebFormPage />
      </MemoryRouter>
    </AntdApp>,
  );
}

/** The switch is a segmented radiogroup: reach it by role plus the message key. */
function scopeRadio(labelKey: "webFormPage.scope.group" | "webFormPage.scope.all") {
  return screen.getByRole("radio", { name: t(labelKey) });
}

function storedScope(): string | null {
  return window.localStorage.getItem(webFormScopeStorageKey("main"));
}

beforeEach(() => {
  apiMocks.listWebFormUrlHistory.mockResolvedValue({ items: [] });
  apiMocks.listWebFormBrowserTargets.mockResolvedValue({ items: [] });
  apiMocks.deleteWebFormUrlHistory.mockResolvedValue(undefined);
  apiMocks.openWebFormUrl.mockResolvedValue({ target_id: "target-1", url: "https://example.com" });
  apiMocks.setWebFormBrowserTargetLive.mockImplementation(
    async (targetId: string, enabled: boolean) => ({
      target_id: targetId,
      live_enabled: enabled,
    }),
  );
  // Both storages carry state that must not leak between cases: a remembered range from
  // one case would silently become the starting point of the next one.
  window.sessionStorage.clear();
  window.localStorage.clear();
  apiMocks.getWebFormBrowserStatus.mockResolvedValue(browserStatus());
  apiMocks.takeWebFormSnapshot.mockResolvedValue({
    snapshot_id: "snap-1",
    page: { url: "https://example.com/apply", title: "Application", control_count: 1 },
  } as WebFormSnapshot);
  apiMocks.previewWebForm.mockResolvedValue(preview());
  apiMocks.fillWebForm.mockResolvedValue({ outcomes: [], filled: 1, unverified: 0, failed: 0 });
  apiMocks.listWebFormRecordsPage.mockResolvedValue({ items: [], total: 0 });
  apiMocks.getWebFormRecord.mockResolvedValue(null);
  apiMocks.getWebFormLiveStatus.mockResolvedValue(liveStatus());
  apiMocks.startWebFormLive.mockResolvedValue(liveStatus());
  apiMocks.setWebFormLiveEnabled.mockResolvedValue(liveStatus({ running: true, enabled: false }));
  apiMocks.setWebFormLiveScope.mockResolvedValue(liveStatus({ running: true }));
  apiMocks.stopWebFormLive.mockResolvedValue(liveStatus());
  apiMocks.getWebFormMemoryTargets.mockResolvedValue({ targets: [] });
  apiMocks.rememberWebFormLive.mockResolvedValue({ saved: true, live: liveStatus() });
  settingsMocks.getLLMConfig.mockResolvedValue({
    base_url: "https://api.example.com/v1",
    model: "m",
  });
});

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  window.localStorage.clear();
  vi.resetAllMocks();
});

describe("WebFormPage data-range switch", () => {
  it("shows the switch and starts on the current plan only", async () => {
    renderPage();

    expect(
      await screen.findByRole("radiogroup", { name: t("webFormPage.scope.title") }),
    ).toBeInTheDocument();
    expect(scopeRadio("webFormPage.scope.group")).toBeChecked();
    expect(scopeRadio("webFormPage.scope.all")).not.toBeChecked();
    // The default is a default, not a write: nothing is remembered until the user picks.
    expect(storedScope()).toBeNull();
    expect(DEFAULT_WEB_FORM_SCOPE).toBe("group");
  });

  it("remembers the choice and pushes it into a running live session", async () => {
    // A session is already up, so the backend holds a range the switch has to update.
    apiMocks.getWebFormLiveStatus.mockResolvedValue(liveStatus({ running: true }));

    renderPage();

    // Wait for the restored running session; before that the switch only moves page state.
    await waitFor(() => expect(apiMocks.getWebFormLiveStatus).toHaveBeenCalled());
    fireEvent.click(scopeRadio("webFormPage.scope.all"));

    await waitFor(() => expect(apiMocks.setWebFormLiveScope).toHaveBeenCalledWith("all"));
    expect(storedScope()).toBe("all");
    expect(await screen.findByRole("radio", { name: t("webFormPage.scope.all") })).toBeChecked();
  });

  it("keeps the backend untouched when no live session is running", async () => {
    apiMocks.getWebFormLiveStatus.mockResolvedValue(liveStatus());

    renderPage();

    expect(
      await screen.findByRole("radio", { name: t("webFormPage.scope.all") }),
    ).toBeInTheDocument();
    await waitFor(() => expect(apiMocks.getWebFormLiveStatus).toHaveBeenCalled());
    fireEvent.click(scopeRadio("webFormPage.scope.all"));

    // Local state plus storage only: there is no backend session to talk to.
    await waitFor(() => expect(storedScope()).toBe("all"));
    expect(apiMocks.setWebFormLiveScope).not.toHaveBeenCalled();
  });

  it("starts the click-to-fill session with the range the switch shows", async () => {
    // The model probe fails, so `aiAvailable` stays unknown and the live session is never
    // auto-started: the only `startWebFormLive` call in this case is the one behind the
    // button, which is what makes "the range rode along with it" a real assertion.
    settingsMocks.getLLMConfig.mockRejectedValue(new Error("no model configured"));
    apiMocks.getWebFormLiveStatus.mockResolvedValue(liveStatus());

    renderPage();

    expect(
      await screen.findByRole("radio", { name: t("webFormPage.scope.all") }),
    ).toBeInTheDocument();
    await waitFor(() => expect(apiMocks.getWebFormLiveStatus).toHaveBeenCalled());
    fireEvent.click(scopeRadio("webFormPage.scope.all"));
    await waitFor(() => expect(storedScope()).toBe("all"));

    fireEvent.click(await screen.findByRole("button", { name: t("liveModeCard.toggle.ariaOn") }));

    // Same range as the switch: the floating-ball autofill must not read another data set.
    // (No model means the AI fallback rides along as `false`; only the range is under test.)
    await waitFor(() => expect(apiMocks.startWebFormLive).toHaveBeenCalledWith(false, "all"));
    expect(apiMocks.startWebFormLive).toHaveBeenCalledTimes(1);
  });

  it("reads the batch preview with the range the switch shows", async () => {
    // No model configured, so 「read the current form」 goes down the local-rule path that
    // calls `previewWebForm` directly. That call used to omit the range entirely, which
    // meant "switch to all data, press read" silently previewed the current plan only --
    // the exact mismatch between the switch and the table this file exists to prevent.
    settingsMocks.getLLMConfig.mockRejectedValue(new Error("no model configured"));

    renderPage();

    await screen.findByRole("radio", { name: t("webFormPage.scope.all") });
    fireEvent.click(scopeRadio("webFormPage.scope.all"));
    await waitFor(() => expect(storedScope()).toBe("all"));

    const read = await screen.findByRole("button", {
      name: new RegExp(t("webFormPage.readSnapshot.read")),
    });
    await waitFor(() => expect(read).toBeEnabled());
    read.click();

    await waitFor(() =>
      expect(apiMocks.previewWebForm).toHaveBeenCalledWith("snap-1", false, "all"),
    );
  });

  it("replays a read with the remembered range", async () => {
    window.localStorage.setItem(webFormScopeStorageKey("main"), "all");

    renderPage(["/webform?snapshot=snap-1&ai=1"]);

    // The restored preview has to be built from the range the switch is showing, otherwise
    // the table silently describes a different data set than the switch says.
    await waitFor(() =>
      expect(apiMocks.previewWebForm).toHaveBeenCalledWith("snap-1", true, "all"),
    );
  });

  it("restores the remembered range on the next visit", async () => {
    window.localStorage.setItem(webFormScopeStorageKey("main"), "all");

    renderPage();

    expect(await screen.findByRole("radio", { name: t("webFormPage.scope.all") })).toBeChecked();
    expect(scopeRadio("webFormPage.scope.group")).not.toBeChecked();
    // Opening the page is not an edit: the stored value stays exactly as it was.
    expect(storedScope()).toBe("all");
  });
});
