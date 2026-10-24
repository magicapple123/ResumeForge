// SPDX-License-Identifier: Apache-2.0
/**
 * 「恢复到打开时的值」（参数行右侧那颗 ↺）的契约。
 *
 * 三件必须钉住的事：
 * 1. **没改过就不出现**——一排 ↺ 常驻会让参数栏看起来像"到处都是待办"；
 * 2. **恢复的是打开时的取值，不是模板默认值**：基线里那一条覆盖（例如上次存下来的
 *    行距 1.8）必须原样搬回来，而不是删键回到模板的 1.7；
 * 3. **动作只改这一组键**：恢复行距不能顺手把强调色也写回去。
 *
 * 组件层用例同时覆盖"行距"与"颜色"两条路径：前者是滑杆（带防抖与来源胶囊），
 * 后者是自绘行（没有胶囊，只有 head 里那一格）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TEMPLATE_CATALOG } from "../../test/resumeFixtures";
import type { ResumeLayout } from "../../types";
import ResumeColorControls from "./ResumeColorControls";
import ResumeMeasureControls from "./ResumeMeasureControls";

const BASELINE: ResumeLayout = {
  template: "classic",
  format_name: "",
  page_limit: 1,
  font_scale: "standard",
  // 打开时用户就已经手调过行距与强调色：恢复必须把这**两个覆盖**搬回来。
  format_config: { line_height: 1.8, accent: "#111111" },
};

function renderMeasure(layout: ResumeLayout, baseline?: ResumeLayout) {
  const onChange = vi.fn();
  render(
    <AntdApp>
      <ResumeMeasureControls
        layout={layout}
        baseline={baseline}
        catalog={TEMPLATE_CATALOG}
        onChange={onChange}
      />
    </AntdApp>,
  );
  return onChange;
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("参数复位 · 行距", () => {
  it("与打开时一致时不出现恢复按钮", () => {
    renderMeasure(BASELINE, BASELINE);
    expect(screen.queryByRole("button", { name: /恢复到打开时的值/ })).toBeNull();
  });

  it("拖过之后再点 ↺，把基线里那条**覆盖值**搬回来（不是删键回模板）", () => {
    const changed: ResumeLayout = {
      ...BASELINE,
      format_config: { ...BASELINE.format_config, line_height: 1.5 },
    };
    const onChange = renderMeasure(changed, BASELINE);

    fireEvent.click(screen.getByRole("button", { name: /把行距恢复到打开时的值/ }));

    const next = onChange.mock.calls[0][0] as ResumeLayout;
    // 1.8 是打开时看到的那个数；模板默认 1.7 是**第三个值**，恢复不该落到它上面。
    expect(next.format_config).toEqual({ line_height: 1.8, accent: "#111111" });
    // 其它版式字段一个都不动。
    expect(next.page_limit).toBe(changed.page_limit);
    expect(next.font_scale).toBe(changed.font_scale);
  });

  it("基线里没有这条覆盖时，恢复 = 删键", () => {
    const baseline: ResumeLayout = { ...BASELINE, format_config: { accent: "#111111" } };
    const changed: ResumeLayout = {
      ...BASELINE,
      format_config: { accent: "#111111", line_height: 1.5 },
    };
    const onChange = renderMeasure(changed, baseline);

    fireEvent.click(screen.getByRole("button", { name: /把行距恢复到打开时的值/ }));

    expect((onChange.mock.calls[0][0] as ResumeLayout).format_config).toEqual({
      accent: "#111111",
    });
  });

  it("没有基线（别的宿主）时一颗都不出现", () => {
    const changed: ResumeLayout = {
      ...BASELINE,
      format_config: { ...BASELINE.format_config, line_height: 1.5 },
    };
    renderMeasure(changed);
    expect(screen.queryByRole("button", { name: /恢复到打开时的值/ })).toBeNull();
  });
});

describe("参数复位 · 颜色", () => {
  it("改过强调色后点 ↺，只恢复这一个键", () => {
    const changed: ResumeLayout = {
      ...BASELINE,
      format_config: { line_height: 1.5, accent: "#222222" },
    };
    const onChange = vi.fn();
    render(
      <AntdApp>
        <ResumeColorControls
          layout={changed}
          baseline={BASELINE}
          catalog={TEMPLATE_CATALOG}
          onChange={onChange}
        />
      </AntdApp>,
    );

    fireEvent.click(screen.getByRole("button", { name: /把强调色恢复到打开时的值/ }));

    // 行距那 1.5 是"当前值"，不属于这次恢复的范围，必须原样留着。
    expect((onChange.mock.calls[0][0] as ResumeLayout).format_config).toEqual({
      line_height: 1.5,
      accent: "#111111",
    });
  });
});
