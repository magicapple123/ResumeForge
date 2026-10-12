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

export interface UploadProgressOptions {
  /** 请求预算档；上传默认走 upload（10 分钟）。 */
  budget?: RequestBudgetKind;
  /**
   * 上传字节进度回调：percent ∈ [0, 100]。xhr.upload.onload（字节全部发出、
   * 服务端还在处理）时会收到 100；响应到达后 Promise 才 resolve。
   */
  onProgress?: (percent: number) => void;
  /** 调用方取消。与 fetch 版一致：手动链式（tsconfig 未开 ES2024，不能用 AbortSignal.any）。 */
  signal?: AbortSignal;
  /** 额外请求头；Content-Type 由 body 形态决定（FormData 不设，JSON 字符串自动补）。 */
  headers?: Record<string, string>;
}

/**
 * 基于 XHR 的进度上传：fetch 拿不到上传字节进度，大附件（识别材料、图片、头像）
 * 用它替换 request() 才能给用户画出进度条。错误口径与 request() 完全一致——
 * 非 2xx 抛同结构的 ApiError（message 仍走 extractError）、预算到期 timeout、
 * 调用方取消 cancelled、连接失败 network。
 */
export function uploadWithProgress<T>(
  path: string,
  body: FormData | string | Blob,
  options: UploadProgressOptions = {},
): Promise<T> {
  const { budget = "upload", onProgress, signal, headers } = options;

  // 调用方在发起前就已取消：请求根本不必发出（与 requestRaw 同一口径）。
  if (signal?.aborted) {
    return Promise.reject(new ApiError("已取消", undefined, { code: "cancelled" }));
  }

  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api${path}`);
    const limit = BUDGETS_MS[budget];
    // 预算用 XHR 自带的 timeout：到期触发 ontimeout（不会误触发 onabort），
    // 与调用方取消天然区分开，语义与 fetch 版的预算一致。
    if (limit > 0) xhr.timeout = limit;

    const headersLike = new Headers(headers);
    // 与 request() 同一条规则：FormData 不预设 Content-Type（boundary 由浏览器生成）；
    // JSON 字符串体自动补 application/json；裸 Blob 补 octet-stream，自带类型的
    // Blob（File）沿用自身 type，调用方传 headers 时以 headers 为准。
    if (!headersLike.has("Content-Type")) {
      if (typeof body === "string") headersLike.set("Content-Type", "application/json");
      else if (!(body instanceof FormData)) {
        headersLike.set("Content-Type", body.type || "application/octet-stream");
      }
    }
    headersLike.forEach((value, key) => xhr.setRequestHeader(key, value));

    const callerAbort = () => xhr.abort();
    signal?.addEventListener("abort", callerAbort);

    const fail = (error: ApiError) => {
      signal?.removeEventListener("abort", callerAbort);
      reject(error);
    };
    const finish = (value: T) => {
      signal?.removeEventListener("abort", callerAbort);
      resolve(value);
    };

    xhr.upload.onprogress = (event) => {
      if (!onProgress || !event.lengthComputable || event.total === 0) return;
      onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    };
    // 字节全部发出即报 100：剩下的是服务端处理时间，进度条到此已经画满。
    xhr.upload.onload = () => onProgress?.(100);

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        if (xhr.status === 204) return finish(undefined as T);
        try {
          finish(JSON.parse(xhr.responseText) as T);
        } catch (error) {
          // 200 但响应体不是合法 JSON：与 request() 同样按网络类失败提示。
          fail(networkFailure(path, "POST", error, false));
        }
        return;
      }
      // 非 2xx：message 复用 extractError 的解析（FastAPI detail 形状一致），
      // 用合成 Response 递交响应文本即可，不必重复实现解析。
      const requestId = xhr.getResponseHeader("x-request-id") ?? undefined;
      recordClientDiagnostic("api.error", {
        path,
        status: xhr.status,
        method: "POST",
        request_id: requestId,
      });
      void extractError(new Response(xhr.responseText, { status: xhr.status }))
        .then((message) =>
          fail(
            new ApiError(message, xhr.status, {
              code: "http",
              requestId,
              // 上传是写方法：无论状态码多少都不标记可重试。
              retryable: false,
            }),
          ),
        )
        .catch(() =>
          fail(new ApiError(`请求失败（HTTP ${xhr.status}）`, xhr.status, { code: "http" })),
        );
    };
    // 预算到期：XHR 内部按 timeout 中止，只触发 ontimeout。
    xhr.ontimeout = () => {
      recordClientDiagnostic("api.timeout", { path, method: "POST", budget });
      fail(new ApiError("请求超时，请重试", undefined, { code: "timeout", retryable: false }));
    };
    // 只有调用方 abort 会走到这里（timeout 走 ontimeout，onerror 是连接层失败）。
    xhr.onabort = () => fail(new ApiError("已取消", undefined, { code: "cancelled" }));
    xhr.onerror = () => fail(networkFailure(path, "POST", new Error("NetworkError"), false));

    xhr.send(body);
  });
}
