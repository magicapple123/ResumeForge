// SPDX-License-Identifier: Apache-2.0
/**
 * 画布页数的**取数端**（问题 3）：把 `pagination/report` 的 `pages_needed` 交给画布。
 *
 * ## 为什么画布要自己取这份报告
 *
 * 报告的原始消费者是左栏分页面板（用户手动点「获取分页报告」）。但"草稿说 7 页、导出是
 * 8 页"这件事必须在**纸面上**就收敛，而纸面只有画布知道；所以画布自己也取一份，键是
 * `内容 + 版式` 的指纹：
 *
 * - 指纹相同 → 命中本地缓存，**一次网络、一次 PDF 重排都不发**（同一份内容只请求一次）；
 * - 指纹变了 → 600ms 合并窗口之后重取（与草稿实时预览的防抖同值）；
 * - 取不到（没有 `resumeId`、请求失败、断网）→ 返回 `null`，画布退回浏览器测量。
 *
 * ## 为什么缓存放在模块级
 *
 * 同一屏上常常有两个画布（主预览 + 制作台右栏），它们对同一份内容各挂一次这个 hook。
 * 缓存让第二次直接命中，不会为了同一个页数排两遍 PDF。key 里带 `resumeId` 与
 * "是否带未保存正文"，所以不同简历 / 不同来源不会互相污染。
 *
 * ## 这里**只**返回页数
 *
 * 截断位置、手动断页、末页占用仍然只在左栏那条链路上消费（它们不参与画布几何）。
 * 少一个字段就少一处"两个画布对同一份报告理解不同"的机会。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ExactPreviewOptions } from "./exactPreviewOptions";
import { usePaginationReport } from "../../features/resume-pagination/usePaginationReport";
import type { PaginationReportRequest } from "../../features/resume-pagination/paginationReport";

/** 自动取数的合并窗口（与草稿实时预览同值）。 */
const REPORT_DELAY_MS = 600;
/** 缓存上限：一份简历的几种版式组合足够用，超出就整批丢掉（不做 LRU，页数重算很便宜）。 */
const CACHE_LIMIT = 32;
/** 页数缓存：签名 → `pages_needed`（只存成功结果）。 */
const pageCountCache = new Map<string, number>();

/**
 * 进请求体 / 进指纹的页数上限：**0（不限）原样发 0**，其余夹到 ≥1。
 *
 * 为什么不能一律 `Math.max(1, …)`：0 是"不限篇幅"这个**语义值**，折成 1 就等于让用户
 * 选了最严的一页——报告会按 1 页排、`truncated_at` 还会指向被裁掉的内容。
 * 指纹同样要区分 0 与 1：两者在服务端的排版结论完全不同，共用一个 key 会互相污染缓存。
 */
function requestPageLimit(pageLimit: number): number {
  return pageLimit === 0 ? 0 : Math.max(1, Math.round(pageLimit));
}

/** 32 位字符串散列：只需要"不同内容不同 key"，不用于安全用途。 */
function hashText(text: string): string {
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0;
  }
  return (hash >>> 0).toString(36);
}

function readCache(signature: string): number | null {
  if (!signature) return null;
  const hit = pageCountCache.get(signature);
  return typeof hit === "number" && hit > 0 ? hit : null;
}

function writeCache(signature: string, pages: number): void {
  if (!signature) return;
  if (pageCountCache.size >= CACHE_LIMIT) pageCountCache.clear();
  pageCountCache.set(signature, pages);
}

export interface ReportedPageCountOptions {
  /** 已构造好的精确预览上下文：`resumeId` 与全部版式字段都在里面（唯一构造处）。 */
  exactPreview?: ExactPreviewOptions | null;
  /**
   * 当前的页数上限（进请求体，也进指纹——上限变了服务端会重排一次）。
   *
   * `0` = 「不限篇幅」：原样发 0（服务端按不裁剪排），不要夹成 1 页。
   */
  pageLimit: number;
}

/**
 * 服务端报告给出的页数；`null` = 拿不到（调用方退回浏览器测量）。
 *
 * **不抛错、不阻塞**：任何一步失败都只是返回 `null`，编辑与画布照常。
 */
export function useReportedPageCount({
  exactPreview,
  pageLimit,
}: ReportedPageCountOptions): number | null {
  const resumeId = exactPreview?.resumeId ?? null;
  /**
   * 指纹：报告只对"这一版内容 + 这一版版式"成立。
   *
   * 含 `contentSignature`（宿主给的正文身份）与"请求里带不带未保存正文"这一位——
   * 同一个 `contentSignature` 在不同来源下对应不同的请求体，不能共用缓存。
   */
  const signature = useMemo(() => {
    if (!exactPreview) return "";
    const parts = [
      String(exactPreview.resumeId),
      String(requestPageLimit(pageLimit)),
      exactPreview.template,
      exactPreview.formatName,
      exactPreview.fontScale,
      exactPreview.language,
      hashText(JSON.stringify(exactPreview.formatConfig ?? {})),
      hashText(exactPreview.contentSignature ?? ""),
      exactPreview.content ? "draft" : "saved",
    ];
    return parts.join("|");
  }, [exactPreview, pageLimit]);

  // 命中缓存的签名与页数：签名一变就重新读缓存（不再走"上一个签名的页数"）。
  const [state, setState] = useState<{ signature: string; pages: number | null }>(() => ({
    signature,
    pages: readCache(signature),
  }));
  if (state.signature !== signature) {
    setState({ signature, pages: readCache(signature) });
  }
  const cachedPages = state.signature === signature ? state.pages : readCache(signature);

  const buildRequest = useCallback((): PaginationReportRequest | null => {
    if (!exactPreview) return null;
    const request: PaginationReportRequest = {
      template: exactPreview.template,
      // 「不限」发 0（后端 `PreviewPdfRequest.page_limit` 的 `ge=0` 就是为它开的）；
      // 其余仍夹到 ≥1，别把"上限 0 页"这种不可能的值发出去。
      page_limit: requestPageLimit(pageLimit),
      font_scale: exactPreview.fontScale,
      language: exactPreview.language,
      format_config: exactPreview.formatConfig,
    };
    // 空字符串的版式名不传：后端把"没给 format_name"当成"用记录里那份版式"，
    // 传一个空串反而会走另一条解析分支（与 `PreviewPdfRequest` 的既有约定一致）。
    if (exactPreview.formatName) request.format_name = exactPreview.formatName;
    // 未保存正文（制作台中栏）：与精确预览同一条边界，不落库。
    if (exactPreview.content) request.content = exactPreview.content;
    return request;
  }, [exactPreview, pageLimit]);

  const pagination = usePaginationReport({
    resumeId,
    buildRequest,
    // 已经知道答案（缓存命中）就不再请求：同一份内容只排一次 PDF。
    auto: signature && cachedPages === null ? { signature, delayMs: REPORT_DELAY_MS } : null,
  });

  useEffect(() => {
    // 只接受"为这个签名算出来的"报告：换内容后旧报告还在 state 里，不能拿来用。
    if (!signature || pagination.reportSignature !== signature) return;
    const reported = pagination.report?.pagesNeeded ?? null;
    if (typeof reported !== "number" || !Number.isFinite(reported) || reported < 1) return;
    const pages = Math.round(reported);
    writeCache(signature, pages);
    setState({ signature, pages });
  }, [pagination.report, pagination.reportSignature, signature]);

  return cachedPages;
}
