import { afterEach, describe, expect, it } from "vitest";
import {
  clearWebFormSession,
  loadWebFormSession,
  saveWebFormSession,
  WEB_FORM_SESSION_STORAGE_KEY,
} from "./webFormSessionStorage";

afterEach(() => {
  window.sessionStorage.clear();
});

describe("web form session storage", () => {
  it("round-trips the unfinished session and the selected indexes", () => {
    saveWebFormSession({
      sessionActive: true,
      snapshot: {
        snapshot_id: "snap-1",
        page: { url: "https://example.com", title: "网申", control_count: 1 },
      },
      preview: null,
      selected: [0, 3],
      values: { 0: "张三" },
      result: null,
      aiEnabled: false,
      liveOptOut: true,
    });

    expect(loadWebFormSession()).toMatchObject({
      sessionActive: true,
      selected: [0, 3],
      values: { 0: "张三" },
      aiEnabled: false,
      liveOptOut: true,
    });
  });

  it("falls back to an empty session for malformed storage", () => {
    window.sessionStorage.setItem(WEB_FORM_SESSION_STORAGE_KEY, "not-json");

    expect(loadWebFormSession()).toEqual({
      sessionActive: false,
      snapshot: null,
      preview: null,
      selected: [],
      values: {},
      result: null,
      aiEnabled: true,
      liveOptOut: false,
    });
  });

  it("clears only the web form session entry", () => {
    window.sessionStorage.setItem(WEB_FORM_SESSION_STORAGE_KEY, "{}");
    window.sessionStorage.setItem("other-key", "keep");

    clearWebFormSession();

    expect(window.sessionStorage.getItem(WEB_FORM_SESSION_STORAGE_KEY)).toBeNull();
    expect(window.sessionStorage.getItem("other-key")).toBe("keep");
  });
});
