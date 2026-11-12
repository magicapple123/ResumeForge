// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement } from "react";

const requestMock = vi.hoisted(() => vi.fn());
vi.mock("../../../api/client", () => ({ request: requestMock }));

import { t } from "../../../i18n";
import I18nProvider from "../../../i18n/I18nProvider";
import { selectLocale } from "../../../i18n/localeStore";
import type { DocumentFieldCatalog } from "../../../types/resumeDocument";
import type { FieldOut, SectionOut } from "./types";
import {
  catalogPlacementOf,
  getFieldPlacementCatalog,
  invalidateFieldPlacementCatalog,
  profilePlacementLabel,
  useFieldPlacementCatalog,
} from "./fieldPlacement";

function catalog(sectionTitle = "Education"): DocumentFieldCatalog {
  return {
    sections: [
      {
        key: "education",
        title: sectionTitle,
        title_key: "education",
        kind: "entries",
        profile_section_key: "educations",
        material_only: false,
        fields: [
          {
            key: "school",
            label: "School",
            format: "text",
            field_type: "single_line",
            default_placement: "title",
            material_only: false,
            private: false,
            source_field_id: "educations.education_school",
          },
        ],
      },
    ],
    header_fields: [],
  };
}

function section(): SectionOut {
  return {
    key: "educations",
    name: "Education",
    form: "multi",
    is_builtin: true,
    carrier_field_id: null,
    material_only: false,
    provenance: [],
    fields: [],
    revision: 1,
    filter_by_job: false,
  };
}

function field(overrides: Partial<FieldOut> = {}): FieldOut {
  return {
    field_id: "education_school",
    section_key: "educations",
    key: "school",
    label: "School",
    field_type: "single_line",
    order: 0,
    default_collapsed: false,
    enum_suggestions: [],
    is_builtin: true,
    private: false,
    llm_allowed: true,
    webform_allowed: true,
    hidden: false,
    collapsed_override: null,
    preference_revision: 1,
    revision: 1,
    ...overrides,
  };
}

describe("fieldPlacement · 目录匹配", () => {
  it("内置字段按 source_field_id 末段对齐 field_id", () => {
    const entry = catalogPlacementOf(catalog(), section(), field());
    expect(entry?.default_placement).toBe("title");
  });

  it("自建字段的 source_field_id 就是 field_id", () => {
    const customCatalog = catalog();
    customCatalog.sections[0].fields = [
      {
        ...customCatalog.sections[0].fields[0],
        key: "custom:cf1",
        source_field_id: "cf1",
        default_placement: "body",
        material_only: true,
      },
    ];
    const entry = catalogPlacementOf(
      customCatalog,
      section(),
      field({ field_id: "cf1", key: "custom:cf1" }),
    );
    expect(entry?.default_placement).toBe("body");
    expect(entry?.material_only).toBe(true);
  });

  it("目录缺失 / 板块不匹配时返回 null（界面不显示徽标而不是崩溃）", () => {
    expect(catalogPlacementOf(null, section(), field())).toBeNull();
    expect(catalogPlacementOf(catalog(), null, field())).toBeNull();
    const unknown = section();
    unknown.key = "projects";
    expect(catalogPlacementOf(catalog(), unknown, field())).toBeNull();
  });
});

describe("fieldPlacement · 显示名", () => {
  it("空位置显示「按字段类型自动」，已知位置走结构命名空间", () => {
    expect(profilePlacementLabel(null)).toBe(t("structure.profile.placementAuto"));
    expect(profilePlacementLabel("title")).toBe(t("structure.placement.title"));
    expect(profilePlacementLabel("hidden")).toBe(t("structure.placement.hidden"));
  });
});

describe("fieldPlacement · 目录缓存", () => {
  beforeEach(() => {
    requestMock.mockReset();
    invalidateFieldPlacementCatalog();
  });

  it("同一会话只请求一次；失效后重新请求", async () => {
    requestMock.mockResolvedValue(catalog());
    await getFieldPlacementCatalog();
    await getFieldPlacementCatalog();
    expect(requestMock).toHaveBeenCalledTimes(1);
    invalidateFieldPlacementCatalog();
    await getFieldPlacementCatalog();
    expect(requestMock).toHaveBeenCalledTimes(2);
  });
});

describe("fieldPlacement · 目录语言", () => {
  beforeEach(() => {
    requestMock.mockReset();
    invalidateFieldPlacementCatalog();
    selectLocale("zh-CN");
  });

  it("en-US 下请求 URL 带 ?language=en-US（中文界面仍是 zh-CN）", async () => {
    requestMock.mockResolvedValue(catalog());
    await getFieldPlacementCatalog("en-US");
    expect(requestMock).toHaveBeenCalledWith("/profile/field-placement-catalog?language=en-US");
  });

  it("语言切换后重新请求，且缓存按语言隔离（en 的缓存不会被 zh 命中）", async () => {
    // 后端按语言回不同的板块标题：用它判断"这次拿到的是哪一份目录"。
    requestMock.mockImplementation((url: string) =>
      Promise.resolve(catalog(url.includes("en-US") ? "Education" : "教育经历")),
    );

    // hook 从 `useLocale()` 取语言。用 Provider 固定语言（就是应用里那一条链路：
    // I18nProvider→Context→useLocale），不去动全局 store，免得污染同文件其它用例。
    const renderIn = (locale: "zh-CN" | "en-US") =>
      renderHook(() => useFieldPlacementCatalog(), {
        // .ts 文件不写 JSX：等价于 <I18nProvider locale={locale}>{children}</I18nProvider>
        wrapper: ({ children }) => createElement(I18nProvider, { locale, children }),
      });

    // 1) 中文界面 → ?language=zh-CN
    const zhView = renderIn("zh-CN");
    await waitFor(() => expect(zhView.result.current.catalog).not.toBeNull());
    expect(requestMock).toHaveBeenLastCalledWith("/profile/field-placement-catalog?language=zh-CN");
    expect(zhView.result.current.catalog?.sections[0].title).toBe("教育经历");
    zhView.unmount();

    // 2) 换成英文界面 → 必须重新请求（zh 的缓存不能顶替），并且发 en-US
    const enView = renderIn("en-US");
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(2));
    expect(requestMock).toHaveBeenLastCalledWith("/profile/field-placement-catalog?language=en-US");
    await waitFor(() => expect(enView.result.current.catalog?.sections[0].title).toBe("Education"));
    enView.unmount();

    // 3) 再回到中文 → 同样不命中 en 的缓存，重新请求拿回中文那份
    const zhAgain = renderIn("zh-CN");
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(3));
    expect(requestMock).toHaveBeenLastCalledWith("/profile/field-placement-catalog?language=zh-CN");
    await waitFor(() => expect(zhAgain.result.current.catalog?.sections[0].title).toBe("教育经历"));
    zhAgain.unmount();

    // 4) 再切回英文 → 同样重新请求（缓存只有一个槽位，但它带着"这份目录是哪门语言的"
    //    标记：宁可重新取一次，也绝不让中文那份被当成英文用）。
    const enAgain = renderIn("en-US");
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(4));
    expect(requestMock).toHaveBeenLastCalledWith("/profile/field-placement-catalog?language=en-US");
    await waitFor(() =>
      expect(enAgain.result.current.catalog?.sections[0].title).toBe("Education"),
    );
    enAgain.unmount();
  });
});
