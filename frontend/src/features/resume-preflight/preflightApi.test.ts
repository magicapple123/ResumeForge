// SPDX-License-Identifier: Apache-2.0
/** 统一检查接口接线：URL / 请求体 / 取消信号 / 错误语义（接真实端点契约，不 mock 业务实现）。 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { runPreflight } from "./preflightApi";
import { makePreflightOut } from "../../test/preflightFixtures";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(payload: unknown, status = 200) {
  const captured: { url?: string; init?: RequestInit } = {};
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    captured.url = url;
    captured.init = init;
    return Promise.resolve(
      new Response(JSON.stringify(payload), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, captured };
}

describe("runPreflight（POST /resumes/{id}/preflight）", () => {
  it("URL、POST、请求体逐字段序列化，取消信号透传给 fetch", async () => {
    const { captured } = stubFetch(makePreflightOut());
    const controller = new AbortController();
    const body = {
      layers: ["content", "layout"] as const,
      product_formats: ["pdf"],
      measure: { used_height: 900, page_content_height: 1000 },
      jd_text: "engineer",
    };
    const result = await runPreflight(7, { ...body, layers: [...body.layers] }, controller.signal);
    expect(result.snapshot.content_sha256).toBe("content-a");
    expect(captured.url).toContain("/resumes/7/preflight");
    expect(captured.init?.method).toBe("POST");
    // 取消信号透传：request 层可能包一层受控 signal，所以只断言"确实是可中止的信号"。
    expect(captured.init?.signal).toBeTruthy();
    expect((captured.init?.signal as AbortSignal).aborted).toBe(false);
    const sent = JSON.parse(String(captured.init?.body)) as Record<string, unknown>;
    expect(sent).toEqual({ ...body, layers: ["content", "layout"] });
    expect(sent).not.toHaveProperty("signal");
  });

  it("非 2xx 抛出带响应详情的错误（错误态能给出路，不是笼统失败）", async () => {
    stubFetch({ detail: "检查服务不可用" }, 503);
    await expect(runPreflight(7, { layers: ["content"] })).rejects.toThrow("检查服务不可用");
  });
});
