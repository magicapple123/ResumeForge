// SPDX-License-Identifier: Apache-2.0
/**
 * 局部排版探针 CSS：拖动中即时反馈（D02）。
 *
 * 字符串逐字断言——**与后端 resume_style._role_rule / _object_spatial_rules 的产出保持
 * 同一结构**：两空格缩进、声明顺序同 STYLE_PROPS、字号是 calc(var(--fs) * 系数 * 基准)，
 * 项目符号 / 缩进 / 日期位置落到与后端相同的定向选择器上。改这里等于改"拖动中看到的样子"。
 */
import { describe, expect, it } from "vitest";
import { styleProbeCss } from "./resumeFormatProbe";

describe("styleProbeCss · 选择器与结构", () => {
  it("角色目标用 data-role；对象目标用 data-object-id", () => {
    expect(styleProbeCss({ role: "body" }, { line_height: 1.55 })).toBe(
      `  [data-role="body"] { line-height: 1.55 !important; }`,
    );
    expect(styleProbeCss({ objectId: "exp_12345678" }, { bold: true })).toBe(
      `  [data-object-id="exp_12345678"] { font-weight: 700 !important; }`,
    );
  });

  it("对象 + 角色（Q12 子范围）→ 文字属性落 [data-object-id] [data-role]", () => {
    expect(
      styleProbeCss({ objectId: "exp_12345678", role: "entry_title" }, { color: "#abcdef" }),
    ).toBe(
      `  [data-object-id="exp_12345678"] [data-role="entry_title"] { color: #abcdef !important; }`,
    );
  });

  it("非法目标 / 空覆盖返回空串（清掉探针）", () => {
    expect(styleProbeCss({}, { bold: true })).toBe("");
    expect(styleProbeCss({ role: "body" }, {})).toBe("");
    expect(styleProbeCss({ objectId: "x;}</style>" }, { bold: true })).toBe("");
    expect(styleProbeCss({ role: "Body!" }, { bold: true })).toBe("");
  });

  it("声明按后端 STYLE_PROPS 顺序输出（与面板行序同源）", () => {
    expect(styleProbeCss({ role: "body" }, { align: "center", bold: true, color: "#abcdef" })).toBe(
      `  [data-role="body"] { color: #abcdef !important; font-weight: 700 !important; text-align: center !important; }`,
    );
  });
});

describe("styleProbeCss · 与后端 role_style_css 输出的逐条对拍", () => {
  it("同一份覆盖：文字属性一条规则 + 项目符号一条 ul 规则", () => {
    // 后端（Q11 起，classic）：
    //   '  [data-role="body"] { font-size: calc(var(--fs) * 1.05 * 1); line-height: 1.55; }'
    //   '  ul { list-style-type: '–'; }'
    expect(
      styleProbeCss(
        { role: "body" },
        { font_scale: 1.05, line_height: 1.55, bullet: "dash" },
        { baseRatios: { body: 1 } },
      ),
    ).toBe(
      [
        `  [data-role="body"] { font-size: calc(var(--fs) * 1.05 * 1) !important; line-height: 1.55 !important; }`,
        `  ul { list-style-type: '–' !important; }`,
      ].join("\n"),
    );
    // 对象级（后端 entry_style_css：根规则 + .entry-head 定向规则）。
    expect(
      styleProbeCss({ objectId: "exp_12345678" }, { space_before: 0.6, meta_align: "right" }),
    ).toBe(
      [
        `  [data-object-id="exp_12345678"] { margin-top: calc(var(--fs) * 0.6) !important; }`,
        `  [data-object-id="exp_12345678"] .entry-head { justify-content: space-between !important; }`,
      ].join("\n"),
    );
  });

  it("缩进 / 日期位置落到载体元素（Q11：写在条目根/li 上不生效）", () => {
    expect(styleProbeCss({ role: "body" }, { indent: 1.6 })).toBe(
      `  ul, .body-paragraph { padding-left: calc(var(--fs) * 1.6) !important; }`,
    );
    expect(styleProbeCss({ objectId: "exp_12345678" }, { indent: 1.6 })).toBe(
      `  [data-object-id="exp_12345678"] ul, [data-object-id="exp_12345678"] .body-paragraph { padding-left: calc(var(--fs) * 1.6) !important; }`,
    );
    expect(styleProbeCss({ role: "meta" }, { meta_align: "inline" })).toBe(
      `  .entry-head { justify-content: flex-start !important; }`,
    );
    expect(styleProbeCss({ objectId: "exp_12345678" }, { meta_align: "inline" })).toBe(
      `  [data-object-id="exp_12345678"] .entry-head { justify-content: flex-start !important; }`,
    );
  });
});

describe("styleProbeCss · 声明", () => {
  it("布尔 / 颜色 / 枚举逐一映射（与后端 bullet/meta_align 字面量一致）", () => {
    expect(styleProbeCss({ role: "body" }, { bold: false, italic: true })).toBe(
      `  [data-role="body"] { font-weight: 400 !important; font-style: italic !important; }`,
    );
    expect(styleProbeCss({ role: "body" }, { color: "#AbCdEf" })).toBe(
      `  [data-role="body"] { color: #AbCdEf !important; }`,
    );
    expect(styleProbeCss({ role: "body" }, { bullet: "dash" })).toBe(
      `  ul { list-style-type: '–' !important; }`,
    );
    // 三出口统一符号字形：圆点 = 「·」（不是 disc 实心圆点）。
    expect(styleProbeCss({ role: "body" }, { bullet: "dot" })).toBe(
      `  ul { list-style-type: '·' !important; }`,
    );
    expect(styleProbeCss({ role: "section_title" }, { align: "center" })).toBe(
      `  [data-role="section_title"] { text-align: center !important; }`,
    );
  });

  it("系数字段合成 calc(var(--fs) * N)", () => {
    expect(styleProbeCss({ role: "body" }, { space_before: 0.6 })).toBe(
      `  [data-role="body"] { margin-top: calc(var(--fs) * 0.6) !important; }`,
    );
    expect(styleProbeCss({ role: "name" }, { letter_spacing: 0.05 })).toBe(
      `  [data-role="name"] { letter-spacing: calc(var(--fs) * 0.05) !important; }`,
    );
  });

  it("字号是「系数 × 基准」两层结构（与后端 role_style_css 一致）", () => {
    // 面板传显示值 1.88（= 系数 1.01075… × 基准 1.86）。
    expect(
      styleProbeCss({ role: "name" }, { font_scale: 1.88 }, { baseRatios: { name: 1.86 } }),
    ).toBe(`  [data-role="name"] { font-size: calc(var(--fs) * 1.01075 * 1.86) !important; }`);
  });

  it("目录没给基准时字号退回数值等价形式（不产出错误的两层结构）", () => {
    expect(styleProbeCss({ role: "name" }, { font_scale: 1.05 })).toBe(
      `  [data-role="name"] { font-size: calc(var(--fs) * 1.05) !important; }`,
    );
  });

  it("非法值不产生半条规则", () => {
    expect(styleProbeCss({ role: "body" }, { color: "red", align: "middle" })).toBe("");
    expect(styleProbeCss({ role: "body" }, { line_height: 1.55, color: "red" })).toBe(
      `  [data-role="body"] { line-height: 1.55 !important; }`,
    );
  });
});
