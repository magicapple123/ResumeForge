/** 统一请求封装：JSON 解析、错误信息提取、友好报错。 */

import { recordClientDiagnostic } from "../utils/clientDiagnostics";

export class ApiError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
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

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  try {
    const resp = await fetch(`/api${path}`, {
      ...options,
      headers,
    });
    if (!resp.ok) {
      recordClientDiagnostic("api.error", {
        path,
        status: resp.status,
        method: options.method ?? "GET",
      });
      throw new ApiError(await extractError(resp), resp.status);
    }
    if (resp.status === 204) return undefined as T;
    return (await resp.json()) as T;
  } catch (error) {
    if (!(error instanceof ApiError)) {
      recordClientDiagnostic("api.network_error", {
        path,
        method: options.method ?? "GET",
        error: error instanceof Error ? error.name : String(error),
      });
      // 走到这里说明 fetch 本身就失败了（服务没启动 / 网络不可达），原始错误是英文的
      // "TypeError: Failed to fetch"，用户看不懂；换成中文提示，原始错误挂在 cause 上
      // 不丢诊断信息。后端有响应的（ApiError）行为不变。
      // （Error 的 cause 选项需要 ES2022 lib，项目 tsconfig 尚未开到——用赋值等价实现。）
      const wrapped: Error & { cause?: unknown } = new Error("无法连接本地服务，请确认应用已启动");
      wrapped.cause = error;
      throw wrapped;
    }
    throw error;
  }
}
