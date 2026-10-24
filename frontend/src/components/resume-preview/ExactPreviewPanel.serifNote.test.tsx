// SPDX-License-Identifier: Apache-2.0
/**
 * 精确预览状态行里那句**衬线字族说明**（P1-2）。
 *
 * 只在"确实不一样"时该出现：精确预览用嵌入 PDF 的中文黑体，而优雅 / 社论两款模板的标题
 * 字族是 CSS 衬线。三条分支各一条断言——多显示一条会变成噪音，少显示一条用户会以为模板坏了。
 *
 * 单文件 500 行预算零豁免，所以从 `ExactPreviewPanel.test.tsx` 拆出来单放。
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import ExactPreviewPanel from "./ExactPreviewPanel";
import { clearPreviewCache } from "./exactPreviewCache";

const fetchPreview = vi.hoisted(() => vi.fn());

vi.mock("../../api/resumes", () => ({
  fetchResumePreviewPdf: fetchPreview,
}));

beforeEach(() => {
  fetchPreview.mockReset();
  clearPreviewCache();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: () => "blob:preview-1",
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: () => undefined,
  });
});

afterEach(() => {
  cleanup();
});

/** 等过去抖窗口（真实定时器：`findBy*` 自己要用真实定时器轮询）。 */
function waitForRequest() {
  return new Promise((resolve) => setTimeout(resolve, 420));
}

function pdf(pages = 1) {
  return {
    blob: new Blob(["%PDF-1.3"], { type: "application/pdf" }),
    pages,
    pagesNeeded: pages,
    pageLimit: pages,
    overflow: false,
  };
}

type PanelProps = Parameters<typeof ExactPreviewPanel>[0];

function panel(overrides: Partial<PanelProps> = {}) {
  return (
    <ExactPreviewPanel
      resumeId={7}
      template="classic"
      formatName=""
      pageLimit={1}
      fontScale="standard"
      formatConfig={{ page_padding: 14 }}
      contentSignature="c1"
      height={600}
      {...overrides}
    />
  );
}

/**
 * 衬线标题的字族说明（P1-2）。
 *
 * 这句说明只在"确实不一样"时该出现：精确预览用嵌入 PDF 的中文黑体，而优雅 / 社论两款模板
 * 的标题字族是 CSS 衬线。三条分支各一条断言——多显示一条会变成噪音，少显示一条则用户会
 * 以为模板坏了。
 */
describe("ExactPreviewPanel · 衬线标题说明（P1-2）", () => {
  it("衬线模板 + 精确口径可见：状态行给出那句常驻说明", async () => {
    fetchPreview.mockResolvedValue(pdf(1));

    render(panel({ template: "elegant", headingSerif: true }));
    await waitForRequest();

    expect(await screen.findByText(t("exact.serifNote"))).toBeTruthy();
  });

  it("非衬线模板：不出现（与事实无关的提示就是噪音）", async () => {
    fetchPreview.mockResolvedValue(pdf(1));

    render(panel({ template: "classic", headingSerif: false }));
    await waitForRequest();

    // 等状态行出现（按 class 等，而不是按中文文案——新增测试文件里不做中文 `*ByText` 断言）。
    await waitFor(() => {
      expect(document.querySelector(".exact-preview-status")).not.toBeNull();
    });
    expect(screen.queryByText(t("exact.serifNote"))).toBeNull();
  });

  it("切回草稿（面板不可见）后说明消失，不必额外状态", async () => {
    fetchPreview.mockResolvedValue(pdf(1));

    render(panel({ template: "elegant", headingSerif: true, active: false }));
    await waitForRequest();

    expect(screen.queryByText(t("exact.serifNote"))).toBeNull();
  });
});
