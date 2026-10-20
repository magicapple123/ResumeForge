// SPDX-License-Identifier: Apache-2.0
/**
 * 换版式时"参数跟着变"（2026-10-20）。
 *
 * 渲染优先级是 **模板默认 < 版式预设 < 手动微调**。用户之前拖过行距/页边距，
 * `format_config` 里就一直是手动值，此时再选「紧凑」只是换了个名字：
 * 预览不动、滑杆也不动。所以换版式时必须把会被预设覆盖的手动键清掉。
 *
 * 纯函数，直接测（不必渲染整套控件再模拟 antd Select）。
 */
import { describe, expect, it } from "vitest";
import { layoutWithFormatPreset } from "./ResumeTemplateControls";
import type { ResumeFormatConfig, ResumeLayout } from "../../types";

const PRESETS: { name: string; config: ResumeFormatConfig }[] = [
  { name: "standard", config: {} },
  { name: "compact", config: { line_height: 1.45, page_padding: 11, section_gap: 0.85 } },
  { name: "mono_accent", config: { accent: "#374151", line_color: "#d1d5db" } },
];

const BASE: ResumeLayout = {
  template: "classic",
  format_name: "",
  page_limit: 1,
  font_scale: "standard",
  format_config: { line_height: 1.9, page_padding: 18, accent: "#123456", font_scale_adjust: 1.1 },
};

describe("layoutWithFormatPreset", () => {
  it("清掉会被新预设覆盖的手动值，其余覆盖保留", () => {
    const next = layoutWithFormatPreset(BASE, "compact", PRESETS);

    expect(next.format_name).toBe("compact");
    expect(next.format_config).not.toHaveProperty("line_height");
    expect(next.format_config).not.toHaveProperty("page_padding");
    // 强调色属于"版式会管"的键（「单色强调」就改它），换版式时一并清掉；
    // 字号系数不在版式范围内，必须留给用户。
    expect(next.format_config).not.toHaveProperty("accent");
    expect(next.format_config?.font_scale_adjust).toBe(1.1);
  });

  it("回到「模板自带」也会清掉手动值，滑杆回到模板默认", () => {
    const next = layoutWithFormatPreset(BASE, "", PRESETS);

    expect(next.format_name).toBe("");
    expect(next.format_config).not.toHaveProperty("line_height");
    expect(next.format_config).not.toHaveProperty("page_padding");
    // 强调色属于"版式会管"的键，一并清掉。
    expect(next.format_config).not.toHaveProperty("accent");
    expect(next.format_config?.font_scale_adjust).toBe(1.1);
  });

  it("不动 layout 的其它字段（页数、模板、字号档）", () => {
    const next = layoutWithFormatPreset({ ...BASE, page_limit: 2 }, "compact", PRESETS);
    expect(next.page_limit).toBe(2);
    expect(next.template).toBe("classic");
    expect(next.font_scale).toBe("standard");
  });
});
