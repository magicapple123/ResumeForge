// SPDX-License-Identifier: Apache-2.0
/**
 * i18n 运行时与 Provider 的行为。
 *
 * 这里验证 Provider 对 locale、文案和文档语言的同步；共享测试 setup 会给旧组件测试固定
 * 包一层 zh-CN Provider，避免断言受运行时默认语言影响。
 *
 * 其余几条盯的是同一条链上的小坑：`<html lang>` 要跟着 locale 走（无障碍与断行都看它）、
 * 缺 key 时返回 key 本身（界面上出现 `resume.language.label` 这种字样，比出现空白更容易
 * 被发现）、以及 antd 的语言包映射只有一个入口。
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { antdLocale } from "./antdLocale";
import I18nProvider from "./I18nProvider";
import { useI18n, useLocale } from "./i18nContext";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, t, translate } from "./index";
import { selectLocale } from "./localeStore";
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
  // Provider 会改 `<html lang>`、`selectLocale` 会改全局 store：不还原就会把上一个
  // 用例的副作用留给下一个（后续用例断言的中文文案会变成英文）。
  act(() => {
    selectLocale(DEFAULT_LOCALE);
  });
  document.documentElement.lang = DEFAULT_LOCALE;
});

describe("I18nProvider locale", () => {
  it("把 locale 与文案下发给消费者", () => {
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

  it("reactively updates the rendered language and <html lang>", () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );

    act(() => selectLocale("en-US"));

    expect(screen.getByTestId("locale")).toHaveTextContent("en-US");
    expect(screen.getByTestId("label")).toHaveTextContent(t("resume.language.label"));
    expect(document.documentElement.lang).toBe("en-US");
  });

  it("registers both UI locales while keeping the legacy default", () => {
    expect(SUPPORTED_LOCALES).toEqual(["zh-CN", "en-US"]);
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
