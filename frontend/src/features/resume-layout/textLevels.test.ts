// SPDX-License-Identifier: Apache-2.0
/**
 * W07-TL 文字级别的**规则层**：级别 → 对象覆盖的映射、读回状态、批量应用、恢复继承。
 *
 * 这里只测数据；工具条的交互在 `components/resume/typography/TextLevelBar*.test.tsx`。
 * 期望值故意**逐字重写**一遍（不 import 实现里的常量）：映射表是这个功能的契约，
 * 有人顺手改掉一级标题的字号/段距时，这里必须红。
 */
import { describe, expect, it } from "vitest";
import { coerceStylePropValue } from "../../utils/resumeStyleParams";
import {
  TEXT_LEVEL_LABELS,
  TEXT_LEVEL_PROPS,
  TEXT_LEVELS,
  applyTextLevel,
  clearTextLevel,
  readObjectTextLevel,
  readTextLevelState,
  textLevelPatch,
  textLevelStateKey,
  type TextLevelId,
} from "./textLevels";
import { readStyleDomains } from "./styleOverrides";

const OBJ_A = "exp_12345678";
const OBJ_B = "prj_87654321";

/** 期望映射（契约）：级别 → 对象级四项覆盖。 */
const EXPECTED_PATCHES: Record<TextLevelId, Record<string, number | boolean>> = {
  heading1: { font_scale: 1.4, bold: true, space_before: 0.4, space_after: 0.2 },
  heading2: { font_scale: 1.2, bold: true, space_before: 0.3, space_after: 0.15 },
  heading3: { font_scale: 1.08, bold: true, space_before: 0.2, space_after: 0.1 },
  body: { font_scale: 1, bold: false, space_before: 0, space_after: 0 },
  caption: { font_scale: 0.9, bold: false, space_before: 0, space_after: 0 },
};

function objectsOf(config: unknown): Record<string, Record<string, unknown>> {
  const objects = (config as { objects?: Record<string, unknown> } | null)?.objects ?? {};
  const entries: Record<string, Record<string, unknown>> = {};
  for (const [key, value] of Object.entries(objects)) {
    if (key === "version") continue;
    entries[key] = value as Record<string, unknown>;
  }
  return entries;
}

describe("textLevels · 级别定义", () => {
  it("五个级别各有显示名，映射表与契约逐项相等", () => {
    expect([...TEXT_LEVELS]).toEqual(["heading1", "heading2", "heading3", "body", "caption"]);
    for (const level of TEXT_LEVELS) {
      expect(TEXT_LEVEL_LABELS[level]).toBe(`typography.level.${level}`);
      expect(textLevelPatch(level)).toEqual(EXPECTED_PATCHES[level]);
    }
  });

  it("级别只改四项、且每项都落在写入区间内（不越界、不夹紧）", () => {
    expect([...TEXT_LEVEL_PROPS]).toEqual(["font_scale", "bold", "space_before", "space_after"]);
    for (const level of TEXT_LEVELS) {
      const patch = textLevelPatch(level);
      expect(Object.keys(patch).sort()).toEqual([...TEXT_LEVEL_PROPS].sort());
      for (const prop of TEXT_LEVEL_PROPS) {
        // 写入口的归一化必须原样返回：说明定义值在区间/步长网格上，用户看到的就是存下的。
        expect(coerceStylePropValue(prop, patch[prop])).toBe(patch[prop]);
      }
    }
  });

  it("返回副本：改它不会污染下一次应用", () => {
    const patch = textLevelPatch("heading1");
    patch.font_scale = 2;
    expect(textLevelPatch("heading1").font_scale).toBe(1.4);
  });
});

describe("textLevels · 应用与恢复", () => {
  it("应用一级标题：写入对象的四项覆盖，不动 roles 与其它扁平键", () => {
    const base = {
      accent: "#123456",
      roles: { version: 1, body: { line_height: 1.55 } },
    } as never;
    const next = applyTextLevel(base, [OBJ_A], "heading1");
    expect(next).toEqual({
      accent: "#123456",
      roles: { version: 1, body: { line_height: 1.55 } },
      objects: { version: 1, [OBJ_A]: EXPECTED_PATCHES.heading1 },
    });
  });

  it("多选批量：一次写入全部目标，逐条保留其它覆盖", () => {
    const base = {
      objects: { version: 1, [OBJ_A]: { color: "#111111" }, [OBJ_B]: { line_height: 1.5 } },
    } as never;
    const next = applyTextLevel(base, [OBJ_A, OBJ_B], "heading2");
    expect(objectsOf(next)).toEqual({
      [OBJ_A]: { color: "#111111", ...EXPECTED_PATCHES.heading2 },
      [OBJ_B]: { line_height: 1.5, ...EXPECTED_PATCHES.heading2 },
    });
  });

  it("再应用另一个级别：级别四项被整体替换（不会残留上一级的值）", () => {
    const once = applyTextLevel({} as never, [OBJ_A], "heading1");
    const twice = applyTextLevel(once, [OBJ_A], "caption");
    expect(objectsOf(twice)[OBJ_A]).toEqual(EXPECTED_PATCHES.caption);
  });

  it("恢复跟随模板：只删级别四项，保留用户其它局部调整；空条目整条删掉", () => {
    const base = {
      objects: {
        version: 1,
        [OBJ_A]: { color: "#123456", ...EXPECTED_PATCHES.heading1 },
        [OBJ_B]: { color: "#654321" },
      },
    } as never;
    const next = clearTextLevel(base, [OBJ_A, OBJ_B]);
    expect(objectsOf(next)).toEqual({
      [OBJ_A]: { color: "#123456" },
      [OBJ_B]: { color: "#654321" },
    });
    // 全是级别属性的对象：删空后条目消失，只剩 version 时整域也删掉。
    expect(clearTextLevel(applyTextLevel({}, [OBJ_A], "body"), [OBJ_A])).toEqual({});
  });

  it("没有可清的目标时返回原配置引用（宿主不必写库）", () => {
    const base = { accent: "#123456" } as never;
    expect(clearTextLevel(base, [OBJ_A])).toBe(base);
    expect(clearTextLevel(base, [])).toBe(base);
  });

  it("非法 / 空目标：不写入垃圾键", () => {
    const base = { accent: "#123456" } as never;
    expect(applyTextLevel(base, [], "heading1")).toEqual({ accent: "#123456" });
    expect(objectsOf(applyTextLevel(base, ["short"], "heading1"))).toEqual({});
  });
});

describe("textLevels · 读回当前级别", () => {
  it("没有级别覆盖 = 跟随模板；只有颜色/缩进等其它覆盖也算跟随", () => {
    const domains = readStyleDomains({
      objects: { version: 1, [OBJ_A]: { color: "#123456", indent: 0.5 } },
    } as never);
    expect(readObjectTextLevel(domains, OBJ_A)).toEqual({ kind: "inherit" });
    expect(readObjectTextLevel(domains, "exp_missing01")).toEqual({ kind: "inherit" });
  });

  it("每个级别写入后都能被反推回来（应用 → 读回闭环）", () => {
    for (const level of TEXT_LEVELS) {
      const domains = readStyleDomains(applyTextLevel({}, [OBJ_A], level));
      expect(readObjectTextLevel(domains, OBJ_A)).toEqual({ kind: "level", level });
    }
  });

  it("有级别属性但对不上任何固定级别 = 自定义", () => {
    const domains = readStyleDomains({
      objects: { version: 1, [OBJ_A]: { font_scale: 1.31 } },
    } as never);
    expect(readObjectTextLevel(domains, OBJ_A)).toEqual({ kind: "custom" });
  });

  it("多选：全部一致给那一档，否则多个级别", () => {
    const same = readStyleDomains(applyTextLevel({}, [OBJ_A, OBJ_B], "heading3"));
    expect(readTextLevelState(same, [OBJ_A, OBJ_B])).toEqual({ kind: "level", level: "heading3" });
    const mixed = readStyleDomains(
      applyTextLevel(applyTextLevel({}, [OBJ_B], "heading1"), [OBJ_A], "body"),
    );
    expect(readTextLevelState(mixed, [OBJ_A, OBJ_B])).toEqual({ kind: "mixed" });
    expect(readTextLevelState(mixed, [])).toEqual({ kind: "inherit" });
  });

  it("状态比较键：级别名区分、非级别状态按 kind", () => {
    expect(textLevelStateKey({ kind: "level", level: "heading1" })).toBe("level:heading1");
    expect(textLevelStateKey({ kind: "inherit" })).toBe("inherit");
    expect(textLevelStateKey({ kind: "mixed" })).toBe("mixed");
  });
});
