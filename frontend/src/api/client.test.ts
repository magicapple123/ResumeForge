import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, BUDGETS_MS, buildQuery, isCancellation, request } from "./client";
import { clientDiagnosticSnapshot } from "../utils/clientDiagnostics";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("buildQuery", () => {
  it("omits empty values and URL-encodes the rest", () => {
    expect(buildQuery({ keyword: "算法 工程师", page: 2, status: "", optional: undefined })).toBe(
      "?keyword=%E7%AE%97%E6%B3%95+%E5%B7%A5%E7%A8%8B%E5%B8%88&page=2",
    );
  });
});

describe("request", () => {
  it("keeps the JSON content type when adding custom headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await request("/example", { headers: { "X-Request-ID": "test-id" } });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("X-Request-ID")).toBe("test-id");
  });

  it("respects an explicit content type override", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await request("/example", { headers: { "Content-Type": "text/plain" } });

    const headers = new Headers((fetchMock.mock.calls[0][1] as RequestInit).headers);
    expect(headers.get("Content-Type")).toBe("text/plain");
  });

  it("body 为 FormData 时不预设 Content-Type（multipart boundary 由浏览器生成）", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: 1 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await request("/upload", { method: "POST", body: new FormData(), budget: "upload" });

    const headers = new Headers((fetchMock.mock.calls[0][1] as RequestInit).headers);
    expect(headers.get("Content-Type")).toBeNull();
  });

  it("204 返回 undefined", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(request("/example")).resolves.toBeUndefined();
  });

  it("结构化 detail 取其中的 message，而不是只说「请求失败（HTTP 409）」", async () => {
    // 投递台的 409 都是这个形状（message + 若干标记位）。不取 message 的话，调用方
    // 只能看到一句没信息量的话，而真正原因就躺在响应体里。
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            detail: { message: "「某岗位」的来源不是投递台支持的招聘网站", site_unsupported: true },
          }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await expect(request("/example", { method: "POST" })).rejects.toThrow(
      "「某岗位」的来源不是投递台支持的招聘网站",
    );
    await expect(request("/example", { method: "POST" })).rejects.toBeInstanceOf(ApiError);
  });

  it("非 JSON 错误体退回「请求失败（HTTP xxx）」提示（message 语义不变）", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Bad Gateway", { status: 502 })));
    const err = await request("/example").then(
      () => {
        throw new Error("should not resolve");
      },
      (e: ApiError) => e,
    );
    expect(err.message).toBe("请求失败（HTTP 502）");
    expect(err.code).toBe("http");
  });

  it("非 2xx 时从响应头读取 x-request-id 并透传到 ApiError.requestId", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: "boom" }), {
          status: 500,
          headers: { "Content-Type": "application/json", "x-request-id": "req-123" },
        }),
      ),
    );
    const err = await request("/example").then(
      () => {
        throw new Error("should not resolve");
      },
      (e: ApiError) => e,
    );
    expect(err.requestId).toBe("req-123");
    expect(err.code).toBe("http");
    expect(err.status).toBe(500);
  });

  it("fetch 本身失败时抛中文提示，并把原始错误保留在 cause 上", async () => {
    // 服务没启动 / 网络不可达时 fetch 拒绝的是英文的 TypeError；直接抛出去用户看不懂。
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    const error: ApiError = await request("/example").then(
      () => {
        throw new Error("should not resolve");
      },
      (err: ApiError) => err,
    );
    expect(error.message).toBe("无法连接本地服务，请确认应用已启动");
    expect(error.code).toBe("network");
    // 诊断信息不能丢：原始错误挂在 cause 上。
    const cause = (error as Error & { cause?: unknown }).cause;
    expect(cause).toBeInstanceOf(TypeError);
    expect((cause as TypeError).message).toBe("Failed to fetch");
  });

  it("预算到期中止请求并抛 timeout；GET 可重试", async () => {
    vi.useFakeTimers();
    // fetch 永远 pending，只在被 abort 时拒绝——模拟慢到超出预算的后端。
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_path: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          }),
      ),
    );

    const captured = request("/example").then(
      () => {
        throw new Error("should not resolve");
      },
      (e: ApiError) => e,
    );
    await vi.advanceTimersByTimeAsync(BUDGETS_MS.default);
    const err = await captured;

    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("timeout");
    expect(err.message).toBe("请求超时，请重试");
    expect(err.retryable).toBe(true);
  });

  it("写方法预算到期同样抛 timeout，但不可重试", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_path: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          }),
      ),
    );

    const captured = request("/example", { method: "POST" }).then(
      () => {
        throw new Error("should not resolve");
      },
      (e: ApiError) => e,
    );
    await vi.advanceTimersByTimeAsync(BUDGETS_MS.default);
    const err = await captured;

    expect(err.code).toBe("timeout");
    expect(err.retryable).toBe(false);
  });

  it("调用方中止抛 cancelled；isCancellation 判别为真且不记诊断", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_path: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("The operation was aborted", "AbortError")),
            );
          }),
      ),
    );
    const controller = new AbortController();
    const diagnosticsBefore = clientDiagnosticSnapshot().length;

    const captured = request("/example", { signal: controller.signal }).then(
      () => {
        throw new Error("should not resolve");
      },
      (e: ApiError) => e,
    );
    controller.abort();
    const err = await captured;

    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("cancelled");
    expect(err.message).toBe("已取消");
    expect(err.retryable).toBe(false);
    expect(isCancellation(err)).toBe(true);
    // 取消不是错误：不记任何诊断。
    expect(clientDiagnosticSnapshot().length).toBe(diagnosticsBefore);
  });

  it("调用方 signal 已处于 aborted 状态时直接抛 cancelled", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const controller = new AbortController();
    controller.abort();

    const captured = request("/example", { signal: controller.signal }).then(
      () => {
        throw new Error("should not resolve");
      },
      (e: ApiError) => e,
    );
    const err = await captured;
    expect(err.code).toBe("cancelled");
    // 请求根本不该发出去。
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("retryable 判定矩阵", () => {
  async function errorFor(init: RequestInit, status: number, detail: string): Promise<ApiError> {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail }), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    return request("/example", init).then(
      () => {
        throw new Error("should not resolve");
      },
      (e: ApiError) => e,
    );
  }

  it("http：仅 GET 且 5xx 可重试；4xx 与写方法一律不可重试", async () => {
    expect((await errorFor({}, 500, "a")).retryable).toBe(true);
    expect((await errorFor({}, 404, "b")).retryable).toBe(false);
    expect((await errorFor({ method: "POST" }, 500, "c")).retryable).toBe(false);
    expect((await errorFor({ method: "DELETE" }, 503, "d")).retryable).toBe(false);
  });

  it("network：仅 GET 可重试", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const getErr = await request("/example").then(
      () => {
        throw new Error("should not resolve");
      },
      (e: ApiError) => e,
    );
    expect(getErr.code).toBe("network");
    expect(getErr.retryable).toBe(true);

    const postErr = await request("/example", { method: "PUT" }).then(
      () => {
        throw new Error("should not resolve");
      },
      (e: ApiError) => e,
    );
    expect(postErr.retryable).toBe(false);
  });
});

describe("BUDGETS_MS", () => {
  it("预算分类与毫秒数符合 §2.6 契约", () => {
    expect(BUDGETS_MS).toEqual({
      default: 15_000,
      upload: 600_000,
      export: 600_000,
      task: 30_000,
      // AI 识别：非流式等完整 JSON，大文本 15s 会误超时（AI 提速批次）。
      recognition: 90_000,
      stream: 0,
    });
  });
});
