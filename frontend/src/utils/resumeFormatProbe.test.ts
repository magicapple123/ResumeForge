// SPDX-License-Identifier: Apache-2.0
/**
 * 版式探针（项 6 / D10）：**与后端 `css_rule` 逐字一致**才叫"即时预览"。
 *
 * 这里逐字断言两个字符串，不是"包含某个子串"——探针与真实渲染只要差一个空格、一个
 * `!important` 的位置、或者 `1.7` vs `1.70000` 的数字格式，用户就会看到"松手后跳一下"。
 * 后端侧由 `backend/tests/test_export_format_config.py` 钉住同一对字面量（两端各钉一次）。
 */
import { describe, expect, it } from "vitest";
import { formatG, lineHeightProbeCss, pagePaddingProbeCss } from "./resumeFormatProbe";

describe('formatG 复刻 Python 的 f"{value:g}"', () => {
  it("整数不带小数点，尾零被去掉", () => {
    expect(formatG(14)).toBe("14");
    expect(formatG(1.7)).toBe("1.7");
    // 1.70 与 1.7 是同一个数：`round` 后是 1.7，`%g` 也只输出 1.7。
    expect(formatG(1.7)).toBe("1.7");
    expect(formatG(13.5)).toBe("13.5");
  });

  it("小数尾巴按 6 位有效数字收敛（与 Python 的默认精度一致）", () => {
    expect(formatG(1.23456789)).toBe("1.23457");
    // 行距的步长是 0.05，落到 2 位小数；这里确认不会冒出 1.7000000000000002。
    expect(formatG(1.7000000000000002)).toBe("1.7");
    expect(formatG(1.9500000000000002)).toBe("1.95");
  });

  it("非有限值给一个可用的兜底，而不是 NaN 字符串", () => {
    expect(formatG(Number.NaN)).toBe("0");
    expect(formatG(Number.POSITIVE_INFINITY)).toBe("0");
  });
});

describe("两个探针与后端 FORMAT_FIELDS 的 css_rule 逐字一致", () => {
  it("行距", () => {
    // 后端 resume_template_format.py:36 → "body { line-height: %s !important; }"
    expect(lineHeightProbeCss(1.7)).toBe("body { line-height: 1.7 !important; }");
    expect(lineHeightProbeCss(1.45)).toBe("body { line-height: 1.45 !important; }");
    expect(lineHeightProbeCss(2)).toBe("body { line-height: 2 !important; }");
  });

  it("页边距", () => {
    // 后端 resume_template_format.py:45 → "body { padding: %smm !important; }"
    expect(pagePaddingProbeCss(14)).toBe("body { padding: 14mm !important; }");
    expect(pagePaddingProbeCss(8)).toBe("body { padding: 8mm !important; }");
    expect(pagePaddingProbeCss(26)).toBe("body { padding: 26mm !important; }");
  });
});
