// SPDX-License-Identifier: Apache-2.0
/**
 * HTTP 适配契约测试：真实 requestRaw 发给后端的 URL / method / Content-Type / body 形状。
 * 回归背景（2026-10-26 验收 P1）：exportBundle 调 requestRaw 时漏了 Content-Type，
 * 后端把 JSON body 当成非 JSON 解析，直接 422 "Input should be a valid dictionary or object"，
 * 用户点「导出交付包」无下载也无提示。本文件让同类漏头在单测阶段就红。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createExportDeliveryApi } from "./exportApi";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("exportBundle HTTP 契约", () => {
  it("requestRaw 发 JSON body 时必须带 Content-Type: application/json", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("zip-bytes", {
        status: 200,
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": 'attachment; filename="delivery-bundle.zip"',
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const api = createExportDeliveryApi();
    const result = await api.exportBundle(3, {
      formats: ["pdf"],
      resume_revision: 1,
      strict_revision: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain("/resumes/3/export-bundle");
    expect(init.method).toBe("POST");
    const headers = new Headers(init.headers);
    // 没有这个头，FastAPI 会把 body 当原始字符串 → 422（本次线上缺陷根因）。
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(JSON.parse(String(init.body))).toMatchObject({
      formats: ["pdf"],
      resume_revision: 1,
      strict_revision: true,
    });
    expect(result.filename).toBe("delivery-bundle.zip");
    expect(await result.blob.text()).toBe("zip-bytes");
  });
});
