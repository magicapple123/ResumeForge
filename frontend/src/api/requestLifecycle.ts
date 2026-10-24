// SPDX-License-Identifier: Apache-2.0
/**
 * 请求生命周期：把「预算」与「取消」从响应头一直管到正文读完（A03）。
 *
 * 为什么单独成模块：正文读取发生在 `requestRaw` 返回**之后**——那 30+ 个调用方各自调用
 * `resp.blob()` / `resp.text()` / `resp.json()`。只有把「当前预算状态 + 收尾入口」交出去，
 * 读取阶段才能产出与请求阶段同一套 `ApiError`（timeout / cancelled），而不是把生硬的
 * DOMException 抛给调用方。
 *
 * 另一个约束：`requestRaw` 的签名与返回类型（`Promise<Response>`）不能变。这里通过覆盖
 * **同一个 Response 实例**上的四个读取方法实现，`status / ok / headers / url` 与
 * `instanceof Response` 全部保持不变。
 */

import { ApiError } from "./apiError";

export interface RequestLifecycle {
  /** 内部 controller 的信号：唯一传给 fetch 的信号源，也是正文流的终止源。 */
  signal: AbortSignal;
  /** 调用方信号：用于在 abort 之后区分「用户取消」与「预算到期」。 */
  callerSignal?: AbortSignal;
  isTimedOut: () => boolean;
  /** 记一次 `api.timeout` 诊断（幂等：读取与请求两侧都可能触到它）。 */
  noteTimeout: () => void;
  /** 收尾：清 timer、摘掉调用方监听。幂等，四条终态路径都走它。 */
  cleanup: () => void;
  retryable: boolean;
}

/** 正文读取阶段的中止错误，口径与请求阶段完全一致（timeout / cancelled）。 */
export function abortErrorOf(lifecycle: RequestLifecycle): ApiError {
  if (lifecycle.isTimedOut()) {
    lifecycle.noteTimeout();
    // 对 GET 来说换一次时机再试大概率能成，标记为可重试；写方法一律 false。
    // i18n-ok: 与 client.ts 原有 ApiError 文案逐字相同，随 A03 搬进新模块，不是新增文案
    return new ApiError("请求超时，请重试", undefined, {
      code: "timeout",
      retryable: lifecycle.retryable,
    });
  }
  // 调用方取消不是错误：不记诊断，message 固定为「已取消」，由 isCancellation 判别。
  // i18n-ok: 与 client.ts 原有 ApiError 文案逐字相同，随 A03 搬进新模块，不是新增文案
  return new ApiError("已取消", undefined, { code: "cancelled" });
}

/**
 * 受控读取一段正文。
 *
 * 预算到期与调用方取消都会 abort 内部 controller；但底层流**是否**响应这次 abort 不受本侧
 * 控制（真实浏览器会以 AbortError 终止流，而 mock / 自定义 Response 可能一直 pending）。
 * 所以这里两路同时等：读完成，或 abort 信号到达——谁先到谁生效。
 *
 * 关键约束：中止一律翻译成 ApiError，绝不让 DOMException/AbortError 冒到调用方（调用方
 * 依赖 `isCancellation` 与 `code` 分支）；其余读取失败原样上交，由 `request()` 按旧规则
 * 归到 network。
 */
function supervisedRead<T>(lifecycle: RequestLifecycle, read: () => Promise<T>): Promise<T> {
  const { signal: internal, callerSignal } = lifecycle;
  const callerAborted = (): boolean => callerSignal?.aborted === true;

  const translate = (error: unknown): unknown => {
    if (error instanceof ApiError) return error;
    if (lifecycle.isTimedOut() || internal.aborted || callerAborted()) {
      return abortErrorOf(lifecycle);
    }
    return error;
  };

  return new Promise<T>((resolve, reject) => {
    let settled = false;

    function settle(action: () => void): void {
      if (settled) return;
      settled = true;
      internal.removeEventListener("abort", onAbort);
      // 读完、读失败、取消、超时四条路径都在这里收尾：timer 与 abort 监听不会留下。
      lifecycle.cleanup();
      action();
    }

    function onAbort(): void {
      settle(() => reject(abortErrorOf(lifecycle)));
    }

    internal.addEventListener("abort", onAbort);
    if (internal.aborted || callerAborted()) {
      // 读到一半预算就到了 / 用户已经取消：不必再碰底层流。
      onAbort();
      return;
    }
    try {
      void read().then(
        (value: T) => settle(() => resolve(value)),
        (error: unknown) => settle(() => reject(translate(error))),
      );
    } catch (error) {
      settle(() => reject(translate(error)));
    }
  });
}

type ReaderName = "arrayBuffer" | "blob" | "json" | "text";

/** 原始读取方法只抓一次：同一个 Response 被二次包装时不能套娃（否则监听成倍增长）。 */
const CACHED_READERS = new WeakMap<Response, Record<ReaderName, () => Promise<unknown>>>();

const READER_NAMES: readonly ReaderName[] = ["arrayBuffer", "blob", "json", "text"];

function captureReaders(resp: Response): Record<ReaderName, () => Promise<unknown>> {
  return {
    arrayBuffer: resp.arrayBuffer.bind(resp),
    blob: resp.blob.bind(resp),
    json: resp.json.bind(resp),
    text: resp.text.bind(resp),
  };
}

/**
 * 把正文读取纳入请求生命周期。
 *
 * 返回的是**同一个** Response 实例，只在自己的实例上覆写四个读取方法，因此
 * `status / ok / headers / url` 与 `instanceof Response` 全部不变——`requestRaw` 的
 * 签名与 30+ 个调用方都不需要改，它们照旧 `resp.blob()` / `resp.text()`。
 */
export function superviseBody(resp: Response, lifecycle: RequestLifecycle): Response {
  const readers = CACHED_READERS.get(resp) ?? captureReaders(resp);
  CACHED_READERS.set(resp, readers);
  for (const name of READER_NAMES) {
    const read = readers[name];
    Object.defineProperty(resp, name, {
      value: () => supervisedRead(lifecycle, read),
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }
  return resp;
}
