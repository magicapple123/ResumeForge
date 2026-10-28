// SPDX-License-Identifier: Apache-2.0
/**
 * 界面语言卡片：点一下即切换并落库，**没有**「保存」按钮。
 *
 * 早先是「下拉 + 保存」：换了下拉还得再点一次保存，用户会怀疑第一次到底生效没有。
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App as AntdApp } from "antd";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import { selectLocale } from "../../i18n/localeStore";
import I18nProvider from "../../i18n/I18nProvider";
import LocaleSettingsCard from "./LocaleSettingsCard";

const localeApi = vi.hoisted(() => ({ setLocale: vi.fn() }));
vi.mock("../../i18n/localePersistence", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../i18n/localePersistence")>()),
  setLocale: localeApi.setLocale,
}));

afterEach(() => {
  cleanup();
  selectLocale("zh-CN");
  localeApi.setLocale.mockReset().mockResolvedValue(undefined);
});

function renderCard() {
  return render(
    <AntdApp>
      <I18nProvider>
        <LocaleSettingsCard />
      </I18nProvider>
    </AntdApp>,
  );
}

/** 两张语言卡片都是 radio（可访问名就是语言名），按语言名点它。 */
function option(locale: "zh-CN" | "en-US") {
  return screen.getByRole("radio", { name: t(`resume.language.${locale}`) });
}

describe("LocaleSettingsCard", () => {
  it("点另一张语言卡片即落库，选中态跟着换，且不需要再点保存", async () => {
    localeApi.setLocale.mockImplementation(async (locale) => {
      selectLocale(locale);
      return undefined;
    });
    renderCard();

    expect(option("zh-CN").getAttribute("aria-checked")).toBe("true");
    fireEvent.click(option("en-US"));

    await waitFor(() => expect(localeApi.setLocale).toHaveBeenCalledWith("en-US"));
    await waitFor(() => expect(option("en-US").getAttribute("aria-checked")).toBe("true"));
    // 保存按钮已经去掉：再点一次没有任何意义。
    expect(screen.queryByRole("button", { name: t("common.action.save") })).toBeNull();
  });

  it("点当前语言不会重复提交", async () => {
    renderCard();
    fireEvent.click(option("zh-CN"));
    await waitFor(() => expect(localeApi.setLocale).not.toHaveBeenCalled());
  });

  it("保存失败时提示，界面语言仍按本机切换", async () => {
    localeApi.setLocale.mockRejectedValue(new Error("unavailable"));
    renderCard();
    fireEvent.click(option("en-US"));
    expect(await screen.findByText(t("settings.locale.saveFailed"))).toBeInTheDocument();
  });
});
