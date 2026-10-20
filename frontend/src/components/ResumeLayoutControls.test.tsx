// SPDX-License-Identifier: Apache-2.0
/**
 * 版式控件：模板"选中即见预览"与板块顺序。
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
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEMPLATE_CATALOG } from "../test/resumeFixtures";
import type { ResumeLayout } from "../types";
import { DEFAULT_LAYOUT, renderControls } from "./ResumeLayoutControls.testkit";
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
    await screen.findByText("选择简历样式模板");
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

describe("ResumeLayoutControls · 生成时默认顺序跟随「我的资料」（R6）", () => {
  /** 资料页把「项目经历」拖到最前的那种顺序（与内置默认不同）。 */
  const PROFILE_ORDER = [
    "projects",
    "education",
    "summary",
    "experience",
    "campus_experience",
    "skills",
    "awards",
  ];

  function mockCatalog(profileOrder: string[]) {
    apiMocks.fetchResumeTemplates.mockResolvedValue({
      ...TEMPLATE_CATALOG,
      profile_section_order: profileOrder,
    });
  }

  async function openOrderPanel() {
    fireEvent.click(await screen.findByRole("button", { name: "调整简历板块顺序" }));
    return screen.findByRole("list", { name: "简历板块顺序" });
  }

  it("preferProfileOrder 时默认顺序取资料顺序", async () => {
    mockCatalog(PROFILE_ORDER);
    renderControls({ preferProfileOrder: true });

    const list = await openOrderPanel();
    const labels = Array.from(list.querySelectorAll(".resume-section-order-label")).map(
      (node) => node.textContent,
    );
    expect(labels[0]).toBe("项目经历");
    // 跟随资料顺序时，没调过就不该标成"已调整"。
    expect(screen.getByRole("button", { name: "调整简历板块顺序" })).not.toHaveTextContent(
      "顺序·已调整",
    );
  });

  it("不传 preferProfileOrder 时仍用内置默认（老简历外观不追溯改变）", async () => {
    mockCatalog(PROFILE_ORDER);
    renderControls();

    const list = await openOrderPanel();
    const labels = Array.from(list.querySelectorAll(".resume-section-order-label")).map(
      (node) => node.textContent,
    );
    expect(labels[0]).toBe("个人总结");
  });

  it("生成场景的「恢复默认」写回资料顺序", async () => {
    mockCatalog(PROFILE_ORDER);
    const onChange = renderControls({
      preferProfileOrder: true,
      layout: {
        ...DEFAULT_LAYOUT,
        format_config: {
          accent: "#123456",
          section_order: [
            "skills",
            "awards",
            "summary",
            "education",
            "experience",
            "campus_experience",
            "projects",
          ],
        },
      },
    });

    await openOrderPanel();
    fireEvent.click(screen.getByRole("button", { name: "恢复默认" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const nextLayout = onChange.mock.calls[0][0] as ResumeLayout;
    // 资料顺序与内置默认不同 → 显式写进 format_config，用户才真的回到他看到的那一版。
    expect(nextLayout.format_config?.section_order).toEqual(PROFILE_ORDER);
    // 其它覆盖不被这次操作清掉。
    expect(nextLayout.format_config).toMatchObject({ accent: "#123456" });
  });

  it("资料顺序等于内置默认时「恢复默认」不写 section_order", async () => {
    mockCatalog(TEMPLATE_CATALOG.default_section_order);
    const onChange = renderControls({
      preferProfileOrder: true,
      layout: {
        ...DEFAULT_LAYOUT,
        format_config: {
          section_order: [
            "projects",
            "summary",
            "education",
            "experience",
            "campus_experience",
            "skills",
            "awards",
          ],
        },
      },
    });

    await openOrderPanel();
    fireEvent.click(screen.getByRole("button", { name: "恢复默认" }));

    const nextLayout = onChange.mock.calls[0][0] as ResumeLayout;
    // "没调过"与"调成和默认一样"在存储里应当是同一种形态。
    expect(nextLayout.format_config).not.toHaveProperty("section_order");
  });
});

describe("ResumeLayoutControls · 板块顺序", () => {
  async function openOrderPanel() {
    fireEvent.click(await screen.findByRole("button", { name: "调整简历板块顺序" }));
    const list = await screen.findByRole("list", { name: "简历板块顺序" });
    return list;
  }

  it("弹层里按当前顺序列出全部分区", async () => {
    renderControls();
    const list = await openOrderPanel();
    const labels = Array.from(list.querySelectorAll(".resume-section-order-label")).map(
      (node) => node.textContent,
    );
    expect(labels).toEqual([
      "个人总结",
      "教育经历",
      "实习/工作经历",
      "校园经历",
      "项目经历",
      "专业技能",
      "荣誉奖项",
    ]);
  });

  it("上移会以完整排列写入 format_config.section_order", async () => {
    const onChange = renderControls();
    await openOrderPanel();

    // 把「项目经历」（默认第 5 位）上移一格。
    fireEvent.click(screen.getByRole("button", { name: "把项目经历上移" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const nextLayout = onChange.mock.calls[0][0] as ResumeLayout;
    expect(nextLayout.format_config?.section_order).toEqual([
      "summary",
      "education",
      "experience",
      "projects",
      "campus_experience",
      "skills",
      "awards",
    ]);
    // 其余版式覆盖不被这次操作清掉。
    expect(nextLayout.template).toBe("classic");
  });

  it("已调整时按钮会标出来，「恢复默认」清掉 section_order 但保留其它覆盖", async () => {
    const onChange = renderControls({
      layout: {
        ...DEFAULT_LAYOUT,
        format_config: {
          accent: "#123456",
          section_order: [
            "projects",
            "summary",
            "education",
            "experience",
            "campus_experience",
            "skills",
            "awards",
          ],
        },
      },
    });

    expect(await screen.findByRole("button", { name: "调整简历板块顺序" })).toHaveTextContent(
      "顺序·已调整",
    );

    await openOrderPanel();
    // 精确匹配：工具条上还有一个「恢复默认字号」按钮，用正则会撞车。
    fireEvent.click(screen.getByRole("button", { name: "恢复默认" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const nextLayout = onChange.mock.calls[0][0] as ResumeLayout;
    expect(nextLayout.format_config).not.toHaveProperty("section_order");
    // accent 是用户自己的覆盖，不动它。
    expect(nextLayout.format_config).toMatchObject({ accent: "#123456" });
  });
});

/**
 * 页边距（T5）：从导出面板搬到版式栏后的写入/复位/边界。
 *
 * 落点必须是 `format_config.page_padding`——预览、保存、导出读的都是这一个键；
 * 写别处就会出现"预览改了、导出没变"。
 */
describe("ResumeLayoutControls · 页边距（T5）", () => {
  function lastLayout(onChange: ReturnType<typeof vi.fn>) {
    // tsconfig 的 lib 没到 ES2022，不能用 `Array.prototype.at`。
    const calls = onChange.mock.calls;
    return calls[calls.length - 1]?.[0] as ResumeLayout;
  }

  it("输入数值写进 format_config.page_padding", async () => {
    const onChange = renderControls();

    const input = await screen.findByRole("spinbutton", { name: "页边距" });
    fireEvent.change(input, { target: { value: "14" } });

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(lastLayout(onChange).format_config).toEqual({ page_padding: 14 });
  });

  it("没设过时不写字：输入框留空显示「随模板」，复位按钮禁用", async () => {
    renderControls();

    const input = await screen.findByRole("spinbutton", { name: "页边距" });
    // 留空 + 占位文案：写一个"看起来已设置"的数字会让人以为它被写进了这份简历。
    // （「随模板」这三个字行距控件也会渲染，所以按 placeholder 定位本控件。）
    expect(input).toHaveValue("");
    expect(input).toHaveAttribute("placeholder", "随模板");
    expect(screen.getByRole("button", { name: "恢复默认页边距" })).toBeDisabled();
  });

  it("复位删键而不是写回模板默认值（模板更新时这些简历才跟着变）", async () => {
    const onChange = renderControls({
      layout: { ...DEFAULT_LAYOUT, format_config: { page_padding: 14, line_height: 1.6 } },
    });

    fireEvent.click(await screen.findByRole("button", { name: "恢复默认页边距" }));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const next = lastLayout(onChange);
    expect(next.format_config).not.toHaveProperty("page_padding");
    // 其它版式项原样保留（只删这一个键）。
    expect(next.format_config).toEqual({ line_height: 1.6 });
  });

  it("边界：输入框声明 8–26，程序化赋值再被 clamp 收一道（不许把 40 发给后端）", async () => {
    renderControls();
    const input = await screen.findByRole("spinbutton", { name: "页边距" });

    // 用户手动输入由 antd 的 min/max 挡住（越界时它只会修正显示，不触发 onChange）。
    expect(input).toHaveAttribute("aria-valuemin", "8");
    expect(input).toHaveAttribute("aria-valuemax", "26");

    // 历史草稿 / 粘贴 / 程序化赋值绕过输入框时，靠唯一的实现收口：
    // 后端白名单之外的值会被整条丢弃（"设了 30mm，导出还是默认"）。
    expect(clampPagePadding(3)).toBe(8);
    expect(clampPagePadding(40)).toBe(26);
    expect(clampPagePadding(25.7)).toBe(26);
    expect(clampPagePadding(Number.NaN)).toBe(8);
  });
});
