import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, buildQuery, request } from "./client";

afterEach(() => {
  vi.unstubAllGlobals();
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

  it("fetch 本身失败时抛中文提示，并把原始错误保留在 cause 上", async () => {
    // 服务没启动 / 网络不可达时 fetch 拒绝的是英文的 TypeError；直接抛出去用户看不懂。
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    const error: Error = await request("/example").then(
      () => {
        throw new Error("should not resolve");
      },
      (err: Error) => err,
    );
    expect(error.message).toBe("无法连接本地服务，请确认应用已启动");
    // 诊断信息不能丢：原始错误挂在 cause 上。
    const cause = (error as Error & { cause?: unknown }).cause;
    expect(cause).toBeInstanceOf(TypeError);
    expect((cause as TypeError).message).toBe("Failed to fetch");
  });
});
