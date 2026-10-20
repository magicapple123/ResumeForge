// SPDX-License-Identifier: Apache-2.0
/**
 * 版式控件 · 第二组「度量类」：字号 / 行距 / 页边距。
 *
 * P2 拆组（D4）之后这一组自持了"拖动中状态 + `layoutRef` + 防抖提交"，本文件守三件事：
 * 1. 三个控件各自只写自己那个 `format_config` 键，其余覆盖原样带过去；
 * 2. 页边距的默认值来自**当前模板**的 `padding_mm`（换模板就换值，不是写死 14）；
 * 3. 复位 = **删键**（回到随模板），不是写回一个和默认相等的值——否则以后模板改默认值，
 *    这些简历不会跟着变。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TEMPLATE_CATALOG } from "../../test/resumeFixtures";
import type { ResumeLayout } from "../../types";
import { DEFAULT_LAYOUT, makePreviewRef, pressArrow } from "../ResumeLayoutControls.testkit";
import ResumeMeasureControls from "./ResumeMeasureControls";

const BASE: ResumeLayout = {
  ...DEFAULT_LAYOUT,
  format_config: { accent: "#123456" },
};

function renderGroup(
  props: Partial<ComponentProps<typeof ResumeMeasureControls>> = {},
  onChange = vi.fn(),
) {
  render(
    <AntdApp>
      <ResumeMeasureControls
        layout={BASE}
        catalog={TEMPLATE_CATALOG}
        onChange={onChange}
        {...props}
      />
    </AntdApp>,
  );
  return onChange;
}

function lastLayout(onChange: ReturnType<typeof vi.fn>): ResumeLayout {
  const calls = onChange.mock.calls;
  return calls[calls.length - 1]?.[0] as ResumeLayout;
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("ResumeMeasureControls · 字号", () => {
  it("拖动即时改探针、静置后提交一次，且只写 font_scale_adjust", async () => {
    const { ref, setLiveProbe } = makePreviewRef();
    const onChange = renderGroup({ previewRef: ref });

    const slider = await screen.findByRole("slider", { name: /字号/ });
    expect(slider).toHaveAttribute("aria-valuenow", "14");
    pressArrow(slider, "ArrowRight");

    // 拖动中：只动本地探针，不发请求。
    expect(setLiveProbe).toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const next = lastLayout(onChange);
    expect(next.font_scale).toBe("standard");
    // 14.1 / 14 ≈ 1.007：落库形态仍是"档位 + 系数"。
    expect(Number(next.format_config?.font_scale_adjust)).toBeCloseTo(1.007, 2);
    // 强调色是另一项覆盖，不被这次提交覆盖掉。
    expect(next.format_config?.accent).toBe("#123456");
  });
});

describe("ResumeMeasureControls · 行距", () => {
  it("按当前模板的默认值起步，±0.05 只写 line_height", async () => {
    const onChange = renderGroup();

    // classic 的默认行距 1.70 由目录下发，不是写死的 1.7。
    expect(await screen.findByText("1.70")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "减小行距" }));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const next = lastLayout(onChange);
    expect(next.format_config?.line_height).toBe(1.65);
    expect(next.format_config?.accent).toBe("#123456");
  });
});

describe("ResumeMeasureControls · 拖动即时探针（项 6 / D10）", () => {
  /**
   * 探针必须是**后端那条规则的逐字副本**：差一个空格或数字格式，用户就会看到
   * "松手后跳一下"（拖动中是探针，松手后是真实渲染）。这里直接断言字符串原文。
   */
  it("行距：拖动注入 body { line-height: … !important; }，复位清空", async () => {
    const { ref, setLiveProbe } = makePreviewRef();
    renderGroup({
      layout: { ...BASE, format_config: { accent: "#123456", line_height: 1.6 } },
      previewRef: ref,
    });

    expect(await screen.findByText("1.60")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "减小行距" }));
    expect(setLiveProbe).toHaveBeenLastCalledWith("body { line-height: 1.55 !important; }");

    // 复位 = 回到随模板：探针必须清掉，否则画面还停在一个已不存在的状态上。
    fireEvent.doubleClick(screen.getByText("行距"));
    expect(setLiveProbe).toHaveBeenLastCalledWith("");
  });

  it("页边距：拖动注入 body { padding: …mm !important; }，复位清空", async () => {
    const { ref, setLiveProbe } = makePreviewRef();
    renderGroup({
      layout: { ...BASE, format_config: { accent: "#123456", page_padding: 14 } },
      previewRef: ref,
    });

    expect(await screen.findByText("14mm")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "增大页边距" }));
    expect(setLiveProbe).toHaveBeenLastCalledWith("body { padding: 15mm !important; }");

    fireEvent.doubleClick(screen.getByText("页边距"));
    expect(setLiveProbe).toHaveBeenLastCalledWith("");
  });
});

describe("ResumeMeasureControls · 页边距", () => {
  it("没设过时停在模板默认 14mm，并标「随模板」；双击标题不产生变更", async () => {
    const onChange = renderGroup();

    const slider = await screen.findByRole("slider", { name: /页边距/ });
    expect(slider).toHaveAttribute("aria-valuenow", "14");
    expect(screen.getByText("14mm")).toBeInTheDocument();
    // 恢复默认改成双击标题（原先的 ↺ 按钮已删除）；已经是默认值时双击不提交。
    fireEvent.doubleClick(screen.getByText("页边距"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("换模板后默认值跟着模板走（compact 是 12mm），不是写死 14", async () => {
    renderGroup({ layout: { ...BASE, template: "compact" } });

    const slider = await screen.findByRole("slider", { name: /页边距/ });
    expect(slider).toHaveAttribute("aria-valuenow", "12");
    expect(screen.getByText("12mm")).toBeInTheDocument();
  });

  it("「增大页边距」一次 +1mm，只写 page_padding", async () => {
    const onChange = renderGroup();

    fireEvent.click(await screen.findByRole("button", { name: "增大页边距" }));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const next = lastLayout(onChange);
    expect(next.format_config?.page_padding).toBe(15);
    expect(next.format_config?.accent).toBe("#123456");
  });

  it("复位 = 删键（不是写回默认值），其它覆盖保留", async () => {
    const onChange = renderGroup({
      layout: { ...BASE, format_config: { accent: "#123456", page_padding: 18 } },
    });

    fireEvent.doubleClick(await screen.findByText("页边距"));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const next = lastLayout(onChange);
    expect(next.format_config).not.toHaveProperty("page_padding");
    expect(next.format_config).toEqual({ accent: "#123456" });
  });
});
