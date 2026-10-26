// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it } from "vitest";
import { t } from "../../i18n";
import { DEFAULT_LOCALE } from "../../i18n/localeTypes";
import { selectLocale } from "../../i18n/localeStore";
import {
  normalizeWebformGroupId,
  webformGroupLabel,
  webformOptionLabel,
  webformRepeatedGroupLabel,
} from "./groupIdentity";
import { webformFieldLabel } from "./webformFieldLabels";

afterEach(() => selectLocale(DEFAULT_LOCALE));

describe("webform group protocol identity", () => {
  it("normalizes fixed legacy labels without changing user-provided groups", () => {
    expect(normalizeWebformGroupId("身份信息")).toBe("identity");
    expect(normalizeWebformGroupId("自定义")).toBe("custom");
    expect(normalizeWebformGroupId("Partner-specific group")).toBe("Partner-specific group");
  });

  it("keeps protocol identity stable while display labels follow the UI locale", () => {
    const identity = normalizeWebformGroupId("学籍与档案");
    expect(identity).toBe("school");
    expect(webformGroupLabel(identity)).toBe("学籍与档案");
    selectLocale("en-US");
    expect(normalizeWebformGroupId(identity)).toBe("school");
    expect(webformGroupLabel(identity)).toBe("School and records");
  });

  it("localizes built-in option labels without rewriting the submitted value", () => {
    const value = "\u7537";
    const zhLabel = webformOptionLabel("gender", value);
    expect(zhLabel).toBe(t("webformGroups.option.male"));

    selectLocale("en-US");

    const enLabel = webformOptionLabel("gender", value);
    expect(enLabel).toBe(t("webformGroups.option.male"));
    expect(enLabel).not.toBe(zhLabel);
    expect(value).toBe("\u7537");
  });

  it("localizes repeated group and directory Field labels while preserving unknown user labels", () => {
    expect(webformRepeatedGroupLabel("education", "fallback")).toBe("教育经历补充");
    expect(webformFieldLabel("student_id", "学号")).toBe("学号");
    expect(webformFieldLabel("CUSTOM_advisor_name", "Advisor name")).toBe("Advisor name");

    selectLocale("en-US");

    expect(webformRepeatedGroupLabel("education", "fallback")).toBe("Education details");
    expect(webformFieldLabel("student_id", "学号")).toBe("Student ID");
    expect(webformFieldLabel("CUSTOM_advisor_name", "Advisor name")).toBe("Advisor name");
  });
});
