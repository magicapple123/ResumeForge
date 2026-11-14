// SPDX-License-Identifier: Apache-2.0
/**
 * 字段级排版的取值链：路径键必须保留；没命中字段时按「条目角色 → 条目 → 模板」逐级回退；
 * 只有命中的角色才暴露段前/段后这类段落属性。
 *
 * 守的是「只改一个字段」：回退链断了会把整条样式一起改掉，而界面上只会显示「已调整」。
 */
import { describe, expect, it } from "vitest";
import { isFieldStylePath } from "./fieldStyleTarget";
import { entryStyleScopeProps, entryStyleScopeRole } from "./entryStyleScopes";
import {
  readStyleDomains,
  resolvedPropValue,
  styleSourceOf,
  withObjectRoleProp,
  withObjectProp,
} from "./styleOverrides";
import { styleProbeCss } from "../../../utils/resumeFormatProbe";

const entry = "ob_entry0001";
const field = `projects.${entry}.ob_field0001`;

describe("exact field typography", () => {
  it("retains path keys and falls back through entry-role then entry styles", () => {
    const config = withObjectRoleProp(
      withObjectProp({}, entry, "bold", true),
      entry,
      "body",
      "color",
      "#123456",
    );
    const changed = withObjectRoleProp(config, field, "body", "space_before", 0.4);
    const domains = readStyleDomains(changed);
    expect(domains.objectRoles[`${field}:body`]).toEqual({ space_before: 0.4 });
    expect(resolvedPropValue(domains, { role: "body", objectId: field, prop: "color" })).toBe(
      "#123456",
    );
    expect(resolvedPropValue(domains, { role: "body", objectId: field, prop: "bold" })).toBe(true);
    expect(styleSourceOf(changed, { role: "body", objectId: field, prop: "color" })).toBe("object");
    expect(isFieldStylePath(`${field}"]`)).toBe(false);
  });

  it("keeps the hit role and exposes paragraph spacing", () => {
    expect(entryStyleScopeRole("field", "meta")).toBe("meta");
    expect(entryStyleScopeProps("field", "body")).toEqual(
      expect.arrayContaining(["color", "space_before", "space_after"]),
    );
    const css = styleProbeCss(
      { objectId: field, role: "body" },
      { color: "#ff0000", space_before: 0.4 },
    );
    expect(css).toContain(`[data-resume-path="${field}"]`);
    expect(css).not.toContain(`[data-object-id="${entry}"]`);
    expect(css).toContain("margin-top:");
  });
});
