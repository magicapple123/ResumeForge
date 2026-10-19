/**
 * 版式控件 · 行距（R20）。
 *
 * 行距是"内容差一行就多一页"时最有效的一档，此前只存在于模板工作台，主预览里没有入口。
 * 这里钉住三件事：
 * 1. **默认值取当前模板的真实行距**——写死一个数字会让滑块停在与渲染不同的位置；
 * 2. 拖动/步进按 0.05 提交，且提交的是"当前 layout + 新行距"，不覆盖同期改过的字号；
 * 3. 恢复默认是**删掉这个键**（回到随模板），不是写回一个和默认相等的值。
 */
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
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
    expect(screen.getByText("随模板")).toBeInTheDocument();
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
    expect(screen.queryByText("随模板")).not.toBeInTheDocument();

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
