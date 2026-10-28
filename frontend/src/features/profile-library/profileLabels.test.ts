// SPDX-License-Identifier: Apache-2.0
/**
 * 「我的资料」分区名/字段名的展示守卫。
 *
 * 三条边界必须成立：
 * 1. 中文界面用**后端原文**（后端下发的就是中文，语言包只是镜像）；
 * 2. 英文界面用语言包里的英文，不能让 `educations.school` 这类后端中文漏出来；
 * 3. 自建分区/字段、以及后端新加的未知字段一律回退原文——那些名字是用户数据或
 *    尚未登记的新内容，翻译它们等于改数据或编造文案。
 */
import { afterEach, describe, expect, it } from "vitest";
import { applyServerLocale, selectLocale } from "../../i18n/localeStore";
import { profileFieldLabel, profileSectionLabel } from "./profileLabels";

afterEach(() => {
  // 复位到源语言：其它用例默认跑在 zh-CN 上。
  selectLocale("zh-CN");
});

describe("profileLabels", () => {
  it("中文界面直接用后端下发的分区名与字段名", () => {
    applyServerLocale("zh-CN");
    expect(profileSectionLabel({ key: "educations", name: "教育经历", is_builtin: true })).toBe(
      "教育经历",
    );
    expect(
      profileFieldLabel({
        field_id: "educations.school",
        section_key: "educations",
        key: "school",
        label: "学校",
        is_builtin: true,
      }),
    ).toBe("学校");
  });

  it("英文界面把内置分区与字段翻成英文", () => {
    applyServerLocale("en-US");
    expect(profileSectionLabel({ key: "educations", name: "教育经历", is_builtin: true })).toBe(
      "Education",
    );
    expect(
      profileFieldLabel({
        field_id: "educations.school",
        section_key: "educations",
        key: "school",
        label: "学校",
        is_builtin: true,
      }),
    ).toBe("School");
  });

  it("自建分区/字段与未登记字段回退用户或后端原文", () => {
    applyServerLocale("en-US");
    expect(profileSectionLabel({ key: "custom:abc", name: "Math", is_builtin: false })).toBe(
      "Math",
    );
    expect(
      profileFieldLabel({
        field_id: "custom:abc.title",
        key: "title",
        label: "Line",
        is_builtin: false,
      }),
    ).toBe("Line");
    // 后端新增、语言包还没登记的内置字段：显示原文，不要显示 message key。
    expect(
      profileFieldLabel({
        field_id: "educations.brand_new_field",
        key: "brand_new_field",
        label: "新字段",
        is_builtin: true,
      }),
    ).toBe("新字段");
  });
});
