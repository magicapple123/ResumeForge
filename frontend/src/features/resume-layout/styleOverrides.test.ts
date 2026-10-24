// SPDX-License-Identifier: Apache-2.0
/**
 * W07 局部排版数据层：三层读取、删键即继承、来源判定、对象批量应用。
 *
 * 这里只测**数据**；控件行为在 `components/resume/typography/*.test.tsx`。
 */
import { describe, expect, it } from "vitest";
import {
  clearObject,
  clearRole,
  displayStyleValue,
  explicitObjectProps,
  roleBaseRatio,
  readObjectStyle,
  readRoleStyle,
  readStyleDomains,
  resolvedPropValue,
  styleSourceOf,
  withObjectProp,
  withObjectProps,
  storedStyleValue,
  withRoleProp,
  writeStyleDomains,
} from "./styleOverrides";

const OBJ_A = "exp_12345678";
const OBJ_B = "prj_87654321";

function configWithRoles(roles: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return { roles: { version: 1, ...roles }, ...extra } as never;
}

describe("styleOverrides · 读取", () => {
  it("读两份域，非法角色 / 非法值 / 非法 id 丢弃", () => {
    const domains = readStyleDomains({
      roles: {
        version: 1,
        body: { line_height: 1.55, align: "middle" },
        nope: { bold: true },
      },
      objects: {
        version: 1,
        [OBJ_A]: { bullet: "dash" },
        short: { bullet: "dot" },
      },
    } as never);
    expect(domains.roles).toEqual({ body: { line_height: 1.55 } });
    expect(domains.objects).toEqual({ [OBJ_A]: { bullet: "dash" } });
  });

  it("空 / 缺域读成空对象", () => {
    expect(readStyleDomains(undefined)).toEqual({ roles: {}, objects: {} });
    expect(readStyleDomains({ accent: "#123456" } as never)).toEqual({ roles: {}, objects: {} });
  });

  it("version 2 的域整域忽略（读宽容、写不猜）", () => {
    const domains = readStyleDomains({ roles: { version: 2, body: { bold: true } } } as never);
    expect(domains.roles).toEqual({});
  });

  it("readRoleStyle / readObjectStyle 返回拷贝，不改域对象", () => {
    const domains = readStyleDomains(configWithRoles({ body: { bold: true } }));
    const style = readRoleStyle(domains, "body");
    style.bold = false;
    expect(domains.roles.body).toEqual({ bold: true });
    expect(readObjectStyle(domains, OBJ_A)).toEqual({});
  });
});

describe("styleOverrides · 写角色", () => {
  it("写一个属性只动这一条，保留其它域与扁平键", () => {
    const base = {
      accent: "#123456",
      pagination: { version: 1, continuation: { page_numbers: true } },
      roles: { version: 1, body: { line_height: 1.55 } },
    } as never;
    const next = withRoleProp(base, "body", "bullet", "dash");
    expect(next).toEqual({
      accent: "#123456",
      pagination: { version: 1, continuation: { page_numbers: true } },
      roles: { version: 1, body: { line_height: 1.55, bullet: "dash" } },
    });
  });

  it("null 删属性；删空后角色键消失", () => {
    const base = configWithRoles({ body: { bold: true } });
    expect(withRoleProp(base, "body", "bold", null)).toEqual({});
  });

  it("非法值不写，原配置原样返回", () => {
    const base = configWithRoles({ body: { bold: true } });
    expect(withRoleProp(base, "body", "align", "middle")).toBe(base);
  });

  it("clearRole 只清该角色", () => {
    const base = configWithRoles({ body: { bold: true }, meta: { italic: true } });
    expect(clearRole(base, "body")).toEqual({
      roles: { version: 1, meta: { italic: true } },
    });
  });
});

describe("styleOverrides · 写对象", () => {
  it("对象覆盖写在 objects 域，删空后整域消失", () => {
    const base = withObjectProp({ accent: "#123456" }, OBJ_A, "space_before", 0.6);
    expect(base).toEqual({
      accent: "#123456",
      objects: { version: 1, [OBJ_A]: { space_before: 0.6 } },
    });
    expect(withObjectProp(base, OBJ_A, "space_before", null)).toEqual({ accent: "#123456" });
  });

  it("批量应用：逐条保留各自的其它覆盖", () => {
    const base = withObjectProps(withObjectProp({}, OBJ_A, "align", "center"), [OBJ_A, OBJ_B], {
      line_height: 1.4,
      bullet: "dash",
    });
    expect(base).toEqual({
      objects: {
        version: 1,
        [OBJ_A]: { align: "center", line_height: 1.4, bullet: "dash" },
        [OBJ_B]: { line_height: 1.4, bullet: "dash" },
      },
    });
  });

  it("批量应用忽略非法 id 与非法补丁值", () => {
    const next = withObjectProps({}, ["short", OBJ_A], {
      line_height: "tall" as never,
      bold: true,
    });
    expect(next).toEqual({ objects: { version: 1, [OBJ_A]: { bold: true } } });
  });
  it("clearObject 只清这一条", () => {
    const base = withObjectProps(withObjectProp({}, OBJ_A, "bold", true), [OBJ_B], {
      bullet: "none",
    });
    expect(clearObject(base, OBJ_A)).toEqual({
      objects: { version: 1, [OBJ_B]: { bullet: "none" } },
    });
  });

  it("writeStyleDomains 空域删键（R3）", () => {
    expect(writeStyleDomains({ accent: "#123456" }, { roles: {}, objects: {} })).toEqual({
      accent: "#123456",
    });
  });
});

describe("styleOverrides · 来源与生效值", () => {
  const config = {
    line_height: 1.5,
    roles: { version: 1, body: { line_height: 1.55 } },
    objects: { version: 1, [OBJ_A]: { line_height: 1.4 } },
  } as never;

  it("对象覆盖 > 角色 > 版式扁平键 > 模板", () => {
    expect(styleSourceOf(config, { role: "body", prop: "line_height", objectId: OBJ_A })).toBe(
      "object",
    );
    expect(
      styleSourceOf({ line_height: 1.5 } as never, { role: "body", prop: "line_height" }),
    ).toBe("resume");
    expect(styleSourceOf(config, { role: "body", prop: "indent" })).toBe("template");
  });

  it("生效值按同一层次回落，最后落中性兜底", () => {
    const domains = readStyleDomains(config);
    expect(resolvedPropValue(domains, { role: "body", prop: "line_height", objectId: OBJ_A })).toBe(
      1.4,
    );
    expect(resolvedPropValue(domains, { role: "body", prop: "line_height" })).toBe(1.55);
    expect(
      resolvedPropValue(domains, {
        role: "body",
        prop: "line_height",
        templateDefaults: { line_height: 1.7 },
      }),
    ).toBe(1.55);
    expect(
      resolvedPropValue(readStyleDomains({}), {
        role: "body",
        prop: "line_height",
        templateDefaults: { line_height: 1.7 },
      }),
    ).toBe(1.7);
    expect(resolvedPropValue(readStyleDomains({}), { role: "body", prop: "line_height" })).toBe(
      1.7,
    );
    expect(resolvedPropValue(readStyleDomains({}), { role: "body", prop: "indent" })).toBe(0);
  });

  it("字号存的是系数、显示的是系数×模板基准（后端语义）", () => {
    // 后端 name_ratio=1.86：存 1.05 表示「在基准上再乘 1.05」，显示 1.95。
    expect(roleBaseRatio({ font_scale: 1.86 })).toBe(1.86);
    expect(roleBaseRatio(undefined)).toBe(1);
    expect(displayStyleValue("font_scale", 1.05, 1.86)).toBe(1.95);
    expect(displayStyleValue("font_scale", undefined, 1.86)).toBe(1.86);
    expect(storedStyleValue("font_scale", 1.95, 1.86)).toBe(1.0484);
    expect(storedStyleValue("font_scale", null, 1.86)).toBeNull();
    // 非字号属性存什么显示什么。
    expect(displayStyleValue("line_height", 1.55, 1.86)).toBe(1.55);
    expect(storedStyleValue("line_height", 1.55, 1.86)).toBe(1.55);
  });

  it("explicitObjectProps 按固定顺序返回设过的键", () => {
    expect(explicitObjectProps({ align: "center", line_height: 1.4, indent: 1 })).toEqual([
      "line_height",
      "indent",
      "align",
    ]);
  });
});
