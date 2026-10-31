// SPDX-License-Identifier: Apache-2.0
/**
 * 格式刷规则（wave2 契约 §2.5）：复制的是**显式差异**而不是解析后的绝对值；
 * "固化为局部调整"是显式的第二动作。
 */
import { describe, expect, it } from "vitest";
import { readStyleDomains, withObjectProp, withRoleProp } from "./styleOverrides";
import {
  applyPainterPatch,
  freezeObjectRoleStyle,
  freezeObjectStyle,
  painterPatch,
} from "./stylePainter";

const SRC = "exp_12345678";
const DST = "prj_87654321";

describe("stylePainter · 复制差异", () => {
  it("没有显式覆盖时返回 null（界面据此置灰）", () => {
    expect(painterPatch(readStyleDomains({}), SRC)).toBeNull();
    expect(painterPatch(readStyleDomains({}), null)).toBeNull();
  });

  it("只复制对象级的显式差异，不夹带角色值", () => {
    const config = withRoleProp({}, "body", "line_height", 1.55);
    const withObject = withObjectProp(config, SRC, "bullet", "dash");
    const patch = painterPatch(readStyleDomains(withObject), SRC);
    expect(patch).toEqual({ bullet: "dash" });
  });
});

describe("stylePainter · 应用", () => {
  it("写入多个目标，保留各自其它覆盖", () => {
    const base = withObjectProp({}, DST, "align", "center");
    const next = applyPainterPatch(base, [SRC, DST], { bullet: "dash" });
    expect(next).toEqual({
      objects: {
        version: 1,
        [SRC]: { bullet: "dash" },
        [DST]: { align: "center", bullet: "dash" },
      },
    });
  });

  it("空补丁是空操作（返回原配置引用）", () => {
    const base = withObjectProp({}, DST, "align", "center");
    expect(applyPainterPatch(base, [DST], null)).toBe(base);
    expect(applyPainterPatch(base, [DST], {})).toBe(base);
  });
});

describe("stylePainter · 固化为局部调整", () => {
  it("把当前生效的段落级值写成显式覆盖，之后不再随角色变化", () => {
    const config = fromResolved();
    expect(config).toEqual({
      objects: {
        version: 1,
        [SRC]: { font_scale: 1.05, space_before: 0.6, line_height: 1.55, bullet: "dash" },
      },
    });
    // 来源判定：对象级（本条已调整）
    const domains = readStyleDomains(config);
    expect(domains.objects[SRC]).toBeDefined();
  });

  it("非法值被丢弃；字号按系数落库", () => {
    const config = freezeObjectStyle({}, SRC, {
      font_scale: 1.1,
      line_height: 1.4,
      align: "middle",
    } as never);
    expect(config).toEqual({
      objects: { version: 1, [SRC]: { font_scale: 1.1, line_height: 1.4 } },
    });
  });
});

describe("stylePainter · 子范围固化（Q12/Q14）", () => {
  it("只写 object_roles，不动 objects 与其它角色（条目头 / 正文 / 灰字按范围执行）", () => {
    const config = freezeObjectRoleStyle({}, SRC, "body", {
      indent: 0.5,
      line_height: 1.4,
      bold: true,
    } as never);
    expect(config).toEqual({
      object_roles: {
        version: 1,
        [`${SRC}:body`]: { indent: 0.5, line_height: 1.4, bold: true },
      },
    });
  });

  it("角色不允许的属性被丢弃（灰字没有段距 / 缩进）", () => {
    const config = freezeObjectRoleStyle({}, SRC, "meta", {
      color: "#123c69",
      indent: 0.5,
    } as never);
    expect(config).toEqual({
      object_roles: { version: 1, [`${SRC}:meta`]: { color: "#123c69" } },
    });
  });
});

function fromResolved() {
  return freezeObjectStyle({}, SRC, {
    space_before: 0.6,
    line_height: 1.55,
    bullet: "dash",
    font_scale: 1.05,
  });
}
