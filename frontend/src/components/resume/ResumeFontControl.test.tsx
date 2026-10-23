// SPDX-License-Identifier: Apache-2.0
/**
 * 简历字体选择（项 14）。
 *
 * 这条控件最容易错的地方不是"选不中"，而是**语义**：设备上有一个"当前字体"（R10），
 * 每份简历又各自有一个选择，两者叠加出三种状态。写错的后果都很安静——用户以为选了、
 * 导出的却是别的字形。所以这里钉住四件事：
 *
 * 1. 没设过 → 显示设备上当前那个字体，并标「（当前全局）」；
 * 2. 选某款 → 写 `format_config.font = 名字`；
 * 3. 选「系统字体」→ 写 `__system__`，**不是删键**（删键 = 跟随全局，是另一种语义）；
 * 4. 字形预览：下拉打开时才注入 `@font-face`，关掉就移除（常驻会白下载几十 MB）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResumeLayout } from "../../types";
import ResumeFontControl, { SYSTEM_FONT_VALUE } from "./ResumeFontControl";

const apiMocks = vi.hoisted(() => ({ listResumeFonts: vi.fn() }));

vi.mock("../../api/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/settings")>()),
  listResumeFonts: apiMocks.listResumeFonts,
}));

const LAYOUT: ResumeLayout = {
  template: "classic",
  format_name: "",
  page_limit: 1,
  font_scale: "standard",
};

const FONTS = {
  items: [
    { name: "思源黑体.ttf", size: 1024, uploaded_at: "2026-10-01T10:00:00", active: true },
    { name: "霞鹜文楷.ttf", size: 2048, uploaded_at: "2026-09-30T10:00:00", active: false },
  ],
  active: "思源黑体.ttf",
  max_bytes: 30 * 1024 * 1024,
};

function renderControl(layout: ResumeLayout = LAYOUT) {
  const onChange = vi.fn();
  render(
    <AntdApp>
      <ResumeFontControl layout={layout} onChange={onChange ?? (() => undefined)} />
    </AntdApp>,
  );
  return onChange;
}

/** 打开下拉，返回那个 combobox 元素（后续按键要打回它身上）。 */
async function openDropdown(): Promise<HTMLElement> {
  const select = await screen.findByRole("combobox", { name: "简历字体" });
  fireEvent.mouseDown(select);
  return select;
}

beforeEach(() => {
  apiMocks.listResumeFonts.mockReset().mockResolvedValue(FONTS);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  document.head.querySelectorAll("style[data-rf-font-options]").forEach((node) => node.remove());
});

describe("ResumeFontControl", () => {
  it("没有任何已上传字体时只给一句指引，不渲染下拉", async () => {
    apiMocks.listResumeFonts.mockResolvedValue({ items: [], active: null, max_bytes: 1 });

    renderControl();

    expect(
      await screen.findByText("还没有导入字体，去 设置 → 应用 → 简历字体 上传"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("没设过字体时显示设备上当前那一款，并标注「（当前全局）」", async () => {
    renderControl();

    // 没设过 = 跟随全局，所以显示的必须是全局那一款（那才是真正会用的字形）。
    const select = await screen.findByRole("combobox", { name: "简历字体" });
    await waitFor(() => expect(select).toHaveAttribute("aria-label", "简历字体"));
    expect(await screen.findByTitle("思源黑体.ttf（当前全局）")).toBeInTheDocument();
  });

  it("选中某一款字体：写进 format_config.font", async () => {
    const onChange = renderControl();
    await screen.findByRole("combobox", { name: "简历字体" });

    await openDropdown();
    fireEvent.click(await screen.findByTitle("霞鹜文楷.ttf"));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({
      ...LAYOUT,
      format_config: { font: "霞鹜文楷.ttf" },
    });
  });

  it("选「系统字体」写哨兵值，而不是删掉这个键", async () => {
    const onChange = renderControl({
      ...LAYOUT,
      format_config: { font: "霞鹜文楷.ttf", line_height: 1.7 },
    });
    await screen.findByRole("combobox", { name: "简历字体" });

    await openDropdown();
    fireEvent.click(await screen.findByTitle("系统字体（不使用自定义字体）"));

    // 删键 = "跟随设备当前字体"，与"这份简历不用自定义字体"不是一回事。
    expect(onChange).toHaveBeenCalledWith({
      ...LAYOUT,
      format_config: { font: SYSTEM_FONT_VALUE, line_height: 1.7 },
    });
  });

  it("选中态只显示短名「系统字体」，完整说明留给展开的列表", async () => {
    renderControl({ ...LAYOUT, format_config: { font: SYSTEM_FONT_VALUE } });

    const select = await screen.findByRole("combobox", { name: "简历字体" });
    const root = select.closest(".ant-select") as HTMLElement;
    // 触发框与页边距滑杆同宽（200px），全称会被截成「系统字体（不使用自定义…」，
    // 反而认不出来；短名 + 原生 title 才是这一格里能读的形态。
    expect(within(root).getByText("系统字体")).toBeInTheDocument();
    expect(within(root).queryByText("系统字体（不使用自定义字体）")).toBeNull();
    // 全称没丢：触发框的原生 title 仍是完整说明，悬停可看。
    expect(within(root).getByTitle("系统字体（不使用自定义字体）")).toBeInTheDocument();

    await openDropdown();
    // 展开的列表里有整行宽度，完整说明仍要在（限定在列表里：触发框的 title 同名）。
    expect(await screen.findByText("系统字体（不使用自定义字体）")).toBeInTheDocument();
  });

  it("弹层定宽在参数栏内容宽（340px）：长展示名与长文件名各自省略，悬停看全", async () => {
    apiMocks.listResumeFonts.mockResolvedValue({
      ...FONTS,
      // 展示名可自定义，于是"展示名 ≠ 磁盘文件名"——两个都是长串，正是会撑破弹层的那种。
      items: [
        {
          name: "source-han-serif-sc-heavy.otf",
          display_name: "思源宋体（超粗·正式版）",
          size: 4096,
          uploaded_at: "2026-10-01T10:00:00",
          active: false,
        },
      ],
      active: null,
    });
    renderControl();

    fireEvent.mouseDown(await screen.findByRole("combobox", { name: "简历字体" }));

    // 弹层宽度钉在 340px（+ `max-width` 兜底），不再按内容撑开。
    await waitFor(() => expect(document.querySelector(".resume-params-dropdown")).not.toBeNull());

    // 悬停给出"展示名 · 磁盘文件名"两件事：宽度定死之后名字必然被截断，靠它看全。
    const option = await screen.findByTitle(
      "思源宋体（超粗·正式版） · source-han-serif-sc-heavy.otf",
    );
    expect(option.className).toContain("resume-font-option");
    // 展示名与文件名各有自己的省略层（只给外层省略时，文件名会把展示名挤掉）。
    // 按类名取而不是 `ByText`：`cjkRatchet` 只允许测试里的中文**断言参数**不涨。
    expect(option.querySelector(".resume-font-option-name")?.textContent).toBe(
      "思源宋体（超粗·正式版）",
    );
    expect(option.querySelector(".resume-font-option-file")?.textContent).toBe(
      "source-han-serif-sc-heavy.otf",
    );
  });

  it("打开下拉才注入字形 @font-face，关掉就移除", async () => {
    renderControl();
    await screen.findByRole("combobox", { name: "简历字体" });
    expect(document.head.querySelector("style[data-rf-font-options]")).toBeNull();

    const select = await openDropdown();

    await waitFor(() =>
      expect(document.head.querySelector("style[data-rf-font-options]")).not.toBeNull(),
    );
    const css = document.head.querySelector("style[data-rf-font-options]")?.textContent ?? "";
    // 每款字体一条，且指向它自己的文件 URL（不是把字体读进内存再转 base64）。
    expect(css).toContain('@font-face{font-family:"rf-opt-0"');
    expect(css).toContain("/api/settings/fonts/%E6%80%9D%E6%BA%90%E9%BB%91%E4%BD%93.ttf/file");
    expect(css.match(/@font-face/g)).toHaveLength(FONTS.items.length);

    // 关闭（Esc）后移除：常驻会让每个页面都白下载一遍字体文件。
    fireEvent.keyDown(select, { key: "Escape", keyCode: 27, which: 27 });
    await waitFor(() =>
      expect(document.head.querySelector("style[data-rf-font-options]")).toBeNull(),
    );
  });
});
