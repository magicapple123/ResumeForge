// SPDX-License-Identifier: Apache-2.0
/**
 * 壳层语言（桌面/托盘/原生对话框）与应用内语言的一致性：
 *
 *  1. 桌面壳 lib/shell-locale.js 的 resolveShellLocale 必须与 localeStore 的
 *     detectPreferredLocale 是**同一规则**。这里直接执行桌面壳的真实实现（不是抄一份
 *     期望表），同一组 tag 两侧各断言一次同值结论——两套规则一旦漂移就红。
 *  2. I18nProvider 把当前 locale 推给壳层桥（setLocale），浏览器与旧壳安静降级。
 */
import { act, cleanup, render } from "@testing-library/react";
// @ts-expect-error Node built-ins are available in Vitest; @types/node is not installed.
import { readFileSync } from "node:fs";
// @ts-expect-error same as above.
import { dirname, resolve } from "node:path";
// @ts-expect-error same as above.
import { fileURLToPath } from "node:url";
// @ts-expect-error same as above.
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import I18nProvider from "./I18nProvider";
import { detectPreferredLocale, selectLocale } from "./localeStore";

const HERE = dirname(fileURLToPath(import.meta.url));
/** 桌面壳的权威实现；两个入口读同一份规则，不是两份手写等价表。 */
const SHELL_LOCALE_SOURCE = resolve(HERE, "../../../desktop/lib/shell-locale.js");

interface ShellLocaleModule {
  resolveShellLocale: (tag: unknown) => "zh" | "en";
  resolveShellLocaleFromEnvironment: (
    appLocale: string,
    environment?: Record<string, string | undefined>,
  ) => "zh" | "en";
}

function loadDesktopShellLocale(): ShellLocaleModule {
  const sandbox: {
    module: { exports: Partial<ShellLocaleModule> };
    exports: Record<string, unknown>;
  } = { module: { exports: {} }, exports: {} };
  runInNewContext(readFileSync(SHELL_LOCALE_SOURCE, "utf8"), sandbox);
  return sandbox.module.exports as ShellLocaleModule;
}

const shellLocale = loadDesktopShellLocale();

/** 两侧共同覆盖的最小集合 + 边界（未知语言、空串、POSIX 下划线写法）。 */
const SHARED_TAGS = ["zh-TW", "en-US", "C", "zh-CN", "en-GB", "ja-JP", "", "zh_CN"];

describe("壳层语言规则与 detectPreferredLocale 同值（防两套规则漂移）", () => {
  it.each(["zh-TW", "en-US", "C"])("tag %s：应用内语言与壳层语言结论一致", (tag) => {
    const frontendLocale = detectPreferredLocale([tag]);
    const expectedShell = frontendLocale === "zh-CN" ? "zh" : "en";
    expect(shellLocale.resolveShellLocale(tag)).toBe(expectedShell);
  });

  it("同一组标签逐条比对（含未知语言与空串）", () => {
    for (const tag of SHARED_TAGS) {
      const frontendLocale = detectPreferredLocale([tag]);
      expect(shellLocale.resolveShellLocale(tag)).toBe(frontendLocale === "zh-CN" ? "zh" : "en");
    }
  });

  it("钉死具体取值：zh-TW -> zh、en-US -> en、C locale -> en", () => {
    // 与 desktop/scripts/test-shell-locale.js 的同一组断言互为镜像：两边都必须写。
    expect(shellLocale.resolveShellLocale("zh-TW")).toBe("zh");
    expect(shellLocale.resolveShellLocale("en-US")).toBe("en");
    expect(shellLocale.resolveShellLocale("C")).toBe("en");
    expect(detectPreferredLocale(["zh-TW"])).toBe("zh-CN");
    expect(detectPreferredLocale(["en-US"])).toBe("en-US");
    expect(detectPreferredLocale(["C"])).toBe("en-US");
  });

  it("环境变量兜底：空 appLocale + LANG=zh_CN -> zh，LANG=C -> en", () => {
    expect(shellLocale.resolveShellLocaleFromEnvironment("", { LANG: "zh_CN" })).toBe("zh");
    expect(shellLocale.resolveShellLocaleFromEnvironment("", { LANG: "C" })).toBe("en");
  });
});

type ShellWindow = Window & {
  splash?: { isDesktop?: boolean; quitApp?: () => void };
  desktopShell?: { setLocale?: (locale: "zh" | "en") => void };
};

function installShellBridge(setLocale?: (locale: "zh" | "en") => void): void {
  const shellWindow = window as ShellWindow;
  shellWindow.splash = { isDesktop: true };
  shellWindow.desktopShell = setLocale ? { setLocale } : {};
}

afterEach(() => {
  cleanup();
  const shellWindow = window as ShellWindow;
  delete shellWindow.splash;
  delete shellWindow.desktopShell;
});

function Probe() {
  return <span data-testid="probe">probe</span>;
}

describe("I18nProvider 把应用内语言推给壳层", () => {
  it("中文 -> setLocale(zh)，切到英文 -> setLocale(en)", () => {
    const setLocale = vi.fn();
    installShellBridge(setLocale);
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    // 共享基座在 beforeEach 里把 store 固定成 DEFAULT_LOCALE（zh-CN）。
    expect(setLocale).toHaveBeenCalledWith("zh");

    act(() => selectLocale("en-US"));
    const pushed = setLocale.mock.calls.map((call) => call[0]);
    expect(pushed[pushed.length - 1]).toBe("en");
  });

  it("浏览器（没有 splash 桥）不报错，也不会调用 setLocale", () => {
    const setLocale = vi.fn();
    (window as ShellWindow).desktopShell = { setLocale };
    expect(() =>
      render(
        <I18nProvider>
          <Probe />
        </I18nProvider>,
      ),
    ).not.toThrow();
    expect(setLocale).not.toHaveBeenCalled();
  });

  it("旧壳（有 desktopShell 但没有 setLocale）安静降级", () => {
    installShellBridge(undefined);
    expect(() =>
      render(
        <I18nProvider>
          <Probe />
        </I18nProvider>,
      ),
    ).not.toThrow();
  });
});
