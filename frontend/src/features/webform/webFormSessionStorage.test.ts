// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it } from "vitest";
import {
  clearWebFormSession,
  loadWebFormSession,
  saveWebFormSession,
  webFormSessionStorageKey,
} from "./webFormSessionStorage";

afterEach(() => {
  window.sessionStorage.clear();
});

describe("web form session storage", () => {
  it("round-trips the unfinished session and the selected indexes", () => {
    saveWebFormSession(
      {
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
      },
      "main",
    );

    expect(loadWebFormSession("main")).toMatchObject({
      sessionActive: true,
      selected: [0, 3],
      values: { 0: "张三" },
      aiEnabled: false,
      liveOptOut: true,
    });
  });

  it("falls back to an empty session for malformed storage", () => {
    window.sessionStorage.setItem(webFormSessionStorageKey("main"), "not-json");

    expect(loadWebFormSession("main")).toEqual({
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
    window.sessionStorage.setItem(webFormSessionStorageKey("main"), "{}");
    window.sessionStorage.setItem("other-key", "keep");

    clearWebFormSession("main");

    expect(window.sessionStorage.getItem(webFormSessionStorageKey("main"))).toBeNull();
    expect(window.sessionStorage.getItem("other-key")).toBe("keep");
  });
});

/**
 * RF-13：草稿按数据集隔离。key 拼数据集 id，切换数据集（整页 reload）后
 * 另一个数据集读不到这份草稿；无 id 回落 "main"。
 */
describe("web form session dataset scope", () => {
  it("keys the session by dataset id", () => {
    expect(webFormSessionStorageKey("work")).toBe("resumeforge:webform-session:v1:work");
    expect(webFormSessionStorageKey("")).toBe("resumeforge:webform-session:v1:main");
    expect(webFormSessionStorageKey(null)).toBe("resumeforge:webform-session:v1:main");
  });

  it("does not restore a draft saved under another dataset", () => {
    saveWebFormSession(
      {
        sessionActive: true,
        snapshot: null,
        preview: null,
        selected: [1],
        values: { 1: "工作数据集的草稿" },
        result: null,
        aiEnabled: true,
        liveOptOut: false,
      },
      "work",
    );

    // 换到另一个数据集：草稿不跨数据集恢复。
    expect(loadWebFormSession("personal").values).toEqual({});
    expect(loadWebFormSession("personal").sessionActive).toBe(false);
    // 原数据集仍能读回。
    expect(loadWebFormSession("work").values).toEqual({ 1: "工作数据集的草稿" });
  });

  it("clears only the current dataset's draft", () => {
    saveWebFormSession(
      {
        sessionActive: true,
        snapshot: null,
        preview: null,
        selected: [],
        values: {},
        result: null,
        aiEnabled: true,
        liveOptOut: false,
      },
      "work",
    );
    saveWebFormSession(
      {
        sessionActive: true,
        snapshot: null,
        preview: null,
        selected: [],
        values: {},
        result: null,
        aiEnabled: true,
        liveOptOut: false,
      },
      "personal",
    );

    clearWebFormSession("work");

    expect(window.sessionStorage.getItem(webFormSessionStorageKey("work"))).toBeNull();
    expect(window.sessionStorage.getItem(webFormSessionStorageKey("personal"))).not.toBeNull();
  });
});
