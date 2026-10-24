// SPDX-License-Identifier: Apache-2.0
/**
 * W07-INT 对拍：前端属性表 ↔ 后端唯一实现 `resume_style_schema.py`。
 *
 * 为什么用"读源码 + 正则"而不是再抄一份表：契约 §2.2 / §2.10 要求两端属性表**逐键相等**，
 * 而两份手抄表正是漂移的来源。后端模块是唯一真相，这里直接读它的 `STYLE_PROPS` /
 * `ROLE_PROPS` / `OBJECT_PROPS` 字面量做比较——后端改一个数字，这个测试当场红。
 *
 * 路径从 `process.cwd()`（frontend）向上一级找 backend：W07-BE 是本测试的兄弟产物，
 * 文件不存在时测试失败是**正确的**（不能"找不到就跳过"，那等于允许漂移）。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但本文件只在 Node（vitest）里跑。
import { readFileSync } from "node:fs";
// @ts-expect-error 同上。
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  STYLE_ENUM_OPTIONS,
  STYLE_PROP_BOUNDS,
  STYLE_PROP_KINDS,
  type StylePropKey,
} from "../../utils/resumeStyleParams";
import { OBJECT_STYLE_PROPS, RESUME_ROLES, ROLE_STYLE_PROPS } from "./styleCatalog";

// `@types/node` 没装：只声明本文件用到的那一小块（与 cjkRatchet 同一做法）。
declare const process: { cwd(): string };

const RESUME_SERVICES = resolve(process.cwd(), "..", "backend", "app", "services", "resume");
const BACKEND_FILE = resolve(RESUME_SERVICES, "resume_style_schema.py");
const BACKEND_CSS_FILE = resolve(RESUME_SERVICES, "resume_style.py");
const CATALOG_ROUTE_FILE = resolve(
  process.cwd(),
  "..",
  "backend",
  "app",
  "api",
  "resumes",
  "templates_routes.py",
);

const source = readFileSync(BACKEND_FILE, "utf8");
const cssSource = readFileSync(BACKEND_CSS_FILE, "utf8");
const catalogRoute = readFileSync(CATALOG_ROUTE_FILE, "utf8");

interface BackendProp {
  key: string;
  type: string;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  roles: string[];
}

/** 按 `"key": "<name>", "type": "<type>"` 切块，每块解析出一项属性。 */
function backendProps(): BackendProp[] {
  const matches = [...source.matchAll(/"key": "([a-z_]+)",\s*"type": "([a-z]+)"/g)];
  return matches.map((match, index) => {
    const start = match.index ?? 0;
    const end =
      index + 1 < matches.length ? (matches[index + 1].index ?? source.length) : source.length;
    const chunk = source.slice(start, end);
    const number = (pattern: RegExp) => {
      const found = chunk.match(pattern);
      return found ? Number(found[1]) : undefined;
    };
    const rolesFound = chunk.match(/"roles": ROLES/) ? null : chunk.match(/"roles": \(([^)]*)\)/);
    const roles = rolesFound
      ? [...rolesFound[1].matchAll(/"([a-z_]+)"/g)].map((item) => item[1])
      : [...RESUME_ROLES];
    const optionsFound = chunk.match(/"options": \(([^)]*)\)/);
    return {
      key: match[1],
      type: match[2],
      min: number(/"min": ([\d.-]+)/),
      max: number(/"max": ([\d.-]+)/),
      step: number(/"step": ([\d.-]+)/),
      options: optionsFound
        ? [...optionsFound[1].matchAll(/"([a-z]+)"/g)].map((item) => item[1])
        : undefined,
      roles,
    };
  });
}

const backend = backendProps();

describe("W07 对拍 · 前端属性表 = 后端 STYLE_PROPS", () => {
  it("后端的属性键覆盖正好是前端 12 个属性", () => {
    expect(backend.map((prop) => prop.key).sort()).toEqual(Object.keys(STYLE_PROP_KINDS).sort());
  });

  it("类型逐键相等", () => {
    for (const prop of backend) {
      expect(STYLE_PROP_KINDS[prop.key as StylePropKey]).toBe(prop.type);
    }
  });

  it("数值区间与步长逐键相等", () => {
    for (const prop of backend) {
      if (prop.type !== "number") continue;
      const bounds = STYLE_PROP_BOUNDS[prop.key as keyof typeof STYLE_PROP_BOUNDS];
      expect(bounds, prop.key).toBeDefined();
      expect(bounds.min).toBe(prop.min);
      expect(bounds.max).toBe(prop.max);
      expect(bounds.step).toBe(prop.step);
    }
  });

  it("枚举白名单与顺序逐键相等", () => {
    for (const prop of backend) {
      if (prop.type !== "enum") continue;
      const options = STYLE_ENUM_OPTIONS[prop.key as StylePropKey] ?? [];
      expect(options.map((option) => option.value)).toEqual(prop.options);
    }
  });

  it("六个角色与每角色可用属性逐项相等", () => {
    expect([...RESUME_ROLES]).toHaveLength(6);
    for (const role of RESUME_ROLES) {
      const expected = backend
        .filter((prop) => prop.roles.includes(role))
        .map((prop) => prop.key)
        .sort();
      expect([...ROLE_STYLE_PROPS[role]].sort(), role).toEqual(expected);
    }
  });

  it("探针 CSS 结构与后端 role_style_css 字面量一致（拖动中 = 松手后）", () => {
    // 字号是两层 calc：系数 × 基准（前端探针必须保留同样的结构，不能把两层折平）。
    expect(cssSource).toMatch(
      /font-size: calc\(var\(--fs\) \* \{_css_number\(style\.font_scale\)\} \* \{_css_number\(ratio\)\}\)/,
    );
    // bullet 字面量与前端探针一致。
    expect(cssSource).toContain('{"dot": "disc", "dash": "\'–\'", "none": "none"}');
    // meta_align：right → space-between（前端探针同字面量）。
    expect(cssSource).toContain('"space-between" if style.meta_align == "right" else "flex-start"');
    // 规则行两空格缩进 + data-role 选择器（前端探针同格式）。
    expect(cssSource).toContain('[data-role="{role}"]');
  });

  it("catalog 端点已下发前端读取的三个扩展字段（W07-BE 契约 §2.8）", () => {
    expect(catalogRoute).toContain('"role_fields": role_fields_catalog()');
    expect(catalogRoute).toContain('"template_role_defaults"');
    expect(catalogRoute).toContain('"style_props"');
    // 六个角色的模板基准都要有（投影自 TEMPLATE_LAYOUT_DEFAULTS，不新增第二份数字）。
    for (const role of RESUME_ROLES) {
      // 函数体里每个角色都是一行 `"name": {"font_scale": …}`。
      expect(source).toContain('"' + role + '": {"font_scale"');
    }
  });

  it("对象级属性 = 后端 OBJECT_PROPS（全部 12 项）", () => {
    expect(source).toContain("OBJECT_PROPS: tuple[str, ...] = PROP_KEYS");
    expect([...OBJECT_STYLE_PROPS].sort()).toEqual(backend.map((prop) => prop.key).sort());
  });
});
