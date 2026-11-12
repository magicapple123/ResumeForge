// SPDX-License-Identifier: Apache-2.0
/**
 * 4-A：生成弹窗「调整板块顺序」的清单必须按**当前组**裁剪。
 *
 * 用户反馈的场景：摘要写「本次使用：我是测试（6 个板块）」，可清单却列了 11 个系统板块，
 * 被隐藏的板块还能排到最前面。根因是清单取自**静态目录**（全局），而"这个组参与哪些板块"
 * 这份局部约束从未与它相交；修法见 `templateCatalogDefaults.ts` 的模块头注释。
 *
 * 这里钉四类口径（外加两条自保）：
 * 1. 组内 6 键 → 恰好这 6 行，被隐藏的键一行都不出现；
 * 2. 旧后端（没有新字段）/ 组为空 → 回退**全量**且非空（绝不能变成空清单）；
 * 3. `group_section_order` 决定默认顺序，且被隐藏的键不混进 `profileSectionOrder`
 *    （否则点「与资料顺序同步」会把隐藏键写回 `section_order`）；
 * 4. 自建板块 `custom:<key>` 原样保留（它是资料侧与简历侧共用的同一个键）。
 *
 * 断言一律比对**键**，不出现新的中文字面量（i18n 存量棘轮把测试里的中文也算进去）。
 */
import { describe, expect, it } from "vitest";
import type { GroupSectionScope, ResumeLayout, ResumeTemplateCatalog } from "../../../types";
import { DEFAULT_LAYOUT, TEMPLATE_CATALOG } from "../../../test/resumeFixtures";
import {
  readTemplateCatalogDefaults,
  type ResumeTemplateCatalogWithGroupScope,
} from "./templateCatalogDefaults";

/** 与反馈里的「我是测试」组同规模：6 个参与板块（夹具目录里另有 `summary` 被隐藏）。 */
const GROUP_SIX: string[] = [
  "education",
  "experience",
  "projects",
  "skills",
  "campus_experience",
  "awards",
];

/** 一份目录 + 组范围字段（新字段可选，缺省即"旧后端"）。 */
function catalogWithScope(
  scope: GroupSectionScope,
  overrides: Partial<ResumeTemplateCatalog> = {},
): ResumeTemplateCatalogWithGroupScope {
  return { ...TEMPLATE_CATALOG, ...overrides, ...scope };
}

/** 只取键（标签是展示用的，顺序由 `profileSectionOrder` 负责）。 */
function keysOf(options: { key: string; label: string }[]): string[] {
  return options.map((option) => option.key);
}

/** 全量清单（旧行为的基准）。 */
const FULL_KEYS: string[] = keysOf(TEMPLATE_CATALOG.section_options);

/** 版式：`applyTo` 的入参，只关心它写不写 `section_order`。 */
const LAYOUT: ResumeLayout = DEFAULT_LAYOUT;

describe("读取模板目录默认值（4-A 组范围）", () => {
  it("组内 6 键：可排清单恰好这 6 个，被隐藏的板块不出现", () => {
    const defaults = readTemplateCatalogDefaults(
      catalogWithScope({
        group_section_keys: [...GROUP_SIX],
        group_section_order: [...GROUP_SIX],
      }),
    );

    const keys = keysOf(defaults.sectionOptions);
    expect(keys).toHaveLength(GROUP_SIX.length);
    expect([...keys].sort()).toEqual([...GROUP_SIX].sort());
    // 夹具目录里的第 7 个键（summary）被这个组隐藏，一行都不该出现。
    expect(keys).not.toContain("summary");
    // 去重：同一行出现两次会让「上移/下移」错位。
    expect(new Set(keys).size).toBe(keys.length);
    // 每一行都得有标签，且标签不是裸 key。
    for (const option of defaults.sectionOptions) {
      expect(option.label.trim(), `${option.key} 必须有标签`).not.toBe("");
      expect(option.label, `${option.key} 不能显示裸 key`).not.toBe(option.key);
    }
  });

  it("旧后端没有新字段：回退全量清单，且不为空（组为空时同样回退）", () => {
    const legacy = readTemplateCatalogDefaults({ ...TEMPLATE_CATALOG });
    expect(keysOf(legacy.sectionOptions)).toEqual(FULL_KEYS);
    expect(legacy.sectionOptions.length).toBeGreaterThan(0);
    // 旧行为：默认顺序仍跟随「我的资料」。
    expect(legacy.profileSectionOrder).toEqual(TEMPLATE_CATALOG.profile_section_order);

    // 组里只有页眉 / 投影读取失败时后端也下发空数组——与"字段缺失"同一种处置。
    const emptyScope = readTemplateCatalogDefaults(
      catalogWithScope({ group_section_keys: [], group_section_order: [] }),
    );
    expect(keysOf(emptyScope.sectionOptions)).toEqual(FULL_KEYS);
    expect(emptyScope.profileSectionOrder).toEqual(TEMPLATE_CATALOG.profile_section_order);
  });

  it("group_section_order 决定默认顺序，被隐藏的键不混进 profileSectionOrder", () => {
    // 故意把被隐藏的 `summary` 塞进顺序字段：裁剪生效时它必须被剔除，
    // 否则「与资料顺序同步」会把隐藏板块写回 `section_order`（验收第 3 条）。
    const order = [
      "awards",
      "summary",
      "skills",
      "campus_experience",
      "projects",
      "experience",
      "education",
    ];
    const defaults = readTemplateCatalogDefaults(
      catalogWithScope({ group_section_keys: [...GROUP_SIX], group_section_order: order }),
    );

    const expected = order.filter((key) => groupKeyVisible(key));
    expect(defaults.profileSectionOrder).toEqual(expected);
    expect(defaults.profileSectionOrder).not.toContain("summary");
    // 内置默认顺序不受组范围影响（老简历外观不追溯改变）。
    expect(defaults.builtInSectionOrder).toEqual(TEMPLATE_CATALOG.default_section_order);
    // 生成时写进 `format_config` 的 `section_order` 同样只含可见键。
    expect(defaults.applyTo(LAYOUT).format_config?.section_order).toEqual(expected);
  });

  it("自建板块 custom:<key> 原样保留（目录里有时用目录标签，顺序照组内顺序）", () => {
    const customKey = "custom:17";
    const customLabel = "Custom Section";
    const defaults = readTemplateCatalogDefaults(
      catalogWithScope(
        {
          group_section_keys: ["education", customKey],
          group_section_order: [customKey, "education"],
        },
        {
          section_options: [
            ...TEMPLATE_CATALOG.section_options,
            { key: customKey, label: customLabel },
          ],
        },
      ),
    );

    expect([...keysOf(defaults.sectionOptions)].sort()).toEqual([customKey, "education"].sort());
    // 自定义板块的展示名是用户自己起的，不能被兜底标签顶掉。
    expect(defaults.sectionOptions.find((option) => option.key === customKey)?.label).toBe(
      customLabel,
    );
    expect(defaults.profileSectionOrder).toEqual([customKey, "education"]);
    expect(defaults.applyTo(LAYOUT).format_config?.section_order).toEqual([customKey, "education"]);
  });

  it("组内键在目录标签表里查不到：补兜底标签，既不丢也不显示裸 key", () => {
    const customKey = "custom:404";
    const defaults = readTemplateCatalogDefaults(
      catalogWithScope({
        group_section_keys: ["education", "patents", customKey],
        group_section_order: ["patents", "education", customKey],
      }),
    );

    expect([...keysOf(defaults.sectionOptions)].sort()).toEqual(
      ["education", "patents", customKey].sort(),
    );
    for (const key of ["patents", customKey]) {
      const option = defaults.sectionOptions.find((item) => item.key === key);
      expect(option, `${key} 不该被丢掉`).toBeDefined();
      expect(option?.label.trim(), `${key} 必须有兜底标签`).not.toBe("");
      expect(option?.label, `${key} 不能显示裸 key`).not.toBe(key);
      expect(option?.label, `${key} 不能显示裸 key`).not.toContain("custom:");
    }
    // 兜底标签只是展示用的，顺序仍按组内顺序，一个都不少。
    expect(defaults.profileSectionOrder).toEqual(["patents", "education", customKey]);
  });

  it("组字段与目录完全对不上：整体回退全量（不显示一整列未命名板块）", () => {
    const defaults = readTemplateCatalogDefaults(
      catalogWithScope({ group_section_keys: ["alpha_unknown", "beta_unknown"] }),
    );

    expect(keysOf(defaults.sectionOptions)).toEqual(FULL_KEYS);
    expect(defaults.profileSectionOrder).toEqual(TEMPLATE_CATALOG.profile_section_order);
  });
});

/** 该键是否属于本组可见范围（`GROUP_SIX` 之外一律算被隐藏）。 */
function groupKeyVisible(key: string): boolean {
  return GROUP_SIX.includes(key);
}
