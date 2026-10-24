// SPDX-License-Identifier: Apache-2.0
/**
 * 传输层错误类型（从 `client.ts` 拆出，2026-10-24）。
 *
 * 拆出的原因不是"分层好看"，而是**循环依赖**：请求生命周期（预算/取消）需要构造
 * `ApiError`，而它又要被 `client.ts` 引用。把错误类型放进独立模块后，两边都只依赖它，
 * `client.ts` 继续 re-export，所有既有的 `import { ApiError } from "../api/client"`
 * 不需要改一行。
 */

/** 错误类别：http=后端有响应但非 2xx；network=fetch 失败；timeout=预算到期；cancelled=调用方中止。 */
export type ApiErrorCode = "http" | "network" | "timeout" | "cancelled";

export class ApiError extends Error {
  readonly status?: number;
  readonly code: ApiErrorCode;
  /** 从响应头 x-request-id 读取（后端 request_context 中间件在每个响应上回写）；网络失败时 undefined。 */
  readonly requestId?: string;
  /**
   * 后端在错误响应体里给的业务码（如 `dataset_scope_changed`）。与 `code`（传输层分类）
   * 分开：`code` 是被广泛依赖的联合类型，加值会连锁影响所有 switch；调用方要区分
   * "哪一种 409"只能靠这个字段。
   */
  readonly businessCode?: string;
  /**
   * 解析后的错误响应体（JSON）。`message`/`businessCode` 是**投影**，结构化字段
   * （如事实锁 409 的 `violations[]`、投递 409 的 `unanalyzed`）只在这里能拿到。
   *
   * 为什么保留整份 body：调用方要展示"逐条违规"时，再解析一次响应是不可能的——
   * 正文已被读掉。只加一个可选字段即可，不改变既有 message/businessCode 语义。
   */
  readonly payload?: unknown;
  /** 仅 GET 且 5xx/timeout/network 时 true；写方法一律 false。是否重试由调用方决定，client 不内置自动重试。 */
  readonly retryable: boolean;
  readonly cause?: unknown;

  constructor(
    message: string,
    status?: number,
    opts: {
      code?: ApiErrorCode;
      requestId?: string;
      businessCode?: string;
      payload?: unknown;
      retryable?: boolean;
      cause?: unknown;
    } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = opts.code ?? "http";
    this.requestId = opts.requestId;
    this.businessCode = opts.businessCode;
    if (opts.payload !== undefined) this.payload = opts.payload;
    this.retryable = opts.retryable ?? false;
    if (opts.cause !== undefined) this.cause = opts.cause;
  }
}

/** 是否为「调用方取消」导致的失败：调用方不应把它当错误展示，也不应记诊断。 */
export function isCancellation(error: unknown): boolean {
  return error instanceof ApiError && error.code === "cancelled";
}
