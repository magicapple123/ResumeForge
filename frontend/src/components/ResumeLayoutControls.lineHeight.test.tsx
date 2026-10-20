// SPDX-License-Identifier: Apache-2.0
/**
 * 版式控件 · 行距（R20）。
 *
 * 行距是"内容差一行就多一页"时最有效的一档，此前只存在于模板工作台，主预览里没有入口。
 * 这里钉住三件事：
 * 1. **默认值取当前模板的真实行距**——写死一个数字会让滑块停在与渲染不同的位置；
 * 2. 拖动/步进按 0.05 提交，且提交的是"当前 layout + 新行距"，不覆盖同期改过的字号；
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
 * 版式栏里现在有**两处**合法的「随模板」：行距一行、页边距一行（T5 把页边距从导出面板
 * 搬进预览后各留了一个）。所以查这三个字必须限定作用域——全局 `getByText` 会多重命中，
 * 那不是 UI 错了，是断言范围太宽。锚点取「恢复默认行距」按钮：这个可访问名只有行距这
 * 一行有，再从它向上取到所在的版式行。
 */
function lineHeightRow(): HTMLElement {
  const anchor = screen.getByRole("button", { name: "恢复默认行距" });
  // 不用 `parentElement`：按钮禁用时 antd 的 Tooltip 会额外包一层 span，
  // 取最近的版式行（`Space`）才稳定——与 `ProfilePage.webform.test.tsx` 同一写法。
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
    renderControls();

    // classic 的默认行距是 1.70（后端 TEMPLATE_LAYOUT_DEFAULTS），不是写死的 1.7。
    expect(await screen.findByText("1.70")).toBeInTheDocument();
    // 行距这一行标「随模板」；页边距那一行也有一个（合法 UI，共两处）。
    expect(within(lineHeightRow()).getByText("随模板")).toBeInTheDocument();
    expect(screen.getAllByText("随模板")).toHaveLength(2);
    // 没设过覆盖时"恢复默认"不可点——它已经是默认了。
    expect(screen.getByRole("button", { name: "恢复默认行距" })).toBeDisabled();
  });

  it("加减按钮按 0.05 提交，并保留 layout 里的其它字段", async () => {
    const onChange = renderControls({
      layout: { ...DEFAULT_LAYOUT, page_limit: 2, format_name: "compact" },
    });
    await screen.findByText("1.70");

    fireEvent.click(screen.getByRole("button", { name: "减小行距" }));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(onChange).toHaveBeenCalledWith({
      template: "classic",
      format_name: "compact",
      page_limit: 2,
      font_scale: "standard",
      format_config: { line_height: 1.65 },
    });
  });

  it("已有覆盖时按覆盖值显示，并且可以一键回到随模板", async () => {
    const onChange = renderControls({
      layout: { ...DEFAULT_LAYOUT, format_config: { line_height: 1.45, accent: "#112233" } },
    });

    expect(await screen.findByText("1.45")).toBeInTheDocument();
    // 行距有了覆盖值就不再标「随模板」——但只能在自己的行里断言：页边距那一行的
    // 「随模板」仍然在，全局 `queryByText` 会把它算进来。
    expect(within(lineHeightRow()).queryByText("随模板")).not.toBeInTheDocument();
    expect(screen.getAllByText("随模板")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "恢复默认行距" }));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    // 只删 line_height，其它覆盖（强调色）原样保留。
    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_LAYOUT,
      format_config: { accent: "#112233" },
    });
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
