// SPDX-License-Identifier: Apache-2.0
/**
 * 版式控件：模板"选中即见预览"与结构页签。
 *
 * 两块都是**看不见的错最容易溜过去**的地方：模板入口合并后如果只是换了个名字、
 * 预览没真的渲染出来，用户还是盲选；板块顺序如果只改内存不落库，用户下次打开
 * 又会回到默认。所以这里把"能看到预览""顺序写进完整排列""恢复默认"都钉住。
 *
 * 2026-10-19：字号域（0.1px 精度 / 加减按钮 / 滑块步长与下限 / 拖动防抖）按内聚
 * 边界拆到 `ResumeLayoutControls.font.test.tsx`（行数预算 500）。渲染外壳与假预览
 * 句柄抽到 `ResumeLayoutControls.testkit.tsx` 共用；本文件的 api mock 与
 * `beforeEach` 保持自持（vitest 的 mock 注册不跨文件 hoist）。
 */
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEMPLATE_CATALOG } from "../test/resumeFixtures";
import type { ResumeLayout } from "../types";
import { DEFAULT_LAYOUT, renderControls } from "./ResumeLayoutControls.testkit";
import { t } from "../i18n";
import { clampPagePadding } from "../utils/pagePadding";

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

describe("ResumeLayoutControls · 选模板即见预览（C2）", () => {
  it("模板入口合并成一个按钮，不再有单独的「看效果」", async () => {
    renderControls();
    expect(
      await screen.findByRole("button", { name: "选择简历模板并预览效果" }),
    ).toBeInTheDocument();
    // 合并后不该再出现原来那对分开的按钮里的「看效果」。
    expect(screen.queryByRole("button", { name: /看效果/ })).not.toBeInTheDocument();
  });

  it("点开模板入口就能看到每种模板的真实渲染，选中即应用", async () => {
    const onChange = renderControls();

    fireEvent.click(await screen.findByRole("button", { name: "选择简历模板并预览效果" }));

    // 主路径：打开后每个模板都用真实渲染接口出一张预览，而不是名字清单。
    // 点击后弹层内容是异步挂载的（antd Modal + destroyOnHidden），挂载完还要等
    // 弹层自己的模板清单请求 resolve 才会发预览请求。CI 满负载时这条链路实测可到
    // 8~12s（见 src/test/setup.ts），所以先等弹层真正出现、再把调用数预算放宽到
    // 10s——两者都是就绪即返回，预算只是安全网。
    await screen.findByText("选择简历模板");
    await waitFor(
      () =>
        expect(apiMocks.previewResumeTemplate).toHaveBeenCalledTimes(
          TEMPLATE_CATALOG.templates.length,
        ),
      { timeout: 10000 },
    );
    expect(apiMocks.previewResumeTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ template_name: "modern" }),
    );
    expect(await screen.findByTitle("现代 预览", {}, { timeout: 10000 })).toBeInTheDocument();

    // 选模板与看效果是同一步：点「用这个模板」直接写入并重渲染，没有额外确认。
    const useButtons = screen.getAllByRole("button", { name: "用这个模板" });
    fireEvent.click(useButtons[0]);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toMatchObject({ template: "modern" });
  });
});

describe("ResumeLayoutControls · v1 板块顺序入口已删除（v2 结构由结构页签负责）", () => {
  it("不再渲染「调整简历板块顺序」按钮", async () => {
    renderControls();
    // 等目录就绪（模板入口是控件组渲染完成的标志）。
    await screen.findByRole("button", { name: "选择简历模板并预览效果" });
    expect(
      screen.queryByRole("button", { name: t("sections.templateControls.orderTriggerAriaLabel") }),
    ).toBeNull();
  });

  it("默认仍渲染最大篇幅（其它宿主不变），制作台改用「版面」组去重", async () => {
    renderControls();
    expect(
      await screen.findByText(t("sections.templateControls.pageLimitLabel")),
    ).toBeInTheDocument();
  });
});

/**
 * 页边距（T5 → 项 4a 滑块化）：从导出面板搬到版式栏后的写入/复位/边界。
 *
 * 落点必须是 `format_config.page_padding`——预览、保存、导出读的都是这一个键；
 * 写别处就会出现"预览改了、导出没变"。
 *
 * 形态从 `InputNumber` 改成滑块（与行距同构）：`spinbutton` 那套查询已不存在，
 * 这里改按 `slider` + 两端 ±1 按钮 + `${value}mm` 读数断言。
 */
describe("ResumeLayoutControls · 页边距（T5 / 4a）", () => {
  function lastLayout(onChange: ReturnType<typeof vi.fn>) {
    // tsconfig 的 lib 没到 ES2022，不能用 `Array.prototype.at`。
    const calls = onChange.mock.calls;
    return calls[calls.length - 1]?.[0] as ResumeLayout;
  }

  it("滑块与 ±1 按钮都说同一件事：没设过时停在模板默认 14mm", async () => {
    renderControls();

    const slider = await screen.findByRole("slider", { name: /页边距/ });
    // classic 的模板默认页边距是 14mm（目录下发），不是写死的数字。
    expect(slider).toHaveAttribute("aria-valuenow", "14");
    expect(screen.getByText("14mm")).toBeInTheDocument();
    // 两端按钮在默认位置都可用（8 < 14 < 26）。
    expect(screen.getByRole("button", { name: "减小页边距" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "增大页边距" })).toBeEnabled();
  });

  it("「增大页边距」一次 +0.1mm，写进 format_config.page_padding", async () => {
    const onChange = renderControls();

    const plus = await screen.findByRole("button", { name: "增大页边距" });
    fireEvent.click(plus);

    // 读数先跟着走（本地值），提交在 120ms 防抖后。
    expect(screen.getByText("14.1mm")).toBeInTheDocument();
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(lastLayout(onChange).format_config).toEqual({ page_padding: 14.1 });
  });

  it("没设过时标「随模板」，且没有独立的复位按钮", async () => {
    renderControls();

    // 恢复默认已改成"双击标题"，独立的 ↺ 按钮不再存在。
    expect(screen.queryByRole("button", { name: "恢复默认页边距" })).toBeNull();
    // 锚点取标题文字，再向上取整行：「随模板」行距那一行也有，全局查询会多重命中。
    const row = screen.getByText("页边距").closest(".ant-space") as HTMLElement;
    expect(within(row).getByText("随模板")).toBeInTheDocument();
  });

  it("复位删键而不是写回模板默认值（模板更新时这些简历才跟着变）", async () => {
    const onChange = renderControls({
      layout: { ...DEFAULT_LAYOUT, format_config: { page_padding: 14, line_height: 1.6 } },
    });

    fireEvent.doubleClick(await screen.findByText("页边距"));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const next = lastLayout(onChange);
    expect(next.format_config).not.toHaveProperty("page_padding");
    // 其它版式项原样保留（只删这一个键）。
    expect(next.format_config).toEqual({ line_height: 1.6 });
  });

  it("边界：滑块声明 0–26，两端按钮到边界禁用，程序化赋值再被 clamp 收一道", async () => {
    renderControls({ layout: { ...DEFAULT_LAYOUT, format_config: { page_padding: 0 } } });
    const slider = await screen.findByRole("slider", { name: /页边距/ });
    expect(slider).toHaveAttribute("aria-valuemin", "0");
    expect(slider).toHaveAttribute("aria-valuemax", "26");
    // 已在下限：只能往上。
    expect(screen.getByRole("button", { name: "减小页边距" })).toBeDisabled();
    cleanup();

    renderControls({ layout: { ...DEFAULT_LAYOUT, format_config: { page_padding: 26 } } });
    expect(await screen.findByRole("button", { name: "增大页边距" })).toBeDisabled();

    // 历史草稿 / 粘贴 / 程序化赋值绕过控件时，靠唯一的实现收口：
    // 后端白名单之外的值会被整条丢弃（"设了 30mm，导出还是默认"）。
    expect(clampPagePadding(-2)).toBe(0);
    expect(clampPagePadding(40)).toBe(26);
    // 0.1mm 精度后，范围内的小数原样保留（以前会取整到 26）。
    expect(clampPagePadding(25.7)).toBe(25.7);
    expect(clampPagePadding(Number.NaN)).toBe(0);
  });
});

/**
 * P0-6 的第二个宿主：**生成配置页**（`GenerationConfigStage` → `ResumeLayoutControls`）。
 *
 * 分边控件在 2026-10-23 搬进「简历制作台」，主预览与生成配置页都不再渲染它。主预览那一侧
 * 由 `ResumeDetailPreview.test.tsx` 以 `showMarginSides={false}` 钉住；这里补的是**生成配置页
 * 这一条调用链**——它没有显式传 prop，靠的是 `ResumeMeasureControls` 的缺省 false。
 *
 * 为什么值得单独一条：缺省值一旦被改成 true（或有人给这个宿主补上 `showMarginSides`），
 * 表现是"生成前那一行排版栏突然多出一行折叠块"，而那正是 2026-10-22 用户截图的成因
 * （来源胶囊被顶宽、读数被压成 0 宽）。也顺手钉住"能力没被删"：页边距总滑杆仍在。
 */
describe("生成配置页 · 分边页边距只在制作台出现（P0-6）", () => {
  it("不渲染分边控件，页边距总滑杆照常可用", async () => {
    renderControls();

    // 分边控件（折叠标题 + 四条支路）整块不出现。
    expect(document.querySelector(".resume-margin-sides")).toBeNull();

    // 五个度量行：行距 / 页边距 / 字号 / 字体 / 照片。分边若被渲染出来会是第 6 个直接子项。
    const grid = document.querySelector(".resume-measure-grid");
    expect(grid).not.toBeNull();
    expect(grid!.children).toHaveLength(5);

    // 能力没被删掉：总页边距滑杆仍在（读屏名来自 i18n，不写死中文）。
    // 无障碍名取 `resume.pagePadding.label`：rc-slider 用的是 `ariaLabelForHandle`，
    // 那个 prop 接的正是这个 key，而不是段落级的 `sliderLabel`。
    expect(
      await screen.findByRole("slider", {
        name: new RegExp(t("resume.pagePadding.label")),
      }),
    );
  });
});
