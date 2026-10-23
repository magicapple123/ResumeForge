// SPDX-License-Identifier: Apache-2.0
/**
 * i18n 运行时与 Provider 的行为。
 *
 * 这里最要紧的一条是**没有 Provider 也必须能用**：全仓 290 多个测试文件都是单独渲染
 * 一个组件的，如果 `useLocale()` / `useI18n()` 在没有 Provider 时抛错或返回 `undefined`，
 * 每个测试都得包一层 wrapper——那等于把一次文案改造摊派给整条测试链，以后每加一个
 * 测试都会再踩一次。所以这条不是"顺手补的断言"，它是"测试不用改"的唯一机器证据。
 *
 * 其余几条盯的是同一条链上的小坑：`<html lang>` 要跟着 locale 走（无障碍与断行都看它）、
 * 缺 key 时返回 key 本身（界面上出现 `resume.language.label` 这种字样，比出现空白更容易
 * 被发现）、以及 antd 的语言包映射只有一个入口。
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { antdLocale } from "./antdLocale";
import I18nProvider from "./I18nProvider";
import { useI18n, useLocale } from "./i18nContext";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, t, translate } from "./index";
import type { MessageKey } from "./index";

/** 探针：把 hooks 取到的值渲染出来，断言只看 DOM。 */
function Probe() {
  const locale = useLocale();
  const { t: translateWithLocale } = useI18n();
  return (
    <div>
      <span data-testid="locale">{locale}</span>
      <span data-testid="label">{translateWithLocale("resume.language.label")}</span>
    </div>
  );
}

afterEach(() => {
  cleanup();
  // Provider 会改 `<html lang>`：不还原就会把上一个用例的副作用留给下一个。
  document.documentElement.lang = DEFAULT_LOCALE;
});

describe("没有 Provider 时也能用（测试不用加 wrapper 的证据）", () => {
  it("useLocale() 回落默认语言，useI18n().t 仍能取到文案", () => {
    // 刻意**不**包 I18nProvider：这就是 290 多个既有测试文件的渲染方式。
    render(<Probe />);

    expect(screen.getByTestId("locale")).toHaveTextContent(DEFAULT_LOCALE);
    expect(screen.getByTestId("label")).toHaveTextContent(t("resume.language.label"));
    expect(screen.getByTestId("label")).toHaveTextContent("简历语言");
  });

  it("模块级 t() 不依赖 React：在任何地方都能直接调", () => {
    expect(t("resume.language.en-US")).toBe("English");
    // 带参数调用不报错；本条 key 没有占位符，原样返回。
    expect(t("resume.language.label", { name: "x" })).toBe("简历语言");
  });
});

describe("I18nProvider", () => {
  it("把 locale 下发给 hooks，并把 <html lang> 同步成同一个值", () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );

    expect(screen.getByTestId("locale")).toHaveTextContent(DEFAULT_LOCALE);
    expect(document.documentElement.lang).toBe(DEFAULT_LOCALE);
  });

  it("只支持一种语言：SUPPORTED_LOCALES 只有 zh-CN，界面上不该有切换入口", () => {
    expect(SUPPORTED_LOCALES).toEqual(["zh-CN"]);
    expect(DEFAULT_LOCALE).toBe("zh-CN");
  });
});

describe("缺 key 与语言包映射", () => {
  it("缺 key 时返回 key 本身并告警，而不是空白", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // 静态 key 过不了 `tsc`，这里模拟"动态拼出来的 key"这一种真实可能。
    const dynamicKey = "resume.language.missing" as MessageKey;

    expect(translate(DEFAULT_LOCALE, dynamicKey)).toBe(dynamicKey);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("resume.language.missing");

    warn.mockRestore();
  });

  it("antd 的语言包只从一处映射；认不出的值回落到中文", () => {
    const mapped = antdLocale(DEFAULT_LOCALE);
    // antd 的 zh_CN 语言包自带分页/日期等文案，取一个稳定存在的键即可。
    expect(mapped).toHaveProperty("Pagination");
    // 运行时可能从存储里读到比 `Locale` 更宽的值：必须归位，不能把 undefined 交给 antd
    // （那会让 antd 回落到**英文**默认包，反而不是我们要的"未知就中文"）。
    expect(antdLocale("de-DE" as unknown as typeof DEFAULT_LOCALE)).toBe(mapped);
  });
});
