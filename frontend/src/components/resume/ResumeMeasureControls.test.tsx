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
import { t } from "../../i18n";
import type { ResumeFormatConfig, ResumeLayout } from "../../types";
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
  it("按当前模板的默认值起步，±0.01 只写 line_height", async () => {
    const onChange = renderGroup();

    // classic 的默认行距 1.70 由目录下发，不是写死的 1.7。
    expect(await screen.findByText("1.70")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "减小行距" }));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const next = lastLayout(onChange);
    expect(next.format_config?.line_height).toBe(1.69);
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
    expect(setLiveProbe).toHaveBeenLastCalledWith("body { line-height: 1.59 !important; }");

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
    expect(setLiveProbe).toHaveBeenLastCalledWith("body { padding: 14.1mm !important; }");

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

  it("「增大页边距」一次 +0.1mm，只写 page_padding", async () => {
    const onChange = renderGroup();

    fireEvent.click(await screen.findByRole("button", { name: "增大页边距" }));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const next = lastLayout(onChange);
    expect(next.format_config?.page_padding).toBe(14.1);
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

/**
 * 四向页边距（2026-10-22）：总滑杆的三态与四条支路的接线。
 *
 * 这一组守的是"两种写入语义互不越界"：
 * - 拖总滑杆 **只写** `page_padding`，并把四条支路清干净（需求 d）；
 * - 拖某一条支路 **写全四条**，并且不留下一个与它们并存的 `page_padding`
 *   （否则"总"会在下一次解析时把没动的边拉回去）。
 */
describe("ResumeMeasureControls · 四向页边距", () => {
  /** 四边齐全但上边距不同：这就是"自定义"态（总滑杆上没有一个页边距值）。 */
  const ASYMMETRIC: ResumeFormatConfig = {
    accent: "#123456",
    page_padding_top: 8,
    page_padding_right: 12,
    page_padding_bottom: 12,
    page_padding_left: 12,
  };

  it("四边不全等时总滑杆读数是「自定义」", async () => {
    renderGroup({ layout: { ...BASE, format_config: ASYMMETRIC } });

    expect(await screen.findByText(t("resume.pagePadding.custom"))).toBeInTheDocument();
    // 滑块停在**上边距**（8）：它是"把整体拉回来"最短的那条路。
    expect(screen.getByRole("slider", { name: /页边距/ })).toHaveAttribute("aria-valuenow", "8");
  });

  it("拖总滑杆：只写 page_padding，四条支路全部消失（自定义 → 统一）", async () => {
    const onChange = renderGroup({ layout: { ...BASE, format_config: ASYMMETRIC } });

    fireEvent.click(await screen.findByRole("button", { name: "增大页边距" }));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const next = lastLayout(onChange);
    expect(next.format_config).toEqual({ accent: "#123456", page_padding: 8.1 });
    for (const key of ["page_padding_top", "page_padding_right", "page_padding_bottom"])
      expect(next.format_config).not.toHaveProperty(key);
    expect(next.format_config).not.toHaveProperty("page_padding_left");
  });

  it("双击总滑杆标题：total 与四条支路一起清掉（回到随模板）", async () => {
    const onChange = renderGroup({ layout: { ...BASE, format_config: ASYMMETRIC } });

    // 标题文案走 i18n key：中文断言文案会被 cjkRatchet 计入，新用例不再写死中文。
    fireEvent.doubleClick(await screen.findByText(t("resume.pagePadding.label")));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(lastLayout(onChange).format_config).toEqual({ accent: "#123456" });
  });

  it("分边调整默认收起；展开后拖「上」写全四条、且不留下 page_padding", async () => {
    const onChange = renderGroup({ layout: { ...BASE, format_config: ASYMMETRIC } });

    // 收起态下四条支路不存在（99% 的用户不该看到 4 条额外滑杆）。
    expect(screen.queryByRole("button", { name: "增大上边距" })).not.toBeInTheDocument();

    fireEvent.click(
      await screen.findByRole("button", { name: t("resume.pagePadding.sidesToggle") }),
    );
    // 「上」此刻是 8mm（离下限 0 还远），减小那只按钮是可用的，但用例要的是"往上加"。
    fireEvent.click(await screen.findByRole("button", { name: "增大上边距" }));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const next = lastLayout(onChange);
    expect(next.format_config).toEqual({
      accent: "#123456",
      page_padding_top: 8.1,
      page_padding_right: 12,
      page_padding_bottom: 12,
      page_padding_left: 12,
    });
    expect(next.format_config).not.toHaveProperty("page_padding");
  });

  it("只有真的不一样的那一条边出现复位图标（写全四条不等于四条都调整过）", async () => {
    // classic 的默认页边距是 14：把上边拖到 8 之后四条键都会写下来，
    // 但只有「上」的值与统一值不同——复位图标只该长在这一条上。
    renderGroup({
      layout: {
        ...BASE,
        format_config: {
          accent: "#123456",
          page_padding_top: 8,
          page_padding_right: 14,
          page_padding_bottom: 14,
          page_padding_left: 14,
        },
      },
    });

    fireEvent.click(
      await screen.findByRole("button", { name: t("resume.pagePadding.sidesToggle") }),
    );

    expect(
      await screen.findByRole("button", {
        name: t("resume.pageMargin.resetAction", { side: t("resume.pageMargin.top") }),
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: t("resume.pageMargin.resetAction", { side: t("resume.pageMargin.right") }),
      }),
    ).not.toBeInTheDocument();
  });

  it("没有照片时（hasPhoto=false）照片滑杆禁用并说明原因", async () => {
    renderGroup({ hasPhoto: false });

    expect(
      await screen.findByRole("slider", { name: t("resume.photo.scale.sliderLabel") }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText(t("resume.photo.scale.noPhoto"))).toBeInTheDocument();
  });

  it("照片大小拖动：只写 photo_scale（百分比 → 系数）", async () => {
    const onChange = renderGroup({ hasPhoto: true });

    fireEvent.click(await screen.findByRole("button", { name: t("resume.photo.scale.increase") }));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(lastLayout(onChange).format_config).toEqual({
      accent: "#123456",
      photo_scale: 1.02,
    });
  });
});
