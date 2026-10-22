// SPDX-License-Identifier: Apache-2.0
/**
 * 版式控件 · 行距（R20）。
 *
 * 行距是"内容差一行就多一页"时最有效的一档，此前只存在于模板工作台，主预览里没有入口。
 * 这里钉住三件事：
 * 1. **默认值取当前模板的真实行距**——写死一个数字会让滑块停在与渲染不同的位置；
 * 2. 拖动/步进按 0.01 提交，且提交的是"当前 layout + 新行距"，不覆盖同期改过的字号；
 * 3. 恢复默认是**删掉这个键**（回到随模板），不是写回一个和默认相等的值。
 */
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEMPLATE_CATALOG } from "../test/resumeFixtures";
import { DEFAULT_LAYOUT, renderControls } from "./ResumeLayoutControls.testkit";

const apiMocks = vi.hoisted(() => ({
  fetchResumeTemplates: vi.fn(),
  previewResumeTemplate: vi.fn(),
}));

vi.mock("../api/resumes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/resumes")>()),
  fetchResumeTemplates: apiMocks.fetchResumeTemplates,
  previewResumeTemplate: apiMocks.previewResumeTemplate,
}));

/**
 * 行距这一行（`LineHeightControl` 的外层容器）。
 *
 * 版式栏里现在有**三处**合法的「随模板」：行距、页边距、照片（2026-10-22 加了照片大小
 * 与四向页边距两条滑杆，它们各自也带一个来源标签）。所以查这三个字必须限定作用域——
 * 全局 `getByText` 会多重命中，那不是 UI 错了，是断言范围太宽。锚点取「行距」这个标题
 * 文字：只有行距这一行有，再从它向上取到所在的版式行（恢复默认已改成双击标题，
 * 不再有独立的 ↺ 按钮）。
 */
function lineHeightRow(): HTMLElement {
  const anchor = screen.getByText("行距");
  // 从标题向上取最近的版式行（`Space`）。
  const row = anchor.closest(".ant-space");
  if (!row) throw new Error("找不到行距控件所在的版式行");
  return row as HTMLElement;
}

beforeEach(() => {
  apiMocks.fetchResumeTemplates.mockReset();
  apiMocks.previewResumeTemplate.mockReset();
  apiMocks.fetchResumeTemplates.mockResolvedValue(TEMPLATE_CATALOG);
  apiMocks.previewResumeTemplate.mockResolvedValue("<html></html>");
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("ResumeLayoutControls · 行距（R20）", () => {
  it("没设过覆盖时显示当前模板的默认行距，并标注「随模板」", async () => {
    const onChange = renderControls();

    // classic 的默认行距是 1.70（后端 TEMPLATE_LAYOUT_DEFAULTS），不是写死的 1.7。
    expect(await screen.findByText("1.70")).toBeInTheDocument();
    // 行距这一行标「随模板」；页边距与照片各有一个（合法 UI，共三处）。
    expect(within(lineHeightRow()).getByText("随模板")).toBeInTheDocument();
    expect(screen.getAllByText("随模板")).toHaveLength(3);
    // 恢复默认改成双击标题：独立的 ↺ 按钮已删除，已经是默认值时双击不提交。
    expect(screen.queryByRole("button", { name: "恢复默认行距" })).toBeNull();
    fireEvent.doubleClick(within(lineHeightRow()).getByText("行距"));
    // 上面那句注释的断言在这里：没有覆盖值时 reset 直接返回，不触发 onChange。
    expect(onChange).not.toHaveBeenCalled();
  });

  it("加减按钮按 0.01 提交，并保留 layout 里的其它字段", async () => {
    const onChange = renderControls({
      layout: { ...DEFAULT_LAYOUT, page_limit: 2, format_name: "compact" },
    });
    // 版式是「紧凑」：滑杆从预设的 1.45 起算（不再是模板默认的 1.70）。
    await within(lineHeightRow()).findByText("1.45");

    fireEvent.click(screen.getByRole("button", { name: "减小行距" }));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(onChange).toHaveBeenCalledWith({
      template: "classic",
      format_name: "compact",
      page_limit: 2,
      font_scale: "standard",
      format_config: { line_height: 1.44 },
    });
  });

  it("换版式后滑杆显示预设值，而不是模板默认", async () => {
    renderControls({ layout: { ...DEFAULT_LAYOUT, format_name: "compact" } });

    const row = lineHeightRow();
    expect(await within(row).findByText("1.45")).toBeInTheDocument();
    expect(within(row).queryByText("1.70")).not.toBeInTheDocument();
    // 页边距同理：紧凑是 11mm，模板默认 14mm。
    expect(await screen.findByText("11mm")).toBeInTheDocument();
  });

  it("已有覆盖时按覆盖值显示，并且可以一键回到随模板", async () => {
    const onChange = renderControls({
      layout: { ...DEFAULT_LAYOUT, format_config: { line_height: 1.45, accent: "#112233" } },
    });

    expect(await screen.findByText("1.45")).toBeInTheDocument();
    // 行距有了覆盖值就不再标「随模板」——但只能在自己的行里断言：页边距与照片那两行的
    // 「随模板」仍然在，全局 `queryByText` 会把它们算进来。
    expect(within(lineHeightRow()).queryByText("随模板")).not.toBeInTheDocument();
    expect(screen.getAllByText("随模板")).toHaveLength(2);

    fireEvent.doubleClick(within(lineHeightRow()).getByText("行距"));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    // 只删 line_height，其它覆盖（强调色）原样保留。
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_LAYOUT,
      format_config: { accent: "#112233" },
    });
  });

  it("键盘 Enter / 空格等价于双击恢复默认，其它键不触发（不吞滑块的键盘行为）", async () => {
    const onChange = renderControls({
      layout: { ...DEFAULT_LAYOUT, format_config: { line_height: 1.45, accent: "#112233" } },
    });
    await screen.findByText("1.45");

    // 提示从原生 title 换成 Tooltip 之后，"这里可双击"必须也能被键盘触达：
    // 标题是 role=button + tabIndex=0，Enter / 空格等价于双击。
    const label = within(lineHeightRow()).getByRole("button", {
      name: "行距（双击或按回车恢复默认）",
    });
    expect(label).toHaveAttribute("tabindex", "0");

    // 非激活键必须放行：否则会把同排滑块的键盘操作一起吞掉。
    fireEvent.keyDown(label, { key: "a" });
    fireEvent.keyDown(label, { key: "ArrowUp" });
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.keyDown(label, { key: "Enter" });
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_LAYOUT,
      format_config: { accent: "#112233" },
    });

    fireEvent.keyDown(label, { key: " " });
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
  });

  it("下限处不再继续减小", async () => {
    const onChange = renderControls({
      layout: { ...DEFAULT_LAYOUT, format_config: { line_height: 1.2 } },
    });
    await screen.findByText("1.20");

    expect(screen.getByRole("button", { name: "减小行距" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "减小行距" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("换模板后行距回到新模板的默认值（旧模板的默认不该被当成用户的覆盖）", async () => {
    renderControls({
      layout: { ...DEFAULT_LAYOUT, template: "compact" },
    });

    // compact 的默认行距 1.55 由后端目录下发。
    expect(await screen.findByText("1.55")).toBeInTheDocument();
  });
});
