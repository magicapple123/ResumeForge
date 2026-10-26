// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ getUiLocale: vi.fn(), saveUiLocale: vi.fn() }));
vi.mock("../api/uiLocale", () => api);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.resetModules();
  api.getUiLocale.mockReset();
  api.saveUiLocale.mockReset().mockResolvedValue({ locale: "en-US" });
  localStorage.removeItem("rf.locale");
});
afterEach(() => localStorage.removeItem("rf.locale"));

describe("locale preference synchronization", () => {
  it("persists an explicit selection even when it equals the provisional first value", async () => {
    localStorage.setItem("rf.locale", "en-US");
    const { setLocale } = await import("./localePersistence");
    const store = await import("./localeStore");
    await setLocale("en-US");
    expect(api.saveUiLocale).toHaveBeenCalledExactlyOnceWith("en-US");
    expect(store.getSnapshot()).toMatchObject({ locale: "en-US", provisional: false });
  });

  it("corrects provisional storage from an existing backend value", async () => {
    localStorage.setItem("rf.locale", "en-US");
    api.getUiLocale.mockResolvedValue({ locale: "zh-CN" });
    const { hydrateLocaleFromServer } = await import("./localePersistence");
    await hydrateLocaleFromServer();
    const store = await import("./localeStore");
    expect(store.getSnapshot()).toMatchObject({ locale: "zh-CN", provisional: false });
    expect(localStorage.getItem("rf.locale")).toBe("zh-CN");
  });

  it("writes the provisional local choice once when the backend has no saved preference", async () => {
    localStorage.setItem("rf.locale", "en-US");
    api.getUiLocale.mockResolvedValue({ locale: null });
    const { hydrateLocaleFromServer } = await import("./localePersistence");
    await hydrateLocaleFromServer();
    expect(api.saveUiLocale).toHaveBeenCalledExactlyOnceWith("en-US");
    expect((await import("./localeStore")).getSnapshot()).toMatchObject({
      locale: "en-US",
      provisional: false,
    });
  });

  it.each([null, "invalid"])("retains the local choice for backend value %s", async (locale) => {
    localStorage.setItem("rf.locale", "en-US");
    api.getUiLocale.mockResolvedValue({ locale });
    const { hydrateLocaleFromServer } = await import("./localePersistence");
    await hydrateLocaleFromServer();
    const { getSnapshot } = await import("./localeStore");
    expect(getSnapshot().locale).toBe("en-US");
  });

  it("retains the local choice when the backend is unavailable", async () => {
    localStorage.setItem("rf.locale", "en-US");
    api.getUiLocale.mockRejectedValue(new Error("offline"));
    const { hydrateLocaleFromServer } = await import("./localePersistence");
    await hydrateLocaleFromServer();
    expect((await import("./localeStore")).getSnapshot().locale).toBe("en-US");
  });

  it("does not let a stale startup GET replace a subsequent explicit choice", async () => {
    const request = deferred<{ locale: "zh-CN" }>();
    api.getUiLocale.mockReturnValue(request.promise);
    const { hydrateLocaleFromServer, setLocale } = await import("./localePersistence");
    const hydration = hydrateLocaleFromServer();
    await setLocale("en-US");
    request.resolve({ locale: "zh-CN" });
    await hydration;
    expect((await import("./localeStore")).getSnapshot().locale).toBe("en-US");
  });

  it("serializes writes and continues after a rejected earlier write", async () => {
    const first = deferred<{ locale: "en-US" }>();
    api.saveUiLocale.mockReturnValueOnce(first.promise);
    const { setLocale } = await import("./localePersistence");
    const old = setLocale("en-US");
    const rejection = expect(old).rejects.toThrow("offline");
    const latest = setLocale("zh-CN");
    await vi.waitFor(() => expect(api.saveUiLocale).toHaveBeenCalledTimes(1));
    first.reject(new Error("offline"));
    await rejection;
    await latest;
    expect(api.saveUiLocale.mock.calls.map(([locale]) => locale)).toEqual(["en-US", "zh-CN"]);
    expect((await import("./localeStore")).getSnapshot()).toMatchObject({
      locale: "zh-CN",
      provisional: false,
    });
  });
});
