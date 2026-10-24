// SPDX-License-Identifier: Apache-2.0
/** 目录扩展（W07-BE 下发 / 缺省回落）的容错读取。 */
import { describe, expect, it } from "vitest";
import { TEMPLATE_CATALOG } from "../../test/resumeFixtures";
import type { ResumeTemplateCatalog } from "../../types";
import { readStyleCatalog, roleStyleProps, templateRoleDefaults } from "./styleCatalogExtensions";
import { ROLE_STYLE_PROPS } from "./styleCatalog";

describe("styleCatalogExtensions · 缺省", () => {
  it("目录没有扩展字段时回落到契约表与空默认", () => {
    const catalog = readStyleCatalog(TEMPLATE_CATALOG);
    expect(catalog.hasTemplateDefaults).toBe(false);
    expect(catalog.templateDefaults).toEqual({});
    expect(roleStyleProps(catalog, "name")).toEqual(ROLE_STYLE_PROPS.name);
    expect(templateRoleDefaults(catalog, "classic", "name")).toEqual({});
  });

  it("undefined / 畸形目录不抛异常", () => {
    expect(readStyleCatalog(undefined).roleProps.body).toEqual(ROLE_STYLE_PROPS.body);
    expect(readStyleCatalog({ role_fields: "x", template_role_defaults: [] } as never)).toEqual({
      roleProps: ROLE_STYLE_PROPS,
      templateDefaults: {},
      hasTemplateDefaults: false,
    });
  });
});

describe("styleCatalogExtensions · 读取", () => {
  const catalog = {
    ...TEMPLATE_CATALOG,
    role_fields: [
      { role: "body", label_key: "typography.role.body", props: ["line_height", "bullet"] },
      { role: "unknown", props: ["bold"] },
    ],
    template_role_defaults: {
      classic: {
        name: { font_scale: 1.86 },
        body: { line_height: 1.7, bullet: "dot", indent: 99 },
        nope: { bold: true },
      },
    },
  } as unknown as ResumeTemplateCatalog;

  it("role_fields 只**收窄**契约表，不放大", () => {
    const parsed = readStyleCatalog(catalog);
    expect(parsed.roleProps.body).toEqual(["line_height", "bullet"]);
    // 没有下发的角色保持契约表
    expect(parsed.roleProps.name).toEqual(ROLE_STYLE_PROPS.name);
  });

  it("template_role_defaults 只留合法属性，越界值丢弃", () => {
    const parsed = readStyleCatalog(catalog);
    expect(parsed.hasTemplateDefaults).toBe(true);
    expect(parsed.templateDefaults.classic).toEqual({
      name: { font_scale: 1.86 },
      body: { line_height: 1.7, bullet: "dot" },
    });
    expect(templateRoleDefaults(parsed, "classic", "name")).toEqual({ font_scale: 1.86 });
    expect(templateRoleDefaults(parsed, "modern", "name")).toEqual({});
  });
});
