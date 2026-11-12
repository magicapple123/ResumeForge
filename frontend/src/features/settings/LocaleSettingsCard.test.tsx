// SPDX-License-Identifier: Apache-2.0
/**
 * 界面语言卡片：点一下即切换并落库，**没有**「保存」按钮。
 *
 * 早先是「下拉 + 保存」：换了下拉还得再点一次保存，用户会怀疑第一次到底生效没有。
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App as AntdApp } from "antd";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t, translate } from "../../i18n";
import { LOCALE_ENDONYM } from "../../i18n/localeTypes";
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

/**
 * 两张语言卡片都是 radio（可访问名就是语言名），按语言名点它。
 *
 * 语言名是**母语常量**（`LOCALE_ENDONYM`），不随界面语言变——所以这里不能再用
 * `t("resume.language.*")`：英文界面下它会是 "Chinese"。
 */
function option(locale: "zh-CN" | "en-US") {
  return screen.getByRole("radio", { name: LOCALE_ENDONYM[locale] });
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

  it("英文界面下语言名保持母语形态，说明文字仍跟随界面语言（问题 20c）", () => {
    selectLocale("en-US");
    renderCard();

    const [chineseCard, englishCard] = screen.getAllByRole("radio");
    // 名称是**母语名**：英文界面下左卡仍是「中文」，不是 "Chinese"。
    expect(chineseCard.getAttribute("aria-label")).toBe(LOCALE_ENDONYM["zh-CN"]);
    expect(englishCard.getAttribute("aria-label")).toBe(LOCALE_ENDONYM["en-US"]);
    expect(chineseCard.querySelector(".settings-locale-option-name")?.textContent).toBe(
      LOCALE_ENDONYM["zh-CN"],
    );
    // 反例守卫：同一个 key 在英文包里是 "Chinese"——名称若退回走语言包，上面两条就红。
    expect(translate("en-US", "resume.language.zh-CN")).not.toBe(LOCALE_ENDONYM["zh-CN"]);

    // 说明文字是"切换会影响什么"，属于说明文案：仍然跟随界面语言（英文）。
    expect(chineseCard.querySelector(".settings-locale-option-desc")?.textContent).toBe(
      translate("en-US", "settings.locale.option.zh-CN"),
    );
    expect(englishCard.querySelector(".settings-locale-option-desc")?.textContent).toBe(
      translate("en-US", "settings.locale.option.en-US"),
    );
  });
});
