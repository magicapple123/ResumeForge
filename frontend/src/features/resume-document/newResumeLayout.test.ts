// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it } from "vitest";
import { selectLocale } from "../../i18n/localeStore";
import { DEFAULT_RESUME_LAYOUT } from "./resumeDocumentHost";
import { newResumeLayout, withCreationLanguage } from "./newResumeLayout";

afterEach(() => selectLocale("zh-CN"));

describe("creation language defaults", () => {
  it.each(["zh-CN", "en-US"] as const)("uses %s only for a newly created layout", (locale) => {
    selectLocale(locale);
    expect(newResumeLayout()).toMatchObject({ language: locale, page_limit: 1 });
    expect(DEFAULT_RESUME_LAYOUT.language).toBe("zh-CN");
  });

  it("preserves the selected output language until a new creation session starts", () => {
    selectLocale("en-US");
    const created = newResumeLayout();
    const userSelected = { ...created, language: "zh-CN" as const, page_limit: 2 };
    selectLocale("zh-CN");
    expect(created.language).toBe("en-US");
    selectLocale("en-US");
    expect(userSelected.language).toBe("zh-CN");
    expect(withCreationLanguage(userSelected)).toMatchObject({ language: "en-US", page_limit: 2 });
  });
});
