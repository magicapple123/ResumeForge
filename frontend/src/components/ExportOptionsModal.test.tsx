/** 统一导出面板：默认 PDF、版式草稿透传、水印/脱敏参数、未选格式拦截、409 草稿闸门。 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { withPagePadding } from "../utils/pagePadding";
import ExportOptionsModal from "./ExportOptionsModal";

const apiMocks = vi.hoisted(() => ({
  exportResumeWithOptions: vi.fn(),
  redactResume: vi.fn(),
}));

const downloadMocks = vi.hoisted(() => ({
  downloadBlob: vi.fn(),
  printHtml: vi.fn(),
}));

vi.mock("../api/resumes", () => apiMocks);
vi.mock("../utils/download", () => downloadMocks);

const RESULT = { blob: new Blob(["x"]), filename: "简历.pdf", pages: null, pageLimit: null };

const BLOCKED = new ApiError("个人总结 里还有「【待补」", 409);

interface RenderProps {
  initialPageLimit?: number;
  initialFontScale?: "small" | "standard" | "large";
  initialFormatConfig?: Record<string, number | string | string[]>;
}

function renderModal(props: RenderProps = {}) {
  return render(
    <AntdApp>
      <ExportOptionsModal recordId={7} open onClose={vi.fn()} {...props} />
    </AntdApp>,
  );
}

beforeEach(() => {
  apiMocks.exportResumeWithOptions.mockReset().mockResolvedValue(RESULT);
  apiMocks.redactResume.mockReset();
  downloadMocks.downloadBlob.mockReset();
  downloadMocks.printHtml.mockReset();
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
      font_scale: null,
      page_limit: null,
      format_config: undefined,
      include_photo: true,
      allow_incomplete: undefined,
    });
  });

  it("页边距只有一个落点：写进 format_config.page_padding，不再发 margin_mm（R1）", async () => {
    renderModal({ initialFormatConfig: { line_height: 1.55 } });

    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: /导\s*出/ }));

    await waitFor(() => expect(downloadMocks.downloadBlob).toHaveBeenCalledTimes(1));
    const [, payload] = apiMocks.exportResumeWithOptions.mock.calls[0] as [
      number,
      Record<string, unknown>,
    ];
    // 预览的草稿版式原样保留，页边距覆盖在它之上。
    expect(payload.format_config).toEqual({ line_height: 1.55, page_padding: 20 });
    // 两套参数并存正是"预览不变、导出变了"的来源，所以 margin_mm 必须彻底消失。
    expect(payload).not.toHaveProperty("margin_mm");
  });

  it("页边距越界值被 clamp 到 8–26（后端的白名单之外会被整条丢弃）", () => {
    // 直接钉 helper：antd 的 InputNumber 已经把手动输入挡在 8–26 内，clamp 守的是
    // "历史草稿 / 粘贴 / 程序化赋值"这条来路，只有单测能覆盖到。
    expect(withPagePadding(undefined, 5)).toEqual({ page_padding: 8 });
    expect(withPagePadding(undefined, 7)).toEqual({ page_padding: 8 });
    expect(withPagePadding(undefined, 40)).toEqual({ page_padding: 26 });
    expect(withPagePadding(undefined, 25.7)).toEqual({ page_padding: 26 });
    expect(withPagePadding(undefined, 14)).toEqual({ page_padding: 14 });
    // 没动滑块就原样透传预览的草稿版式，不凭空造一个 page_padding。
    expect(withPagePadding({ line_height: 1.55 }, null)).toEqual({ line_height: 1.55 });
    expect(withPagePadding(undefined, null)).toBeUndefined();
  });

  it("页边距的输入范围与预览一致（8–26，不是旧的 4–40）", () => {
    renderModal();

    const input = screen.getByRole("spinbutton");
    expect(input).toHaveAttribute("aria-valuemin", "8");
    expect(input).toHaveAttribute("aria-valuemax", "26");
  });

  it("页边距初值取预览当前的值，面板与预览不是两套数字", () => {
    renderModal({ initialFormatConfig: { page_padding: 14 } });

    expect(screen.getByRole("spinbutton")).toHaveValue("14");
  });

  it("把预览的页数、字号与版式草稿一起带给后端（否则导出与预览不同版）", async () => {
    renderModal({
      initialPageLimit: 2,
      initialFontScale: "small",
      initialFormatConfig: { font_scale_adjust: 0.636, line_height: 1.55 },
    });

    fireEvent.click(screen.getByRole("button", { name: /导\s*出/ }));

    await waitFor(() => expect(downloadMocks.downloadBlob).toHaveBeenCalledTimes(1));
    expect(apiMocks.exportResumeWithOptions).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        format: "pdf",
        page_limit: 2,
        font_scale: "small",
        format_config: { font_scale_adjust: 0.636, line_height: 1.55 },
      }),
    );
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

  it("正文还有未完成标记时：说明原因，用户确认后带 allow_incomplete 重试", async () => {
    apiMocks.exportResumeWithOptions.mockRejectedValueOnce(BLOCKED).mockResolvedValue(RESULT);
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: /导\s*出/ }));

    expect(await screen.findByText(/个人总结 里还有/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "仍要导出草稿" }));

    await waitFor(() => expect(downloadMocks.downloadBlob).toHaveBeenCalledTimes(1));
    expect(apiMocks.exportResumeWithOptions).toHaveBeenNthCalledWith(
      2,
      7,
      expect.objectContaining({ format: "pdf", allow_incomplete: true }),
    );
  });

  it("用户选择先去改简历时不下载任何文件", async () => {
    apiMocks.exportResumeWithOptions.mockRejectedValue(BLOCKED);
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: /导\s*出/ }));
    expect(await screen.findByText(/个人总结 里还有/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "我去改简历" }));

    await waitFor(() => expect(apiMocks.exportResumeWithOptions).toHaveBeenCalledTimes(1));
    expect(downloadMocks.downloadBlob).not.toHaveBeenCalled();
  });

  it("浏览器打印走同一份 HTML 请求（含草稿版式）", async () => {
    apiMocks.exportResumeWithOptions.mockResolvedValue({
      ...RESULT,
      blob: new Blob(["<html>预览</html>"]),
    });
    renderModal({ initialFormatConfig: { line_height: 1.55 } });

    fireEvent.click(screen.getByRole("button", { name: /浏览器打印/ }));

    await waitFor(() => expect(downloadMocks.printHtml).toHaveBeenCalledTimes(1));
    expect(apiMocks.exportResumeWithOptions).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ format: "html", format_config: { line_height: 1.55 } }),
    );
  });

  it("展示能力范围说明：服务端引擎生成 PDF/Word，自编 HTML 复杂版式引导浏览器打印", () => {
    // RF-16：诚实的能力范围就地提示——只说引擎来源与替代路径，不得出现
    // "ATS 通过率"之类的承诺。
    renderModal();

    expect(screen.getByText(/PDF 与 Word 由服务端排版引擎生成/)).toBeInTheDocument();
    expect(screen.queryByText(/ATS 通过/)).not.toBeInTheDocument();
  });
});
