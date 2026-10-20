// SPDX-License-Identifier: Apache-2.0
/**
 * 版式控件 · 字号域：0.1px 精度、两端加减按钮、滑块步长与下限、拖动防抖。
 *
 * 从 `ResumeLayoutControls.test.tsx` 拆出（行数预算 500）。用例、断言与文案原样搬迁，
 * 只换了共用夹具的来源（`ResumeLayoutControls.testkit.tsx`）。`vi.mock` 不跨文件
 * hoist，所以这里自带一份 api mock 与 `beforeEach`——不依赖原文件的 mock 状态。
 *
 * 这一域是**看不见的错最容易溜过去**的地方：字号是连续量，读数、`aria-valuenow`、
 * 落库系数三处必须说同一件事；而"每拖一格发一次请求"会让界面卡、后端被刷。
 */
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEMPLATE_CATALOG } from "../test/resumeFixtures";
import {
  DEFAULT_LAYOUT,
  makePreviewRef,
  pressArrow,
  renderControls,
} from "./ResumeLayoutControls.testkit";

const apiMocks = vi.hoisted(() => ({
  fetchResumeTemplates: vi.fn(),
  previewResumeTemplate: vi.fn(),
}));

// 展开真实模块再覆盖：生产代码新增导出时不会因为这里只列了两个而直接抛错。
vi.mock("../api/resumes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/resumes")>()),
  fetchResumeTemplates: apiMocks.fetchResumeTemplates,
  previewResumeTemplate: apiMocks.previewResumeTemplate,
}));

beforeEach(() => {
  apiMocks.fetchResumeTemplates.mockReset();
  apiMocks.previewResumeTemplate.mockReset();
  apiMocks.fetchResumeTemplates.mockResolvedValue(TEMPLATE_CATALOG);
  apiMocks.previewResumeTemplate.mockResolvedValue("<html><body>简历</body></html>");
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("ResumeLayoutControls · 无级字号滑块（C3）", () => {
  it("拖动时即时反馈、不发请求；静置后只提交一次", async () => {
    const { ref, setLiveProbe } = makePreviewRef();
    const onChange = renderControls({ previewRef: ref });

    const slider = await screen.findByRole("slider", { name: /字号/ });
    // 键盘可访问：方向键微调字号（这也是唯一的"拖动"入口，测试直接用它）。
    pressArrow(slider, "ArrowRight");
    pressArrow(slider, "ArrowRight");
    pressArrow(slider, "ArrowRight");

    // 中间态：预览被本地探针缩放了，但没有外发任何版式请求。
    expect(setLiveProbe).toHaveBeenCalled();
    const probeCalls = setLiveProbe.mock.calls;
    expect(probeCalls[probeCalls.length - 1][0]).toContain("--fs: calc(");
    expect(onChange).not.toHaveBeenCalled();

    // 防抖结束后恰好提交一次 —— 不是每拖一格一次。
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(onChange.mock.calls[0][0]).toMatchObject({
      font_scale: "standard",
      format_config: { font_scale_adjust: expect.any(Number) },
    });
    // 14px 上调 3 格（每格 0.1px）→ 14.3px，最近档仍是标准档，系数 14.3 / 14 ≈ 1.021。
    expect(Number(onChange.mock.calls[0][0].format_config.font_scale_adjust)).toBeCloseTo(1.021, 2);
  });

  it("从大字号往下拖会就近落到标准档并带小于 1 的系数", async () => {
    const onChange = renderControls({
      layout: { ...DEFAULT_LAYOUT, font_scale: "large" },
    });
    const slider = await screen.findByRole("slider", { name: /字号/ });

    // 18px 往下 41 格（每格 0.1px）→ 13.9px：越过 16px 的中点后最近档变成标准档（14），
    // 系数 13.9 / 14 ≈ 0.993。
    for (let i = 0; i < 41; i += 1) pressArrow(slider, "ArrowLeft");

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(onChange.mock.calls[0][0]).toMatchObject({ font_scale: "standard" });
    expect(Number(onChange.mock.calls[0][0].format_config.font_scale_adjust)).toBeLessThan(1);
  });

  it("拖动全程零网络：fetch 与 previewResumeTemplate 一次都没被调用", async () => {
    // 直接盯住网络入口本身，而不是"某个回调没被调"：将来若有人在拖动处理里塞一句
    // 裸 fetch / 预览请求，这条断言会立刻红——这是"零网络"最靠得住的说法。
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { ref } = makePreviewRef();
    const onChange = renderControls({ previewRef: ref });

    const slider = await screen.findByRole("slider", { name: /字号/ });
    for (let i = 0; i < 6; i += 1) pressArrow(slider, "ArrowRight");

    // 拖动中：任何网络入口都没被碰过，也没有提交。
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(apiMocks.previewResumeTemplate).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();

    // 松手防抖后：恰好一次提交，且这次提交本身也不走 fetch（由父组件统一落库）。
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(apiMocks.previewResumeTemplate).not.toHaveBeenCalled();
  });

  it("「恢复默认」回到默认档位并清掉字号系数，其它覆盖保留", async () => {
    const { ref, setLiveProbe } = makePreviewRef();
    const onChange = renderControls({
      layout: {
        ...DEFAULT_LAYOUT,
        font_scale: "large",
        format_config: { font_scale_adjust: 0.95, accent: "#123456" },
      },
      previewRef: ref,
    });

    fireEvent.click(await screen.findByRole("button", { name: "恢复默认字号" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toMatchObject({
      font_scale: TEMPLATE_CATALOG.defaults.font_scale,
      format_config: { accent: "#123456" },
    });
    expect(onChange.mock.calls[0][0].format_config).not.toHaveProperty("font_scale_adjust");
    expect(setLiveProbe).toHaveBeenCalledWith("");
  });
});

describe("ResumeLayoutControls · 字号下限 5px（R7）", () => {
  it("滑块的范围是 5 ~ 最大档位基准像素，步长 0.1px", async () => {
    renderControls();
    const slider = await screen.findByRole("slider", { name: /字号/ });
    const tiers = TEMPLATE_CATALOG.font_scales;
    const maxBasePx = Math.max(...tiers.map((tier) => tier.base_px));
    expect(slider).toHaveAttribute("aria-valuemin", "5");
    expect(slider).toHaveAttribute("aria-valuemax", String(maxBasePx));
    // 步长从 0.5 收紧到 0.1：键盘按一格就是 0.1px（rc-slider 不暴露 step 属性，
    // 所以直接看按一下之后的读数）。
    expect(slider).toHaveAttribute("aria-valuenow", "14");
    pressArrow(slider, "ArrowRight");
    await waitFor(() => expect(slider).toHaveAttribute("aria-valuenow", "14.1"));
  });

  it("字号低于 8px 时在读数旁提示打印可能看不清", async () => {
    // 11px × 0.5 = 5.5px：直接构造一个"已经很小"的版式，不必靠按 13 次方向键。
    renderControls({
      layout: {
        ...DEFAULT_LAYOUT,
        font_scale: "small",
        format_config: { font_scale_adjust: 0.5 },
      },
    });

    expect(await screen.findByText(/小于 8px 打印可能看不清/)).toBeInTheDocument();
  });

  it("正常字号不显示这条警告（提示只在真的偏小时出现）", async () => {
    renderControls();
    await screen.findByRole("slider", { name: /字号/ });
    expect(screen.queryByText(/小于 8px 打印可能看不清/)).not.toBeInTheDocument();
  });
});

describe("ResumeLayoutControls · 两端 ±0.1px 按钮", () => {
  it("「放大字号」一次 +0.1px，读数与滑块说同一件事", async () => {
    renderControls();
    const slider = await screen.findByRole("slider", { name: /字号/ });
    expect(slider).toHaveAttribute("aria-valuenow", "14");
    expect(screen.getByText("14px")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "放大字号" }));

    // 读数与 aria-valuenow 必须同步：只更新其中一个是最容易溜过去的错。
    await waitFor(() => expect(slider).toHaveAttribute("aria-valuenow", "14.1"));
    expect(screen.getByText("14.1px")).toBeInTheDocument();
  });

  it("「缩小字号」一次 -0.1px；连点三次读数仍是干净的 13.7（没有浮点尾巴）", async () => {
    renderControls();
    const slider = await screen.findByRole("slider", { name: /字号/ });
    const minus = screen.getByRole("button", { name: "缩小字号" });

    fireEvent.click(minus);
    await waitFor(() => expect(slider).toHaveAttribute("aria-valuenow", "13.9"));

    fireEvent.click(minus);
    fireEvent.click(minus);
    // 13.9 - 0.1 - 0.1 在不规整的实现里会变成 13.700000000000001：
    // 那串尾巴会被原样写进 aria-valuenow 和落库系数里。
    await waitFor(() => expect(slider).toHaveAttribute("aria-valuenow", "13.7"));
    expect(screen.getByText("13.7px")).toBeInTheDocument();
  });

  it("到下限 5px 时「缩小字号」禁用，「放大字号」仍可用", async () => {
    renderControls({
      // 5/11 → 小字号档 11px × 0.4545… = 5px，正是滑块左端。
      layout: {
        ...DEFAULT_LAYOUT,
        font_scale: "small",
        format_config: { font_scale_adjust: 5 / 11 },
      },
    });

    const minus = await screen.findByRole("button", { name: "缩小字号" });
    expect(screen.getByText("5px")).toBeInTheDocument();
    expect(minus).toBeDisabled();
    expect(screen.getByRole("button", { name: "放大字号" })).toBeEnabled();
  });

  it("到上限（最大档位基准 18px）时「放大字号」禁用，「缩小字号」仍可用", async () => {
    renderControls({ layout: { ...DEFAULT_LAYOUT, font_scale: "large" } });

    const plus = await screen.findByRole("button", { name: "放大字号" });
    expect(screen.getByText("18px")).toBeInTheDocument();
    expect(plus).toBeDisabled();
    expect(screen.getByRole("button", { name: "缩小字号" })).toBeEnabled();
  });

  it("越界的推进被夹在 18px，不会点出 18.1px", async () => {
    const onChange = renderControls({
      // 18 × 0.9944 = 17.9px：离上限只差 0.1px，再点一次「放大」正好贴到上限。
      layout: {
        ...DEFAULT_LAYOUT,
        font_scale: "large",
        format_config: { font_scale_adjust: 0.9944 },
      },
    });
    const slider = await screen.findByRole("slider", { name: /字号/ });
    const plus = screen.getByRole("button", { name: "放大字号" });
    expect(slider).toHaveAttribute("aria-valuenow", "17.9");

    fireEvent.click(plus);

    // 推进量先夹到边界：滑块停在 18（不是 18.1），按钮随之禁用。
    await waitFor(() => expect(slider).toHaveAttribute("aria-valuenow", "18"));
    expect(screen.getByText("18px")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "放大字号" })).toBeDisabled();

    // 落在档位基准上 → 系数为 1 → 不写覆盖键（等一次防抖提交）。
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls[0][0]).toMatchObject({ font_scale: "large", format_config: {} });
  });
});
