/** 统一导出选项：默认 PDF 导出、水印/脱敏参数透传、未选格式拦截。 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ExportOptionsModal from "./ExportOptionsModal";

const apiMocks = vi.hoisted(() => ({
  exportResumeWithOptions: vi.fn(),
}));

const downloadMocks = vi.hoisted(() => ({
  downloadBlob: vi.fn(),
}));

vi.mock("../api/resumes", () => apiMocks);
vi.mock("../utils/download", () => downloadMocks);

const RESULT = { blob: new Blob(["x"]), filename: "简历.pdf", pages: null, pageLimit: null };

function renderModal() {
  return render(
    <AntdApp>
      <ExportOptionsModal recordId={7} open onClose={vi.fn()} />
    </AntdApp>,
  );
}

beforeEach(() => {
  apiMocks.exportResumeWithOptions.mockReset().mockResolvedValue(RESULT);
  downloadMocks.downloadBlob.mockReset();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ExportOptionsModal", () => {
  it("默认按 PDF 导出并下载", async () => {
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: /导\s*出/ }));

    await waitFor(() => expect(downloadMocks.downloadBlob).toHaveBeenCalledTimes(1));
    expect(apiMocks.exportResumeWithOptions).toHaveBeenCalledWith(7, {
      format: "pdf",
      watermark: "",
      redact: false,
      redact_options: undefined,
      margin_mm: null,
      font_scale: null,
      page_limit: null,
      include_photo: true,
    });
  });

  it("带上水印与脱敏范围一起导出", async () => {
    renderModal();

    fireEvent.click(screen.getByRole("switch", { name: "开启水印" }));
    fireEvent.change(screen.getByPlaceholderText(/水印文案/), {
      target: { value: "内部使用" },
    });
    fireEvent.click(screen.getByRole("switch", { name: "开启脱敏" }));

    fireEvent.click(screen.getByRole("button", { name: /导\s*出/ }));

    await waitFor(() => expect(downloadMocks.downloadBlob).toHaveBeenCalledTimes(1));
    expect(apiMocks.exportResumeWithOptions).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        format: "pdf",
        watermark: "内部使用",
        redact: true,
        redact_options: expect.objectContaining({ mask_name: true, mask_company: true }),
      }),
    );
  });

  it("未选格式时提示而不是导出", async () => {
    renderModal();

    // 取消默认勾选的 PDF。
    fireEvent.click(screen.getByRole("checkbox", { name: "PDF" }));
    fireEvent.click(screen.getByRole("button", { name: /导\s*出/ }));

    await waitFor(() => expect(screen.getByText(/至少选择一种导出格式/)).toBeInTheDocument());
    expect(apiMocks.exportResumeWithOptions).not.toHaveBeenCalled();
  });

  it("展示能力范围说明：服务端引擎生成 PDF/Word，自编 HTML 复杂版式引导浏览器打印", () => {
    // RF-16：诚实的能力范围就地提示——只说引擎来源与替代路径，不得出现
    // "ATS 通过率"之类的承诺。
    renderModal();

    expect(screen.getByText(/PDF 与 Word 由服务端排版引擎生成/)).toBeInTheDocument();
    expect(screen.queryByText(/ATS 通过/)).not.toBeInTheDocument();
  });
});
