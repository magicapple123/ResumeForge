// SPDX-License-Identifier: Apache-2.0
/**
 * 统一导出面板（T5）：默认 PDF、**版式草稿原样透传**、水印/脱敏参数、未选格式拦截、409 草稿闸门。
 *
 * 版式（页数/字号/页边距）与脱敏预览已从面板移出：前者归预览的版式栏，后者走真实导出的
 * `redact` 参数。面板因此只剩「导出什么」——格式 / 水印 / 脱敏范围 / 照片。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { clampPagePadding } from "../utils/pagePadding";
import ExportOptionsModal from "./ExportOptionsModal";

const apiMocks = vi.hoisted(() => ({ exportResumeWithOptions: vi.fn() }));

const downloadMocks = vi.hoisted(() => ({
  downloadBlob: vi.fn(),
  printHtml: vi.fn(),
}));

/**
 * 只 mock 光栅化那一层：`pngExport`（单页 png / 多页 zip 的分流）跑真代码，
 * 这样"多页打 zip"这条路径才算被覆盖到。
 */
const pngMocks = vi.hoisted(() => ({ renderPdfToPng: vi.fn() }));

vi.mock("../api/resumes", () => apiMocks);
vi.mock("../utils/download", () => downloadMocks);
vi.mock("../utils/pdfToPng", () => pngMocks);

const RESULT = { blob: new Blob(["x"]), filename: "简历.pdf", pages: null, pageLimit: null };

/** 一页"已渲染好"的占位结果（光栅化本身由 pdfToPng.test.ts 覆盖）。 */
function renderedPage(index: number) {
  return {
    index,
    blob: new Blob([`png-${index}`], { type: "image/png" }),
    width: 2480,
    height: 3508,
  };
}

/** 勾掉默认的 PDF、改勾「图片（PNG）」，再点导出。 */
function exportPngOnly() {
  fireEvent.click(screen.getByRole("checkbox", { name: "PDF" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "图片（PNG）" }));
  fireEvent.click(screen.getByRole("button", { name: /导\s*出/ }));
}

const BLOCKED = new ApiError("个人总结 里还有「【待补」", 409);

interface RenderProps {
  initialPageLimit?: number;
  initialFontScale?: "small" | "standard" | "large";
  initialFormatConfig?: Record<string, number | string | string[]>;
  initialLanguage?: "zh-CN" | "en-US";
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
  downloadMocks.downloadBlob.mockReset();
  downloadMocks.printHtml.mockReset();
  pngMocks.renderPdfToPng.mockReset();
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
      // 没传草稿语言 → null（"不覆盖，用记录里的语言"）。
      language: null,
      include_photo: true,
      allow_incomplete: undefined,
    });
  });

  it("面板里不再有「版式」栏与「预览脱敏效果」：版式归预览，脱敏预览已下线（T5）", () => {
    renderModal({ initialFormatConfig: { line_height: 1.55, page_padding: 14 } });

    // 版式三项（页数/字号/页边距）连同标题一起消失：唯一入口是预览的版式栏。
    expect(screen.queryByText("版式")).not.toBeInTheDocument();
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(screen.queryByText("预览脱敏效果")).not.toBeInTheDocument();

    // 脱敏开关与勾选项仍在（真实导出走 POST /export 的 redact 参数）。
    fireEvent.click(screen.getByRole("switch", { name: "开启脱敏" }));
    expect(screen.getByRole("checkbox", { name: /姓名/ })).toBeInTheDocument();
  });

  it("页边距越界值被 clamp 到 0–26（版式栏的滑块与后端白名单之间只有这一道）", () => {
    // 直接钉 helper：`PagePaddingControl` 的滑块已经挡在 0–26 内（项 4a 从 InputNumber
    // 改成滑块，边界随 2026-10-22 的下限放开一起变），clamp 守的是"历史草稿 / 粘贴 /
    // 程序化赋值"这条来路，只有单测能覆盖到。
    expect(clampPagePadding(-2)).toBe(0);
    expect(clampPagePadding(0)).toBe(0);
    expect(clampPagePadding(40)).toBe(26);
    // 0.1mm 精度后，范围内的小数原样保留（以前取整到 26）。
    expect(clampPagePadding(25.7)).toBe(25.7);
    expect(clampPagePadding(14)).toBe(14);
    expect(clampPagePadding(Number.NaN)).toBe(0);
  });

  it("页数 / 字号 / 版式草稿全部原样取自预览（面板不再覆盖任何一项，T5）", async () => {
    renderModal({
      initialPageLimit: 2,
      initialFontScale: "small",
      initialFormatConfig: { font_scale_adjust: 0.636, line_height: 1.55, page_padding: 14 },
    });

    fireEvent.click(screen.getByRole("button", { name: /导\s*出/ }));

    await waitFor(() => expect(downloadMocks.downloadBlob).toHaveBeenCalledTimes(1));
    expect(apiMocks.exportResumeWithOptions).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        format: "pdf",
        page_limit: 2,
        font_scale: "small",
        format_config: { font_scale_adjust: 0.636, line_height: 1.55, page_padding: 14 },
      }),
    );
  });

  it("预览里切了 English：导出请求体带上草稿语言（否则下载到的仍是中文标题）", async () => {
    renderModal({ initialLanguage: "en-US" });

    fireEvent.click(screen.getByRole("button", { name: /导\s*出/ }));

    await waitFor(() => expect(downloadMocks.downloadBlob).toHaveBeenCalledTimes(1));
    expect(apiMocks.exportResumeWithOptions).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ format: "pdf", language: "en-US" }),
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
    // B3：闸门是面板内的一条 Alert，不是第二层容器——同一时刻仍然只有一个 dialog。
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
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
    renderModal({ initialFormatConfig: { line_height: 1.55 }, initialLanguage: "en-US" });

    fireEvent.click(screen.getByRole("button", { name: /浏览器打印/ }));

    await waitFor(() => expect(downloadMocks.printHtml).toHaveBeenCalledTimes(1));
    expect(apiMocks.exportResumeWithOptions).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        format: "html",
        format_config: { line_height: 1.55 },
        // 打印走同一个 buildRequest：语言同样要跟着草稿走。
        language: "en-US",
      }),
    );
  });

  it("「包含照片」开关仍写 include_photo（它只影响导出内容，不参与预览渲染）", async () => {
    renderModal();

    // 挪进「格式」区块并改名，语义不变。
    expect(screen.queryByRole("switch", { name: "显示照片" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: "包含照片" }));
    fireEvent.click(screen.getByRole("button", { name: /导\s*出/ }));

    await waitFor(() => expect(downloadMocks.downloadBlob).toHaveBeenCalledTimes(1));
    expect(apiMocks.exportResumeWithOptions).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ include_photo: false }),
    );
  });

  it("展示能力范围说明：服务端引擎生成 PDF/Word，自编 HTML 复杂版式引导浏览器打印", () => {
    // RF-16：诚实的能力范围就地提示——只说引擎来源与替代路径，不得出现
    // "ATS 通过率"之类的承诺。
    renderModal();

    expect(screen.getByText(/PDF 与 Word 由服务端排版引擎生成/)).toBeInTheDocument();
    expect(screen.queryByText(/ATS 通过/)).not.toBeInTheDocument();
  });

  it("「图片（PNG）」请求的仍是 PDF：图片与用户下载的 PDF 是同一份字节", async () => {
    pngMocks.renderPdfToPng.mockResolvedValue([renderedPage(1)]);
    renderModal();

    exportPngOnly();

    await waitFor(() => expect(downloadMocks.downloadBlob).toHaveBeenCalledTimes(1));
    // 关键断言：后端枚举里没有 png，永远不能把 "png" 发出去。
    expect(apiMocks.exportResumeWithOptions).toHaveBeenCalledTimes(1);
    expect(apiMocks.exportResumeWithOptions).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ format: "pdf" }),
    );
    expect(apiMocks.exportResumeWithOptions.mock.calls[0][1].format).not.toBe("png");
  });

  it("单页直接下载 png，文件名沿用导出主名只换后缀", async () => {
    pngMocks.renderPdfToPng.mockResolvedValue([renderedPage(1)]);
    renderModal();

    exportPngOnly();

    await waitFor(() => expect(downloadMocks.downloadBlob).toHaveBeenCalledTimes(1));
    const [blob, filename] = downloadMocks.downloadBlob.mock.calls[0];
    expect(filename).toBe("简历.png");
    expect((blob as Blob).type).toBe("image/png");
  });

  it("多页打成一个 zip（内含 简历-1.png、简历-2.png），且只请求一次 PDF", async () => {
    pngMocks.renderPdfToPng.mockResolvedValue([renderedPage(1), renderedPage(2)]);
    renderModal();

    exportPngOnly();

    await waitFor(() => expect(downloadMocks.downloadBlob).toHaveBeenCalledTimes(1));
    const [blob, filename] = downloadMocks.downloadBlob.mock.calls[0];
    expect(filename).toBe("简历.zip");
    expect(apiMocks.exportResumeWithOptions).toHaveBeenCalledTimes(1);

    const zip = await JSZip.loadAsync(await (blob as Blob).arrayBuffer());
    expect(Object.keys(zip.files).sort()).toEqual(["简历-1.png", "简历-2.png"]);
  });

  it("光栅化失败时说明「PDF 已生成」，并且不下载半成品", async () => {
    pngMocks.renderPdfToPng.mockRejectedValue(new Error("画布过大"));
    renderModal();

    exportPngOnly();

    expect(await screen.findByText(/PDF 已生成，图片转换失败/)).toBeInTheDocument();
    expect(downloadMocks.downloadBlob).not.toHaveBeenCalled();
  });

  it("勾上图片格式时才提示定位：投递平台收图片，机器筛选用 PDF", () => {
    renderModal();

    expect(screen.queryByText(/必须上传图片的投递平台/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "图片（PNG）" }));
    expect(screen.getByText(/必须上传图片的投递平台/)).toBeInTheDocument();
    expect(screen.getByText(/需要机器筛选（ATS）时请用 PDF/)).toBeInTheDocument();
  });
});
