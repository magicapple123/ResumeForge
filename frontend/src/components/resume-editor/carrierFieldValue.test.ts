// SPDX-License-Identifier: Apache-2.0
/**
 * 承载区「标签：值」行的读写（需求 #5）：
 * 系统板块自定义字段的值 = 承载区里的一行文本，读写必须与纸面投影（`_build_entry`）同口径。
 */
import { describe, expect, it } from "vitest";
import { carrierLineValue, readCarrierField, writeCarrierField } from "./carrierFieldValue";

const MENTOR = "导师姓名";

describe("carrierLineValue（判断某行是不是这个字段）", () => {
  it("认行首标签 + 全角/半角冒号，冒号前后空白都算", () => {
    expect(carrierLineValue(`${MENTOR}：张伟`, MENTOR)).toBe("张伟");
    expect(carrierLineValue(`  ${MENTOR} :  张伟 `, MENTOR)).toBe("张伟");
    expect(carrierLineValue(`${MENTOR}：`, MENTOR)).toBe("");
  });

  it("前缀相同的另一个标签不误命中（中间不是冒号）", () => {
    expect(carrierLineValue(`${MENTOR}电话：123`, MENTOR)).toBeNull();
  });

  it("普通正文行、空标签都不算", () => {
    expect(carrierLineValue("做了 X", MENTOR)).toBeNull();
    expect(carrierLineValue(`${MENTOR}：张伟`, "")).toBeNull();
  });
});

describe("readCarrierField / writeCarrierField", () => {
  it("数组承载区：原位替换，值不变时幂等（再写一次不会多一行）", () => {
    const carrier = ["项目正文", `${MENTOR}：张伟`];
    expect(readCarrierField(carrier, MENTOR)).toBe("张伟");
    const next = writeCarrierField(carrier, MENTOR, "李娜", true);
    expect(next).toEqual(["项目正文", `${MENTOR}：李娜`]);
    expect(writeCarrierField(next, MENTOR, "李娜", true)).toEqual(next);
  });

  it("清空字段 = 删掉该行（与纸面投影「只追加有值字段」一致）", () => {
    expect(writeCarrierField(["正文", `${MENTOR}：张伟`], MENTOR, "  ", true)).toEqual(["正文"]);
  });

  it("没有该行时追加到末尾（与纸面 extras 的追加顺序同口径）", () => {
    expect(writeCarrierField(["正文"], MENTOR, "张伟", true)).toEqual(["正文", `${MENTOR}：张伟`]);
    expect(writeCarrierField([], MENTOR, "张伟", true)).toEqual([`${MENTOR}：张伟`]);
  });

  it("标量承载区（skills.level / publications.note）产出字符串", () => {
    expect(writeCarrierField("旧备注", MENTOR, "张伟", false)).toBe(`旧备注\n${MENTOR}：张伟`);
    expect(readCarrierField(`旧备注\n${MENTOR}：张伟`, MENTOR)).toBe("张伟");
  });

  it("承载区当前值缺失时按 carrier_list 决定产出类型", () => {
    expect(writeCarrierField(undefined, MENTOR, "张伟", true)).toEqual([`${MENTOR}：张伟`]);
    expect(writeCarrierField(undefined, MENTOR, "张伟", false)).toBe(`${MENTOR}：张伟`);
  });

  it("重复行合并成一行，历史数据不会越存越多", () => {
    const carrier = [`${MENTOR}：张伟`, "正文", `${MENTOR}:张伟`];
    expect(writeCarrierField(carrier, MENTOR, "李娜", true)).toEqual([`${MENTOR}：李娜`, "正文"]);
  });
});
