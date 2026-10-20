// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from "vitest";
import { datasetScopeHeaders, initializeDatasetScope } from "./datasetScope";

afterEach(() => vi.unstubAllGlobals());

describe("per-document dataset identity", () => {
  it("freezes a bootstrap identity and preserves content headers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ scope: "instance:A:1" }), {
          headers: { "X-Dataset-Scope": "instance:A:1" },
        }),
      ),
    );
    await initializeDatasetScope();
    const headers = datasetScopeHeaders({ "Content-Type": "application/json" });
    expect(headers.get("X-Dataset-Scope")).toBe("instance:A:1");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("X-ResumeForge-Client")).toBe("browser");
  });

  it("keeps its own identity when preparing an independent request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ scope: "instance:A:2" }))),
    );
    await initializeDatasetScope();
    expect(datasetScopeHeaders({ "X-Other": "B" }).get("X-Dataset-Scope")).toBe("instance:A:2");
  });

  it("rejects an invalid bootstrap rather than opening editable pages", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}")));
    await expect(initializeDatasetScope()).rejects.toThrow("数据集身份");
  });

  it("ends a stalled bootstrap at its deadline instead of leaving an endless startup spinner", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url, options: RequestInit) =>
          new Promise((_resolve, reject) => {
            options.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
      ),
    );
    try {
      const assertion = expect(initializeDatasetScope()).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(15_001);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("an aborted bootstrap cannot replace the scope of an already-open document", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ scope: "existing:A:1" }))),
    );
    await initializeDatasetScope();
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ scope: "wrong:B:2" }))),
    );
    await expect(initializeDatasetScope(controller.signal)).rejects.toThrow();
    expect(datasetScopeHeaders().get("X-Dataset-Scope")).toBe("existing:A:1");
  });

  // 不变式（刻意）：页面**不**采纳响应头里的 X-Dataset-Scope。静默跟随服务端数据集
  // 会让一个还开着编辑器的旧标签页把草稿写进另一个数据集里同 id 的记录；
  // 身份只在启动与用户显式切数据集时变化（见 datasetScope.ts 文件头与
  // tests/smoke/release-boundaries.spec.ts）。本模块因此只导出 initialize 这一个写入口。
});
