// SPDX-License-Identifier: Apache-2.0
/** 简历相关接口：生成（SSE）、历史、渲染预览、导出下载。 */
import type { ResumeFormatConfig } from "../types/resumeFormat";
import type {
  DeliveryDetail,
  DeliverySummary,
  ExportFormat,
  ExportRequest,
  Page,
  RedactionOptions,
  ResumeBrief,
  ResumeContent,
  ResumeDetail,
  ResumeFontScale,
  ResumePendingChange,
  ResumeProfileUsage,
  ResumeReviewResult,
  ResumeSuggestions,
  ResumeSort,
  ResumeTemplateCatalog,
} from "../types";
import { buildQuery, getFilenameFromDisposition, request, requestRaw } from "./client";

// 新建 / 后台生成接口已等价提取到 `resumeCreation.ts`（500 行预算 + F4 快照字段）。
// re-export 保持既有导入路径与 `vi.mock("../api/resumes")` 的落点不变。
export {
  cancelResumeGenerateTask,
  createManualResume,
  getResumeGenerateTask,
  startResumeGeneration,
} from "./resumeCreation";

// 版式三件套（调整 / 诊断 / 渲染）已迁至 `resumeLayout.ts`（单文件 500 行预算）。
// 这里 re-export 保持既有导入路径不变——调用方与 `vi.mock("../api/resumes")` 都不用改。
export { analyzeResumeLayout, renderResume, updateResumeLayout } from "./resumeLayout";

export function listResumes(
  params: {
    keyword?: string;
    page?: number;
    page_size?: number;
    job_id?: number;
    favorite?: boolean;
    /** false 只取通用简历（未关联任何岗位） */
    has_job?: boolean;
    /** 列表排序（R14）；省略时后端用「最近修改」。 */
    sort?: ResumeSort;
  } = {},
): Promise<Page<ResumeBrief>> {
  return request(`/resumes${buildQuery(params)}`);
}

/**
 * 当前筛选下全部简历的 id（不分页）：批量选择「全选全部简历」用；上限由调用方裁决。
 * 筛选参数与列表端点同源（keyword/job_id/favorite/has_job），只少分页。
 */
export function listResumeIds(
  params: {
    keyword?: string;
    job_id?: number;
    favorite?: boolean;
    has_job?: boolean;
  } = {},
): Promise<number[]> {
  return request(`/resumes/ids${buildQuery(params)}`);
}

/** 只改简历名称，不影响正文与生成告警。 */
export function renameResume(id: number, title: string): Promise<ResumeDetail> {
  return request(`/resumes/${id}`, { method: "PATCH", body: JSON.stringify({ title }) });
}

/** 单独更新简历备注（B5），不触碰正文与版式。 */
export function updateResumeNote(id: number, note: string): Promise<ResumeDetail> {
  return request(`/resumes/${id}/note`, { method: "PATCH", body: JSON.stringify({ note }) });
}

export function getResume(id: number): Promise<ResumeDetail> {
  return request(`/resumes/${id}`);
}

/**
 * 一份简历保存/生成时的「本次使用」快照 + 是否过时（R-33）。
 *
 * 只读：不重新生成、不改正文。旧简历没有快照时 `profile_usage=null`、
 * `freshness.changed=false`，调用方据此隐藏整条元信息。
 */
export function getResumeProfileUsage(id: number): Promise<ResumeProfileUsage> {
  return request(`/resumes/${id}/profile-usage`);
}

export function deleteResume(id: number): Promise<void> {
  return request(`/resumes/${id}`, { method: "DELETE" });
}

/**
 * 批量软删除简历（P2-4）：一次请求删完（全部进回收站），不再前端逐条 N 连发。
 * 任一 id 不存在或已删除时整批失败（404），不会出现"删了一半"的状态；一次最多 5000 份。
 */
export function batchDeleteResumes(resumeIds: number[]): Promise<{ deleted: number }> {
  return request("/resumes/batch-delete", {
    method: "POST",
    body: JSON.stringify({ resume_ids: resumeIds }),
  });
}

/** 替换一份已保存简历的结构化内容。 */
export function updateResume(id: number, content: ResumeContent): Promise<ResumeDetail> {
  return request(`/resumes/${id}`, { method: "PUT", body: JSON.stringify(content) });
}

/** W02 条件写见 `resumeDocument.ts`（分文件也避免本文件越 500 行）；re-export 保持既有导入路径。 */
export { saveResumeContent, saveResumeLayout } from "./resumeDocument";

/** 单独更新收藏状态，不上传或覆盖简历正文。 */
export function updateResumeFavorite(id: number, favorite: boolean): Promise<ResumeDetail> {
  return request(`/resumes/${id}/favorite`, {
    method: "PATCH",
    body: JSON.stringify({ favorite }),
  });
}

/**
 * 生成岗位化修改建议（调用一次大模型，10–60 秒）。
 *
 * 预算是借用的 ``recognition``（90s）：这条接口**非流式、要等完整 JSON**，``default``
 * 的 15s 在长简历 + 慢模型时不够用。``signal`` 由模块级 store 传入，用户点「取消生成」
 * 时 abort（弹窗关闭**不** abort——那是"后台继续"语义）。
 */
export function generateResumeSuggestions(
  id: number,
  signal?: AbortSignal,
): Promise<ResumeSuggestions> {
  return request(`/resumes/${id}/suggestions`, {
    method: "POST",
    budget: "recognition",
    signal,
  });
}

/**
 * 按用户指令修订简历并更新当前记录。
 *
 * `instructions` 为空表示整体重新生成（事实不变、表达重写）；非空表示只修改
 * 提出的内容——「只改提出的内容」这条约束由后端提示词强制，前端无法绕过。
 */
export function reviseResume(id: number, instructions: string): Promise<ResumeDetail> {
  return request(`/resumes/${id}/revise`, {
    method: "POST",
    body: JSON.stringify({ instructions }),
  });
}

/**
 * 待审变更预检（RF-13）：编辑器的 AI 改写 / 手填在落表单前过三把闸门。
 * 纯审阅预检——不落库、不改简历内容。
 */
export function prepareResumeReview(
  id: number,
  changes: ResumePendingChange[],
): Promise<ResumeReviewResult[]> {
  return request(`/resumes/${id}/review/prepare`, {
    method: "POST",
    body: JSON.stringify({
      changes: changes.map(({ path, before, after, origin, instruction }) => ({
        path,
        before,
        after,
        origin,
        instruction: instruction ?? "",
      })),
    }),
  }).then((payload) => (payload as { results: ResumeReviewResult[] }).results);
}

/** 可选的简历模板与字号档位；顺带告诉前端服务端能否直接生成 PDF。 */
export function fetchResumeTemplates(): Promise<ResumeTemplateCatalog> {
  return request("/resumes/templates");
}

/**
 * 渲染模板预览为 HTML。
 *
 * 传 `html`/`content` 时渲染这份草稿；传模板名/格式名用已保存模板；都不传用内置示例。
 */
export async function previewResumeTemplate(payload: {
  template_id?: number;
  template_name?: string;
  html?: string;
  format_name?: string;
  format_config?: ResumeFormatConfig;
  style_config?: Record<string, unknown>;
  page_limit?: number;
  font_scale?: ResumeFontScale;
  resume_id?: number;
  /** 未保存正文（W10 试用按它渲染/量页数）；不传 = resume_id 已保存版，再缺省用示例。 */
  content?: ResumeContent;
  /** 调用方取消：把还在飞的渲染掐掉（防换字号/关弹窗后白占连接）。 */
  signal?: AbortSignal;
}): Promise<string> {
  // `signal` 只属于 fetch 选项，**不能**随请求体发出去：后端 `TemplatePreviewRequest`
  // 是 `extra="forbid"`，多一个 `"signal": {}`（AbortSignal 的 JSON 序列化结果）就会
  // 422，而前端只会显示 Pydantic 的 "Extra inputs are not permitted"——正是模板卡片
  // 缩略图全部报错、而「查看大图」（那条路径不传 signal）正常的原因。
  const { signal, ...body } = payload;
  const resp = await requestRaw("/resume-templates/preview", {
    method: "POST",
    // 渲染整份简历可能超出 15s 默认预算，走 task 档（30s）。
    budget: "task",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  return resp.text();
}

/**
 * 读取「已同时保存到」响应头（URL 编码的本机路径）。
 * 没有该头（未设置保存位置，或落盘失败）时返回 undefined，调用方保持原提示。
 */
function readSavedToHeader(value: string | null): string | undefined {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value) || undefined;
  } catch {
    return undefined;
  }
}

/** 导出为文件（html/md/json/pdf），返回 blob 与服务端建议的文件名 */
export async function exportResume(
  id: number,
  format: ExportFormat,
  /** 为真时跳过"正文还有未完成标记"的拦截，导出一份草稿自查。 */
  allowIncomplete = false,
  /** 【deprecated，ADR-0002】仅为兼容保留；「导出并记录交付」请走
   *  exportResumeWithOptions（POST），把 record_delivery 放进请求体。 */
  recordDelivery = false,
): Promise<{
  blob: Blob;
  filename: string;
  pages: number | null;
  pageLimit: number | null;
  savedTo?: string;
}> {
  const suffix =
    (allowIncomplete ? "&allow_incomplete=true" : "") +
    (recordDelivery ? "&record_delivery=true" : "");
  // 导出响应是文件流：走 requestRaw（错误分类与 request() 一致），PDF 渲染可能较慢，
  // 走 export 预算（10 分钟），不吃 15s 的默认超时。
  const resp = await requestRaw(`/resumes/${id}/export?format=${format}${suffix}`, {
    budget: "export",
  });
  return {
    blob: await resp.blob(),
    filename:
      getFilenameFromDisposition(resp.headers.get("Content-Disposition")) ?? `resume.${format}`,
    // 只有服务端 PDF 会带这两个头：它用的是自己那套排版，页数可能多于用户选的上限。
    pages: readCountHeader(resp.headers.get("X-Resume-Pages")),
    pageLimit: readCountHeader(resp.headers.get("X-Resume-Page-Limit")),
    // 设置里指定了「生成内容保存位置」时，后端已把同一份产物落盘一份，路径随头带回。
    savedTo: readSavedToHeader(resp.headers.get("X-Saved-To")),
  };
}

/**
 * 全参数导出（POST 管线）：格式、水印、脱敏、页边距、字号、页数、照片。
 *
 * 与旧 `exportResume` 的 GET 兼容路径不同，这里支持 docx/txt 与全部后处理参数；
 * 「统一导出选项」弹窗走这一条。
 */
export async function exportResumeWithOptions(
  id: number,
  options: ExportRequest,
): Promise<{
  blob: Blob;
  filename: string;
  pages: number | null;
  pageLimit: number | null;
  savedTo?: string;
}> {
  const resp = await requestRaw(`/resumes/${id}/export`, {
    method: "POST",
    budget: "export",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options),
  });
  return {
    blob: await resp.blob(),
    filename:
      getFilenameFromDisposition(resp.headers.get("Content-Disposition")) ??
      `resume.${options.format}`,
    pages: readCountHeader(resp.headers.get("X-Resume-Pages")),
    pageLimit: readCountHeader(resp.headers.get("X-Resume-Page-Limit")),
    savedTo: readSavedToHeader(resp.headers.get("X-Saved-To")),
  };
}

/**
 * 精确预览：让服务端按**当前草稿版式**排一份真 PDF，交给浏览器原生查看器显示。
 *
 * 为什么不让前端模拟分页：预览是 CSS 多列切连续流，导出 PDF 由服务端另排一遍，两套引擎
 * 断点规则不同，"预览 2 页、导出 3 页"是结构性的——要"严格相同"，唯一可靠的口径是
 * **预览显示的就是导出产物本身**（同一条管线、同一组参数）。
 *
 * **五样版式参数都必须传**（`template` / `format_name` / `page_limit` / `font_scale` /
 * `format_config`）：草稿靠它们叠加，少任何一样服务端就回落记录里的旧值。预算用 `export`：
 * 同步渲染，不该吃 15s 的默认超时。
 */
export async function fetchResumePreviewPdf(
  id: number,
  options: {
    /** 模板 / 版式：草稿值，换完没保存也要按新的排。 */
    template?: string;
    format_name?: string;
    page_limit?: number;
    font_scale?: string;
    /** 纸面文案的语言（`zh-CN` / `en-US`）；不传 = 后端回落到记录里的值。 */
    language?: string;
    format_config?: Record<string, unknown>;
    include_photo?: boolean;
    /**
     * 还没保存的正文（W04）。
     *
     * 只在制作台里"改了几句、还没点保存"时给：精确预览显示的就是导出产物本身，
     * 正文停在上一版的话，用户看到的不是自己正在写的那份。不传 = 用记录里的值。
     * 服务端只把它用于这一趟渲染（不落库、不冻结交付）。
     */
    content?: ResumeContent;
  },
  signal?: AbortSignal,
): Promise<{
  blob: Blob;
  pages: number | null;
  pagesNeeded: number | null;
  pageLimit: number | null;
  overflow: boolean;
}> {
  const resp = await requestRaw(`/resumes/${id}/preview-pdf`, {
    method: "POST",
    budget: "export",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options),
  });
  return {
    blob: await resp.blob(),
    pages: readCountHeader(resp.headers.get("X-Resume-Pages")),
    // 按当前版式**真实需要**几页（未截断）。超限时 `pages` 是被截断后的页数（= 上限），
    // 界面用这个数说"按当前设置约需 N 页"，与草稿预览同一套措辞。
    pagesNeeded: readCountHeader(resp.headers.get("X-Resume-Pages-Needed")),
    pageLimit: readCountHeader(resp.headers.get("X-Resume-Page-Limit")),
    overflow: resp.headers.get("X-Resume-Overflow") === "true",
  };
}

/**
 * 离线分享包（R3）：一个 zip，内含单文件 HTML + PDF + 说明。
 *
 * 与「生成分享包」不同：那个是给**装了这个应用**的人看的（带分享码与评论回传）；
 * 这个 zip 给的是招聘方或朋友——双击 HTML 就能看，PDF 直接转发。
 */
export async function downloadResumeShareZip(
  id: number,
): Promise<{ blob: Blob; filename: string }> {
  const resp = await requestRaw(`/resumes/${id}/share-zip`, { budget: "export" });
  return {
    blob: await resp.blob(),
    filename:
      getFilenameFromDisposition(resp.headers.get("Content-Disposition")) ?? "简历-离线包.zip",
  };
}

/** 脱敏预览：返回脱敏后的简历内容，不落库、不改动原记录。 */
export function redactResume(id: number, options: RedactionOptions): Promise<ResumeContent> {
  return request(`/resumes/${id}/redact`, {
    method: "POST",
    body: JSON.stringify(options),
  });
}

/** 头读不到（跨源未放行、或该格式不提供）时返回 null，而不是把 NaN 传下去。 */
function readCountHeader(value: string | null): number | null {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** 读取导出 HTML 文本（用于打开打印窗口生成 PDF） */
export async function fetchResumeHtml(id: number, allowIncomplete = false): Promise<string> {
  // 走 POST 的 `preview: true`（2026-10-24）：它不落盘副本、结果进服务端预览缓存。
  // 从前这里用的是 GET 导出——每次点开一份简历都写一份文件、且每次都要重排一遍，
  // 这是"简历中心点开预览要等很久"的直接原因（同一条管线，只是多了两件不必做的事）。
  // 产物字节与 GET 完全一致（同一条 `_export_record`），所以显示口径没有任何变化。
  const resp = await requestRaw(`/resumes/${id}/export`, {
    method: "POST",
    budget: "export",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ format: "html", allow_incomplete: allowIncomplete, preview: true }),
  });
  return resp.text();
}

/**
 * 一份简历的交付记录摘要（RF-17）：这一版投给了谁、什么时候、指纹是什么。
 * 不含正文全文——列表只做展示，正文仍在简历详情里。
 */
export function listResumeDeliveries(id: number): Promise<DeliverySummary[]> {
  return request(`/resumes/${id}/deliveries`);
}

export function listDeliveryArchive(
  params: { page?: number; page_size?: number; keyword?: string; source?: string } = {},
): Promise<{ items: DeliverySummary[]; total: number }> {
  return request(`/resumes/deliveries${buildQuery(params)}`);
}

/**
 * 一条进度记录的交付快照（PR-09）：从岗位/进度进入对应 delivery 的入口。
 * 原简历被删后这里的摘要仍然可读（快照外键 SET NULL、冗余目的地列自持）。
 */
export function listTrackDeliveries(trackId: number): Promise<DeliverySummary[]> {
  return request(`/tracker/${trackId}/deliveries`);
}

/**
 * 一条交付记录的详情（PR-09）：不依赖原简历存活的独立访问入口。
 * 旧快照缺新列时 request_params 为 null、replayable/destination_recorded 为
 * false——UI 据此标注「不可还原」，不编造数据。
 */
export function getDeliveryDetail(deliveryId: number): Promise<DeliveryDetail> {
  return request(`/resumes/deliveries/${deliveryId}`);
}

export interface DeliveryDownload {
  blob: Blob;
  filename: string;
  /** 本次返回字节的 sha256（RR-04：头永远指向真实字节，可与下载后的文件核对）。 */
  contentSha256: string | null;
  /** 历史指纹：export 快照 = 当初产物的 sha256；apply/track = 冻结内容的规范化 sha256。 */
  artifactSha256: string | null;
  /** true 表示这份字节是按存档**重新生成**的，不保证与当初下载的文件逐字节相同。 */
  replayed: boolean;
}

/**
 * 从交付快照下载（PR-09）：export 快照重放导出产物；apply/track 快照下载冻结的
 * 内容 JSON。旧 export 快照缺参数时后端 409「不可还原」。
 */
export async function downloadDelivery(deliveryId: number): Promise<DeliveryDownload> {
  const resp = await requestRaw(`/resumes/deliveries/${deliveryId}/download`, {
    budget: "export",
  });
  return {
    blob: await resp.blob(),
    filename: getFilenameFromDisposition(resp.headers.get("Content-Disposition")) ?? "delivery",
    contentSha256: resp.headers.get("X-Content-Sha256"),
    artifactSha256:
      resp.headers.get("X-Artifact-Sha256") ?? resp.headers.get("X-Source-Content-Sha256"),
    replayed: resp.headers.get("X-Delivery-Replay") === "true",
  };
}
