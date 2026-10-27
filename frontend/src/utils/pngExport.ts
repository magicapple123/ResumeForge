// SPDX-License-Identifier: Apache-2.0
/**
 * 「图片（PNG）」导出的成品打包：一份 PDF → 单页 png 或 多页 zip。
 *
 * 与 `pdfToPng` 分开的原因是这两件事的失败语义不同：渲染失败要说"PDF 已生成、图片转换
 * 失败"；打包失败则说明是 zip 环节（内存 / 浏览器），两者提示不能混。分开也方便单测：
 * 渲染那层 mock 掉 pdfjs，打包这层可以直接跑真 JSZip。
 */
import { t, type MessageKey } from "../i18n";
import { renderPdfToPng, type RenderedPage } from "./pdfToPng";

/** 图片导出的成品：一个可直接下载的 blob + 建议文件名 + 页数。 */
export interface PngExportResult {
  blob: Blob;
  /** 单页 `xxx.png`，多页 `xxx.zip`。 */
  filename: string;
  /** 页数（= zip 里的条目数）。 */
  pages: number;
}

/** 文件名里不能出现的字符（Windows 比 POSIX 严，按 Windows 收）。 */
const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|]/g;

/** 兜底名（服务端没给文件名时用它）；文案在函数执行期取，模块作用域不求值 `t()`。 */
const FALLBACK_STEM_KEY: MessageKey = "fileUtils.pngExport.fallbackStem";

/**
 * 从导出文件名取"主名"（去掉扩展名）。
 *
 * 服务端 `build_filename` 的产物已经是 `<姓名>-<求职意向>-<YYYYMMDD>.<后缀>`，图片沿用同一个
 * 主名只换后缀，用户桌面上就不会出现"PDF 一个名、图片另一个名"。
 */
export function pdfFilenameStem(filename: string): string {
  const trimmed = (filename ?? "").trim();
  const dot = trimmed.lastIndexOf(".");
  const stem = dot > 0 ? trimmed.slice(0, dot) : trimmed;
  const safe = stem.replace(ILLEGAL_FILENAME_CHARS, "-").trim();
  return safe.length > 0 ? safe : t(FALLBACK_STEM_KEY);
}

/** 把渲染好的页面打成一个 zip（PNG 已压缩，用 STORE 不再做二次压缩）。 */
async function zipPages(pages: RenderedPage[], stem: string): Promise<Blob> {
  // 动态引入：只有多页（少数情况）才值得为 jszip 付这份解析成本。
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  for (const page of pages) {
    zip.file(`${stem}-${page.index}.png`, await page.blob.arrayBuffer());
  }
  return zip.generateAsync({ type: "blob", compression: "STORE" });
}

/**
 * 把一份 PDF blob 转成可下载的图片产物。
 *
 * @param pdfBlob 后端导出接口返回的 PDF（与「下载 PDF」完全相同的字节）。
 * @param pdfFilename 后端建议的文件名（`Content-Disposition`），用来推主名。
 * @param options 渲染选项（目标宽度等），透传给 {@link renderPdfToPng}。
 */
export async function exportPdfBlobAsPng(
  pdfBlob: Blob,
  pdfFilename: string,
  options: { targetWidth?: number } = {},
): Promise<PngExportResult> {
  const bytes = new Uint8Array(await pdfBlob.arrayBuffer());
  const pages = await renderPdfToPng(bytes, options);
  const stem = pdfFilenameStem(pdfFilename);

  if (pages.length === 1) {
    return { blob: pages[0].blob, filename: `${stem}.png`, pages: 1 };
  }
  return { blob: await zipPages(pages, stem), filename: `${stem}.zip`, pages: pages.length };
}

/**
 * 「PDF 生成了、图片没转成」的专用错误。
 *
 * 这句话必须说清楚是谁失败：PDF 那一侧其实已经成功，用户不该重跑整条导出管线，直接改勾
 * 「PDF」就能拿到成品。`cause` 挂在错误上供诊断（tsconfig 的 lib 是 ES2020，没有
 * `ErrorOptions`，只能手动挂）。
 */
function pngConversionFailed(detail: string, cause: unknown): Error {
  // 详情为空时用不带冒号的整句，避免渲染出悬空的「失败：。」。
  const message = detail
    ? t("fileUtils.pngExport.error.conversionFailedWithDetail", { detail })
    : t("fileUtils.pngExport.error.conversionFailed");
  const error = new Error(message);
  Object.assign(error, { cause });
  return error;
}

/** 图片导出的终态。`cancelled` = 用户在"还有未完成标记"的确认框里选择先去改简历。 */
export type PngExportOutcome =
  { status: "done"; blob: Blob; filename: string; pages: number } | { status: "cancelled" };

/**
 * 一整条图片导出链路：先拿 PDF（由调用方负责，含 409 草稿闸门），再光栅化打包。
 *
 * 调用方只管"下载返回的 blob"：把可下载产物与"取消 / 失败"的判定都收在这里，弹窗那边就
 * 不必既管 UI 又管失败语义。
 *
 * @param requestPdf 请求后端 PDF 的函数，返回 `null` 表示用户在闸门处放弃。
 * @throws 转换阶段失败时抛"PDF 已生成，图片转换失败…"（见 `pngConversionFailed`）。
 */
export async function runPngExport(
  requestPdf: () => Promise<{ blob: Blob; filename: string } | null>,
  options: { targetWidth?: number } = {},
): Promise<PngExportOutcome> {
  const pdf = await requestPdf();
  if (pdf === null) {
    return { status: "cancelled" };
  }

  let converted: PngExportResult | null = null;
  let failure: unknown = null;
  try {
    converted = await exportPdfBlobAsPng(pdf.blob, pdf.filename, options);
  } catch (err) {
    failure = err;
  }
  if (converted === null) {
    const detail = failure instanceof Error && failure.message ? failure.message : "";
    throw pngConversionFailed(detail, failure);
  }
  return {
    status: "done",
    blob: converted.blob,
    filename: converted.filename,
    pages: converted.pages,
  };
}
