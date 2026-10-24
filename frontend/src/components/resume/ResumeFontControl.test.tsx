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
import { t } from "../../i18n";
import type { ResumeLayout } from "../../types";
import ResumeFontControl, { SYSTEM_FONT_VALUE } from "./ResumeFontControl";

const apiMocks = vi.hoisted(() => ({
  listResumeFonts: vi.fn(),
  startBuiltinFontDownload: vi.fn(),
  cancelBuiltinFontDownload: vi.fn(),
  deleteBuiltinFont: vi.fn(),
  getBuiltinFont: vi.fn(),
}));

vi.mock("../../api/fonts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/fonts")>()),
  listResumeFonts: apiMocks.listResumeFonts,
  startBuiltinFontDownload: apiMocks.startBuiltinFontDownload,
  cancelBuiltinFontDownload: apiMocks.cancelBuiltinFontDownload,
  deleteBuiltinFont: apiMocks.deleteBuiltinFont,
  getBuiltinFont: apiMocks.getBuiltinFont,
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

/** 弹层元素的类名串（弹层没渲染时是空串）：`*-leave` 表示"正在关闭"。 */
function popupClass(): string {
  return document.querySelector(".resume-params-dropdown")?.className ?? "";
}

/** 打开下拉，返回那个 combobox 元素（后续按键要打回它身上）。 */
async function openDropdown(): Promise<HTMLElement> {
  const select = await screen.findByRole("combobox", { name: "简历字体" });
  fireEvent.mouseDown(select);
  return select;
}

beforeEach(() => {
  apiMocks.listResumeFonts.mockReset().mockResolvedValue(FONTS);
  apiMocks.getBuiltinFont.mockReset().mockResolvedValue({
    id: "source-han-sans-sc",
    label: "思源黑体",
    size_total: 33493260,
    downloaded: false,
    downloaded_bytes: 0,
    total_bytes: 33493260,
    state: "idle",
    error: "",
  });
  apiMocks.startBuiltinFontDownload.mockReset();
  apiMocks.cancelBuiltinFontDownload.mockReset();
  apiMocks.deleteBuiltinFont.mockReset();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  document.head.querySelectorAll("style[data-rf-font-options]").forEach((node) => node.remove());
});

describe("ResumeFontControl", () => {
  it("下拉未展开时挂载**不发任何字体状态请求**，展开后才发一次", async () => {
    // 这一格就挂在字号滑杆旁边，会被参数栏反复渲染；「拖动字号滑杆全程零网络」是那条
    // 控件的性能红线（`ResumeLayoutControls.font.test.tsx` 用 fetchSpy 钉着它），
    // 所以内置字体状态必须等到**用户真的要挑字体**（展开下拉）时才读。
    renderControl();

    await screen.findByRole("combobox", { name: "简历字体" });
    expect(apiMocks.getBuiltinFont).not.toHaveBeenCalled();

    fireEvent.mouseDown(screen.getByRole("combobox", { name: "简历字体" }));
    await waitFor(() => expect(apiMocks.getBuiltinFont).toHaveBeenCalledTimes(1));
  });

  it("一款可用字体都没有时只给一句指引，不渲染下拉", async () => {
    apiMocks.listResumeFonts.mockResolvedValue({ items: [], active: null, max_bytes: 1 });

    renderControl();

    expect(await screen.findByText(t("fonts.control.empty"))).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("内置字体还没下载：**不再禁用**，点它就是去下载（带 activate=false）", async () => {
    apiMocks.listResumeFonts.mockResolvedValue({
      items: [
        {
          name: "SourceHanSansSC-Regular.otf",
          display_name: "思源黑体",
          size: 33493260,
          uploaded_at: "",
          active: false,
          builtin: true,
          downloaded: false,
        },
        ...FONTS.items,
      ],
      active: FONTS.active,
      max_bytes: 30 * 1024 * 1024,
    });
    apiMocks.startBuiltinFontDownload.mockResolvedValue({
      ...(await apiMocks.getBuiltinFont()),
      state: "downloading",
    });
    const onChange = renderControl();
    await openDropdown();

    const option = (await screen.findByText(t("fontDownload.optionHint"))).closest(
      ".ant-select-item",
    ) as HTMLElement;
    // 这一行现在是"可点的下载入口"，不是"不能选的灰条"。
    expect(option.className).not.toContain("ant-select-item-option-disabled");
    expect(option.textContent).toContain(t("fontDownload.optionHint"));

    fireEvent.click(option);
    await waitFor(() =>
      // **关键**：`activate: false` —— 只下文件，不接管全局当前字体。
      expect(apiMocks.startBuiltinFontDownload).toHaveBeenCalledWith({ activate: false }),
    );
    // 还没下完就不写这份简历的字体（等真的下完再写一次）。
    expect(onChange).not.toHaveBeenCalled();
    // 弹层留在原地：进度就在这一行里走，不该把人踢出下拉（antd 关掉时会加 `hidden`）。
    const popup = document
      .querySelector(".resume-params-dropdown")
      ?.closest(".ant-select-dropdown");
    expect(popup).not.toBeNull();
    expect(popup?.className ?? "").not.toContain("hidden");
    // 未下载的那一款不注入 @font-face：磁盘上没有文件，注入只会换来一次 404。
    const css = document.head.querySelector("style[data-rf-font-options]")?.textContent ?? "";
    expect(css).not.toContain("SourceHanSansSC-Regular.otf");
  });

  it("下载完成后：写成这份简历的字体一次，并提示已下载", async () => {
    apiMocks.listResumeFonts.mockResolvedValue({
      items: [
        {
          name: "SourceHanSansSC-Regular.otf",
          display_name: "思源黑体",
          size: 33493260,
          uploaded_at: "",
          active: false,
          builtin: true,
          downloaded: false,
        },
      ],
      active: null,
      max_bytes: 30 * 1024 * 1024,
    });
    apiMocks.startBuiltinFontDownload.mockResolvedValue({
      ...(await apiMocks.getBuiltinFont()),
      state: "downloading",
      downloaded_bytes: 1024,
    });
    apiMocks.getBuiltinFont.mockResolvedValue({
      id: "source-han-sans-sc",
      label: "思源黑体",
      size_total: 33493260,
      downloaded: true,
      downloaded_bytes: 33493260,
      total_bytes: 33493260,
      state: "done",
      error: "",
    });
    const onChange = renderControl();
    await openDropdown();

    fireEvent.click(await screen.findByText(t("fontDownload.optionHint")));

    // 500ms 一拍轮询到 done → 只写一次这份简历的字体。
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(onChange).toHaveBeenCalledWith({
      ...LAYOUT,
      format_config: { font: "SourceHanSansSC-Regular.otf" },
    });
    await waitFor(() =>
      expect(document.body.textContent).toContain(t("fontDownload.downloadedAndSet")),
    );
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

  it("收起下拉不中止已开始的下载轮询", async () => {
    // 「关闭下拉不中止」：下拉的开合只是 antd 的 UI 状态，轮询挂在组件层的 hook 上
    // （effect 只依赖 `state`），所以关掉弹层不会把这一轮下载停掉。
    apiMocks.listResumeFonts.mockResolvedValue({
      items: [
        {
          name: "SourceHanSansSC-Regular.otf",
          display_name: "思源黑体",
          size: 33493260,
          uploaded_at: "",
          active: false,
          builtin: true,
          downloaded: false,
        },
      ],
      active: null,
      max_bytes: 30 * 1024 * 1024,
    });
    const downloading = {
      id: "source-han-sans-sc",
      label: "思源黑体",
      size_total: 33493260,
      downloaded: false,
      downloaded_bytes: 1024,
      total_bytes: 33493260,
      state: "downloading" as const,
      error: "",
    };
    apiMocks.startBuiltinFontDownload.mockResolvedValue(downloading);
    apiMocks.getBuiltinFont.mockResolvedValue(downloading);

    renderControl();
    const select = await screen.findByRole("combobox", { name: "简历字体" });
    fireEvent.mouseDown(select);
    fireEvent.click(await screen.findByText(t("fontDownload.optionHint")));
    await waitFor(() => expect(apiMocks.startBuiltinFontDownload).toHaveBeenCalledTimes(1));

    // 收起下拉（Esc），然后等一拍：轮询必须继续打在状态接口上。
    fireEvent.keyDown(select, { key: "Escape", keyCode: 27, which: 27 });
    const before = apiMocks.getBuiltinFont.mock.calls.length;
    await waitFor(() => expect(apiMocks.getBuiltinFont.mock.calls.length).toBeGreaterThan(before), {
      timeout: 3000,
    });
  });

  it("弹层收窄到 260px：选项只留展示名 + 说明两层，完整信息进 title", async () => {
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

    await waitFor(() => expect(document.querySelector(".resume-params-dropdown")).not.toBeNull());

    // 悬停给出"展示名 · 磁盘文件名"两件事：宽度定死之后名字必然被截断，靠它看全。
    const option = await screen.findByTitle(
      "思源宋体（超粗·正式版） · source-han-serif-sc-heavy.otf",
    );
    expect(option.className).toContain("resume-font-option");
    // 展示名单独一层（省略由 CSS 负责）；磁盘文件名**不再**单独占一层，
    // 类名 `.resume-font-option-file` 本批起不再被引用（样式块留待清理）。
    expect(option.querySelector(".resume-font-option-name")?.textContent).toBe(
      "思源宋体（超粗·正式版）",
    );
    expect(option.querySelector(".resume-font-option-file")).toBeNull();
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
    // 关闭后 antd 给弹层加上 `hidden`——上面"下载中弹层不关"那条断言正是靠这个类判断的，
    // 这里顺手把它钉住，免得那个断言变成空转。
    // 关闭后弹层进入 `*-leave` 动画态（jsdom 不会有 transitionend，类名停在这里）。
    // 上面"下载中弹层不关"那条断言正是靠这个反向判断的，这里把它钉住，免得断言空转。
    expect(popupClass()).toContain("-leave");
  });
});
