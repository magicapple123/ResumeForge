// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { TRASH_TYPES, UNDO_MAX_IDS } from "./trashType";

describe("回收站类型闭集", () => {
  it("与后端 TRASH_SPECS 一样是 15 类", () => {
    // backend/app/services/trash.py 的 TRASH_SPECS 是本表的唯一来源；两边不一致时，
    // 撤销会传一个后端不认识的 type_key，表现是"点了撤销什么都没恢复"。
    expect(TRASH_TYPES).toHaveLength(15);
  });

  it("key 唯一且都是下划线小写", () => {
    expect(new Set(TRASH_TYPES).size).toBe(TRASH_TYPES.length);
    for (const key of TRASH_TYPES) expect(key).toMatch(/^[a-z_]+$/);
  });

  it("撤销上限是 100（超过属必须二次确认的区间）", () => {
    expect(UNDO_MAX_IDS).toBe(100);
  });
});
