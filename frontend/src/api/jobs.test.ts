// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from "vitest";
import { exportJobsCsv } from "./jobs";

afterEach(() => {
  vi.unstubAllGlobals();
});

// 回归：导出走的是 requestRaw，它不会像 request() 那样补 Content-Type。
// 缺了这个头，后端把 JSON body 当空表单解析，Pydantic 报
// "Input should be a valid dictionary or object to extract fields from"，
// 用户点「导出 CSV」只看到一条红色报错（2026-10-12 实测）。
describe("exportJobsCsv", () => {
  it("以 application/json 头发送 job_ids，后端才能解析出请求体", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("title,company\n前端,某公司", {
        status: 200,
        headers: { "Content-Type": "text/csv; charset=utf-8" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const blob = await exportJobsCsv([3, 1, 2]);

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = new Headers(init.headers);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ job_ids: [3, 1, 2] }));
    expect(await blob.text()).toBe("title,company\n前端,某公司");
  });
});
