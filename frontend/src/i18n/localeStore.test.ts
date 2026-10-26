// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enUS from "./messages/en-US";

beforeEach(() => {
  vi.resetModules();
  localStorage.removeItem("rf.locale");
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.removeItem("rf.locale");
});

describe("locale external store", () => {
  it("reads storage synchronously and returns a stable first snapshot", async () => {
    localStorage.setItem("rf.locale", "en-US");
    const store = await import("./localeStore");
    expect(store.getSnapshot()).toBe(store.getSnapshot());
    expect(store.getSnapshot()).toMatchObject({ locale: "en-US", provisional: true });
    expect(document.documentElement.lang).toBe("en-US");
  });

  it.each([null, "invalid", "", "EN-US"])("normalizes the stored value %s", async (value) => {
    if (value !== null) localStorage.setItem("rf.locale", value);
    const { getSnapshot } = await import("./localeStore");
    expect(getSnapshot().locale).toBe("zh-CN");
  });

  it("advances registration and switch revisions but notifies only on a switch", async () => {
    const store = await import("./localeStore");
    const registry = await import("./messageRegistry");
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    const revision = store.getSnapshot().revision;
    registry.registerLanguagePack("en-US", enUS);
    expect(store.getSnapshot().revision).toBe(revision + 1);
    expect(listener).not.toHaveBeenCalled();
    store.selectLocale("en-US");
    expect(store.getSnapshot().revision).toBe(revision + 2);
    expect(listener).toHaveBeenCalledTimes(1);
    store.selectLocale("en-US");
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    store.selectLocale("zh-CN");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("keeps the in-memory choice if storage access or writes fail", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const store = await import("./localeStore");
    expect(store.getSnapshot().locale).toBe("zh-CN");
    store.selectLocale("en-US");
    expect(store.getSnapshot().locale).toBe("en-US");
    expect(store.getSnapshot()).toBe(store.getSnapshot());
  });

  it("updates the module-level t without changing its call syntax", async () => {
    const store = await import("./localeStore");
    const { t, translate } = await import("./index");
    store.selectLocale("en-US");
    expect(t("resume.format.label")).toBe(enUS["resume.format.label"]);
    expect(t("resume.pagePadding.customHint", { top: 1, right: 2, bottom: 3, left: 4 })).toBe(
      translate("en-US", "resume.pagePadding.customHint", { top: 1, right: 2, bottom: 3, left: 4 }),
    );
  });

  it("uses current-language common entries before returning a missing key", async () => {
    const { registerLanguagePack, translate } = await import("./messageRegistry");
    const { DEFAULT_LOCALE } = await import("./index");
    type Key = Parameters<typeof translate>[1];
    registerLanguagePack("en-US", { "common.retry": enUS["common.retry"] });
    expect(translate("en-US", "missing.retry" as Key)).toBe(enUS["common.retry"]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(translate("en-US", "resume.missing" as Key)).toBe("resume.missing");
    expect(translate(DEFAULT_LOCALE, "resume.format.label")).not.toBe("resume.format.label");
    expect(warn).toHaveBeenCalledOnce();
  });

  it("registers namespaces incrementally without discarding earlier translations", async () => {
    const { registerLanguagePack, translate } = await import("./messageRegistry");
    type Key = Parameters<typeof translate>[1];
    registerLanguagePack("en-US", { "probe.first": "First" } as Partial<Record<Key, string>>);
    registerLanguagePack("en-US", { "probe.second": "Second" } as Partial<Record<Key, string>>);
    expect(translate("en-US", "probe.first" as Key)).toBe("First");
    expect(translate("en-US", "probe.second" as Key)).toBe("Second");
  });
});
