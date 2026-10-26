// SPDX-License-Identifier: Apache-2.0
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

function selectEnglish() {
  const control = screen.getByRole("combobox", { name: t("settings.locale.label") });
  fireEvent.keyDown(control, { key: "ArrowDown", keyCode: 40 });
  fireEvent.keyDown(control, { key: "ArrowDown", keyCode: 40 });
  fireEvent.keyDown(control, { key: "Enter", keyCode: 13 });
}

describe("LocaleSettingsCard", () => {
  it("offers registered locale labels and saves the selected locale", async () => {
    localeApi.setLocale.mockImplementation(async (locale) => {
      selectLocale(locale);
      return undefined;
    });
    renderCard();
    selectEnglish();
    await waitFor(() => expect(localeApi.setLocale).toHaveBeenCalledWith("en-US"));
    await waitFor(() => {
      const control = screen.getByRole("combobox", { name: t("settings.locale.label") });
      expect(control.parentElement?.textContent).toBe(t("resume.language.en-US"));
    });
  });

  it("shows an error if persistence fails after the local choice", async () => {
    localeApi.setLocale.mockRejectedValue(new Error("unavailable"));
    renderCard();
    selectEnglish();
    expect(await screen.findByText(t("settings.locale.saveFailed"))).toBeInTheDocument();
  });

  it("persists the current provisional value when the user saves without changing it", async () => {
    renderCard();
    fireEvent.click(screen.getByRole("button", { name: t("common.action.save") }));
    await waitFor(() => expect(localeApi.setLocale).toHaveBeenCalledWith("zh-CN"));
  });
});
