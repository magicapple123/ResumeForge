// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectPreferredLocale } from "./localeStore";
import enUS from "./messages/en-US";

/** 换掉系统语言：`detectPreferredLocale` 只影响"谁都没选过"那条首启兜底分支。 */
function stubSystemLanguages(languages: string[]): void {
  vi.stubGlobal("navigator", { languages, language: languages[0] ?? "" });
}

beforeEach(() => {
  vi.resetModules();
  localStorage.removeItem("rf.locale");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.removeItem("rf.locale");
});

describe("detectPreferredLocale", () => {
  const cases: Array<[readonly string[] | undefined, "zh-CN" | "en-US"]> = [
    [["zh-CN"], "zh-CN"],
    [["zh-TW"], "zh-CN"],
    [["zh"], "zh-CN"],
    [["en-GB"], "en-US"],
    [["en"], "en-US"],
    // 不在支持列表里的语言一律回落英文：AppImage 目录的收录测试在 C locale 下截图，
    // 中文界面会被判 "text mostly not in English"（PR appimage.github.io#11983）。
    [["ja-JP"], "en-US"],
    [["de-DE", "fr-FR"], "en-US"],
    // 按顺序取第一个受支持的标签，而不是看第一个标签。
    [["ja", "zh-CN"], "zh-CN"],
    [["fr-FR", "en-US"], "en-US"],
    [[], "en-US"],
    [undefined, "en-US"],
  ];
  it.each(cases)("maps system languages %j to %s", (languages, expected) => {
    expect(detectPreferredLocale(languages)).toBe(expected);
  });
});

describe("locale external store", () => {
  it("probes the system language on first launch when nothing was ever chosen", async () => {
    stubSystemLanguages(["ja-JP"]);
    const store = await import("./localeStore");
    expect(store.getSnapshot().locale).toBe("en-US");
  });

  it("prefers a stored choice over the system probe", async () => {
    stubSystemLanguages(["en-GB"]);
    localStorage.setItem("rf.locale", "zh-CN");
    const store = await import("./localeStore");
    expect(store.getSnapshot().locale).toBe("zh-CN");
  });

  it("reads storage synchronously and returns a stable first snapshot", async () => {
    localStorage.setItem("rf.locale", "en-US");
    const store = await import("./localeStore");
    expect(store.getSnapshot()).toBe(store.getSnapshot());
    expect(store.getSnapshot()).toMatchObject({ locale: "en-US", provisional: true });
    expect(document.documentElement.lang).toBe("en-US");
  });

  it.each([null, "invalid", "", "EN-US"])("normalizes the stored value %s", async (value) => {
    // 非法/空值不再等于"用 DEFAULT_LOCALE"，而是走首启探测；这里钉住"系统是中文"这一支。
    stubSystemLanguages(["zh-CN"]);
    if (value !== null) localStorage.setItem("rf.locale", value);
    const { getSnapshot } = await import("./localeStore");
    expect(getSnapshot().locale).toBe("zh-CN");
  });

  it("advances registration and switch revisions but notifies only on a switch", async () => {
    // 初始语言必须与"切过去"的语言不同，否则 selectLocale 是空操作、不通知；
    // 首启探测会按 jsdom 的 en-US 起手，这里钉住中文起手以保持用例本意。
    stubSystemLanguages(["zh-CN"]);
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
    // 存储抛错时首启兜底继续走系统语言探测（不能因为存储被禁就起不来）。
    stubSystemLanguages(["zh-CN"]);
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
