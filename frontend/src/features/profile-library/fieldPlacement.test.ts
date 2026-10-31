// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, it, vi } from "vitest";

const requestMock = vi.hoisted(() => vi.fn());
vi.mock("../../api/client", () => ({ request: requestMock }));

import { t } from "../../i18n";
import type { DocumentFieldCatalog } from "../../types/resumeDocument";
import type { FieldOut, SectionOut } from "./types";
import {
  catalogPlacementOf,
  getFieldPlacementCatalog,
  invalidateFieldPlacementCatalog,
  profilePlacementLabel,
} from "./fieldPlacement";

function catalog(): DocumentFieldCatalog {
  return {
    sections: [
      {
        key: "education",
        title: "Education",
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
