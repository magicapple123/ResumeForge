// SPDX-License-Identifier: Apache-2.0
/** 简历分区顺序：调序边界与版式覆盖的写入规则。
 *
 * 默认顺序本身的跨端一致性由 `backend/tests/test_resume_section_order_parity.py` 钉住，
 * 这里只钉前端工具函数的行为（越界、不可变、覆盖项写入/删除）。
 */

import { describe, expect, it } from "vitest";
import {
  buildSectionOrderConfig,
  DEFAULT_RESUME_SECTION_ORDER,
  moveSection,
} from "./resumeSectionOrder";

describe("moveSection", () => {
  const order = ["a", "b", "c"];

  it("交换相邻两项", () => {
    expect(moveSection(order, 1, -1)).toEqual(["b", "a", "c"]);
    expect(moveSection(order, 1, 1)).toEqual(["a", "c", "b"]);
  });

  it("越界时原样返回同一个引用（调用方靠引用相等跳过提交）", () => {
    expect(moveSection(order, 0, -1)).toBe(order);
    expect(moveSection(order, 2, 1)).toBe(order);
    expect(moveSection(order, -1, 1)).toBe(order);
  });

  it("不改动原数组", () => {
    moveSection(order, 0, 1);
    expect(order).toEqual(["a", "b", "c"]);
  });
});

describe("buildSectionOrderConfig", () => {
  it("资料顺序与内置默认不同时写进 section_order", () => {
    const profileOrder = [
      "projects",
      ...DEFAULT_RESUME_SECTION_ORDER.filter((k) => k !== "projects"),
    ];
    expect(buildSectionOrderConfig(profileOrder, DEFAULT_RESUME_SECTION_ORDER)).toEqual({
      section_order: profileOrder,
    });
  });

  it("与内置默认相同时不写这个键（没调过与调成一样要长得一样）", () => {
    expect(
      buildSectionOrderConfig(DEFAULT_RESUME_SECTION_ORDER, DEFAULT_RESUME_SECTION_ORDER),
    ).toEqual({});
  });

  it("保留其它版式覆盖，只负责这一个键", () => {
    const profileOrder = ["awards", ...DEFAULT_RESUME_SECTION_ORDER.filter((k) => k !== "awards")];
    expect(
      buildSectionOrderConfig(profileOrder, DEFAULT_RESUME_SECTION_ORDER, {
        accent: "#123456",
        font_scale_adjust: 0.5,
      }),
    ).toEqual({ accent: "#123456", font_scale_adjust: 0.5, section_order: profileOrder });
  });

  it("从「不同」回到「相同」时会把这个键删掉，而不是留着旧值", () => {
    const base = { section_order: ["awards", "summary"] };
    expect(
      buildSectionOrderConfig(DEFAULT_RESUME_SECTION_ORDER, DEFAULT_RESUME_SECTION_ORDER, base),
    ).toEqual({});
  });
});
