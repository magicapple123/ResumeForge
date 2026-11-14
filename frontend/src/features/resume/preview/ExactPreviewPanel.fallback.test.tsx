// SPDX-License-Identifier: Apache-2.0
/**
 * 精确预览的降级链：图片渲染失败时退到 PDF，且两次请求用同一套 draft 选项；卸载时释放
 * object URL；两个端点都失败仍保留可操作的错误；面板隐藏时一个请求都不发。
 *
 * 守的是「降级不能降级成白屏」：出错时最怕既没有内容、也没有一句能照着做的原因。
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearPreviewCache } from "./exactPreviewCache";
import ExactPreviewPanel from "./ExactPreviewPanel";

const api = vi.hoisted(() => ({ pages: vi.fn(), pdf: vi.fn() }));
vi.mock("./previewPagesApi", () => ({
  fetchResumePreviewPages: api.pages,
  fetchPreviewFallbackPdf: api.pdf,
}));
beforeEach(() => {
  clearPreviewCache();
  api.pages.mockReset().mockRejectedValue(new Error("Rasterization failed"));
  api.pdf.mockReset().mockResolvedValue({ blob: new Blob(["%PDF"]) });
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = vi.fn(() => "blob:pdf-fallback");
      static revokeObjectURL = vi.fn();
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function panel(active = true) {
  return (
    <ExactPreviewPanel
      resumeId={7}
      template="classic"
      formatName=""
      pageLimit={2}
      fontScale="standard"
      formatConfig={{ page_padding: 14 }}
      contentSignature="fallback-test"
      height={600}
      active={active}
    />
  );
}

describe("PDF fallback retains access after image rendering fails", () => {
  it("requests the same draft options and releases the object URL on unmount", async () => {
    const view = render(panel());
    await waitFor(() =>
      expect(document.querySelector("iframe")).toHaveAttribute("src", "blob:pdf-fallback"),
    );
    expect(api.pdf).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        template: "classic",
        page_limit: 2,
        format_config: { page_padding: 14 },
      }),
      expect.any(AbortSignal),
    );
    view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:pdf-fallback");
  });

  it("preserves actionable errors when the PDF endpoint also fails", async () => {
    api.pdf.mockRejectedValue(new Error("PDF unavailable; retry"));
    render(panel());
    expect(await screen.findByText("PDF unavailable; retry")).toBeInTheDocument();
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("does not request either endpoint while the exact pane is hidden", () => {
    render(panel(false));
    expect(api.pages).not.toHaveBeenCalled();
    expect(api.pdf).not.toHaveBeenCalled();
  });
});
