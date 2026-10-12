/** 统一请求封装：JSON 解析、错误信息提取、请求预算（超时）、取消与友好报错。 */

import { recordClientDiagnostic } from "../utils/clientDiagnostics";

/** 错误类别：http=后端有响应但非 2xx；network=fetch 失败；timeout=预算到期；cancelled=调用方中止。 */
export type ApiErrorCode = "http" | "network" | "timeout" | "cancelled";

/**
 * 请求预算分类（毫秒）：文件上传/大文件导出给长预算，普通请求 15s，任务类 30s，
 * stream 不限时（SSE 流式路径不走 request()，此档供显式豁免的调用方使用）。
 */
export type RequestBudgetKind = "default" | "upload" | "export" | "task" | "recognition" | "stream";

export const BUDGETS_MS: Record<RequestBudgetKind, number> = {
  default: 15_000,
  upload: 600_000,
  export: 600_000,
  task: 30_000,
  // AI 识别（岗位/资料解析）：非流式等完整 JSON，大文本 30s 不够——90s 兜底，
  // 正常在几秒到十几秒返回，超时才报错（此前 default 15s 会让大文本直接超时）。
  recognition: 90_000,
  stream: 0, // 0 表示不限时
};

export class ApiError extends Error {
  readonly status?: number;
  readonly code: ApiErrorCode;
  /** 从响应头 x-request-id 读取（后端 request_context 中间件在每个响应上回写）；网络失败时 undefined。 */
  readonly requestId?: string;
  /** 仅 GET 且 5xx/timeout/network 时 true；写方法一律 false。是否重试由调用方决定，client 不内置自动重试。 */
  readonly retryable: boolean;
  readonly cause?: unknown;

  constructor(
    message: string,
    status?: number,
    opts: {
      code?: ApiErrorCode;
      requestId?: string;
      retryable?: boolean;
      cause?: unknown;
    } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = opts.code ?? "http";
    this.requestId = opts.requestId;
    this.retryable = opts.retryable ?? false;
    if (opts.cause !== undefined) this.cause = opts.cause;
  }
}

/** 是否为「调用方取消」导致的失败：调用方不应把它当错误展示，也不应记诊断。 */
export function isCancellation(error: unknown): boolean {
  return error instanceof ApiError && error.code === "cancelled";
}

/** 把 query 对象转成查询串，跳过空值 */
export function buildQuery(params: object): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  const text = query.toString();
  return text ? `?${text}` : "";
}

/** 从响应体中提取错误信息（FastAPI 的 detail 可能是字符串或校验错误数组） */
export async function extractError(resp: Response): Promise<string> {
  try {
    const data = await resp.json();
    const detail = data?.detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail) && detail.length > 0) {
      return detail.map((item) => item?.msg ?? String(item)).join("；");
    }
    // 结构化 detail：投递台的 409 就是这种形状（`{message, unanalyzed, gaps, site_unsupported…}`）。
    // 不取 message 的话，所有走 `request()` 的调用方只能看到「请求失败（HTTP 409）」——
    // 用户拿到的是一句没信息量的话，而真正的原因（例如"来源不支持自动投递，请先移出队列"）
    // 就躺在响应体里。
    if (detail && typeof detail === "object" && typeof detail.message === "string") {
      return detail.message;
    }
  } catch {
    // 响应体不是 JSON 时退回状态码提示
  }
  return `请求失败（HTTP ${resp.status}）`;
}

/** 从 Content-Disposition 里解析文件名，兼容 RFC 5987 的 filename* 形式 */
export function getFilenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utf8Match) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }
  const plainMatch = /filename="?([^";]+)"?/i.exec(header);
  return plainMatch ? plainMatch[1] : null;
}

export interface RequestOptions extends RequestInit {
  budget?: RequestBudgetKind;
}

/** GET（含缺省方法）才允许被标记为可重试；写方法失败一律不自动重试。 */
function isReadMethod(method: string | undefined): boolean {
  return (method ?? "GET").toUpperCase() === "GET";
}

/** 网络类失败统一转成中文提示的 ApiError，原始错误保留在 cause 上不丢诊断信息。 */
function networkFailure(
  path: string,
  method: string,
  cause: unknown,
  retryable: boolean,
): ApiError {
  recordClientDiagnostic("api.network_error", {
    path,
    method,
    error: cause instanceof Error ? cause.name : String(cause),
  });
  return new ApiError("无法连接本地服务，请确认应用已启动", undefined, {
    code: "network",
    retryable,
    cause,
  });
}

/**
 * 预算化原始请求：与 request() 共用超时、取消与错误分类，但不解析响应体——供导出/下载
 * （blob）、渲染预览（text）这类非 JSON 响应使用。非 2xx 时抛出与 request() 相同形状的
 * ApiError（message 仍来自 extractError，语义不变）；成功时返回原始 Response 交调用方自行读取。
 */
export async function requestRaw(path: string, options: RequestOptions = {}): Promise<Response> {
  const { budget = "default", signal, ...rest } = options;
  const method = rest.method ?? "GET";
  const retryable = isReadMethod(rest.method);

  // 调用方在发起前就已取消：请求根本不必发出。
  if (signal?.aborted) {
    throw new ApiError("已取消", undefined, { code: "cancelled" });
  }

  // 超时用 AbortController 实现（不用计时器轮询）：内部 controller 是唯一传给 fetch 的
  // 信号源；调用方传入的 signal 手动链式进来——tsconfig 未开 ES2024，不能用 AbortSignal.any。
  const controller = new AbortController();
  const callerAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", callerAbort);
  }

  // 预算到期（>0 时）由本侧中止请求，catch 里据此与「调用方取消」区分开。
  let timedOut = false;
  let timer: number | undefined;
  const limit = BUDGETS_MS[budget];
  if (limit > 0) {
    timer = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, limit);
  }

  try {
    const resp = await fetch(`/api${path}`, { ...rest, signal: controller.signal });
    if (!resp.ok) {
      const requestId = resp.headers.get("x-request-id") ?? undefined;
      recordClientDiagnostic("api.error", {
        path,
        status: resp.status,
        method,
        request_id: requestId,
      });
      throw new ApiError(await extractError(resp), resp.status, {
        code: "http",
        requestId,
        retryable: retryable && resp.status >= 500,
      });
    }
    return resp;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (timedOut) {
      // 预算到期被本侧中止：对 GET 来说换一次时机再试大概率能成，标记为可重试。
      recordClientDiagnostic("api.timeout", { path, method, budget });
      throw new ApiError("请求超时，请重试", undefined, { code: "timeout", retryable });
    }
    if (signal?.aborted) {
      // 调用方取消不是错误：不记诊断，message 固定为「已取消」，由 isCancellation 判别。
      throw new ApiError("已取消", undefined, { code: "cancelled" });
    }
    throw networkFailure(path, method, error, retryable);
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", callerAbort);
  }
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  // body 是 FormData 时不能预设 Content-Type：multipart 的 boundary 要由浏览器生成，
  // 预设成 JSON 后端就解析不出文件了（上传调用方因此能直接迁移到 request()）。
  if (!headers.has("Content-Type") && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const resp = await requestRaw(path, { ...options, headers });
  if (resp.status === 204) return undefined as T;
  try {
    return (await resp.json()) as T;
  } catch (error) {
    // 200 但响应体不是合法 JSON（如空响应）：保留旧行为——按网络类失败提示，
    // 不把英文的 SyntaxError 直接抛给用户；原始错误保留在 cause 上。
    throw networkFailure(path, options.method ?? "GET", error, isReadMethod(options.method));
  }
}
