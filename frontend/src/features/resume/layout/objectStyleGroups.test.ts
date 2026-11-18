// SPDX-License-Identifier: Apache-2.0
/**
 * I-21：分组口径与"不丢属性"。
 *
 * 浮层把 11 个属性折成四组，界面顺序 = `OBJECT_STYLE_GROUPS` 顺序；组内顺序跟随调用方
 * 给的行清单（面板里那一份来自角色白名单，不能在这里重排）。
 */
import { describe, expect, it } from "vitest";
import { t } from "../../../i18n";
import { OBJECT_STYLE_PROPS } from "./styleCatalog";
import { OBJECT_STYLE_GROUPS, groupStyleRows } from "./objectStyleGroups";

describe("objectStyleGroups · 口径", () => {
  it("11 个对象属性每一项恰好落在一组里（不漏、不重）", () => {
    for (const prop of OBJECT_STYLE_PROPS) {
      const owners = OBJECT_STYLE_GROUPS.filter((group) => group.props.includes(prop));
      expect(owners.map((group) => group.id)).toHaveLength(1);
    }
    const listed = OBJECT_STYLE_GROUPS.flatMap((group) => group.props);
    expect(new Set(listed).size).toBe(OBJECT_STYLE_PROPS.length);
  });

  it("四组的组头文案都有词条（界面不出现中文常量）", () => {
    for (const group of OBJECT_STYLE_GROUPS) {
      expect(t(group.label).trim().length).toBeGreaterThan(0);
      expect(t(group.label)).not.toBe(group.label);
    }
  });

  it("组内顺序跟随传入行清单，空组整块不返回", () => {
    // 单字段作用域（灰字字段）：没有对齐 / 项目符号 / 日期位置。
    const grouped = groupStyleRows(["letter_spacing", "color", "line_height", "indent"]);
    expect(grouped.map((entry) => entry.group.id)).toEqual(["text", "spacing", "meta"]);
    expect(grouped[0].rows).toEqual(["color"]);
    expect(grouped[1].rows).toEqual(["line_height", "indent"]);
    expect(grouped[2].rows).toEqual(["letter_spacing"]);
  });
});
