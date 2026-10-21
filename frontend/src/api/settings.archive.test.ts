// SPDX-License-Identifier: Apache-2.0
/**
 * 导出包的**未覆盖范围**（H3）：三个响应头 → `ArchiveDownload.coverage`。
 *
 * 为什么单独测这一层：包本身是二进制，界面上能看到的是 hook 拼出来的提示文案，而"响应头
 * 到底有没有被读出来"只有在这一层能钉住。漏读的后果不是报错，而是**静默少报**——用户以为
 * 数据目录里的东西都进了包，换机恢复时才发现字体等文件没跟过来。
 *
 * 沿用 `jobs.test.ts` 的写法：`vi.stubGlobal("fetch", ...)`，不引入新的 mock 库。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { exportAllDatasets, exportDataset } from "./settings";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** 让导出请求返回一个"压缩包"响应；`headers` 就是后端会带的那几个 X-Backup-* 头。 */
function stubArchiveResponse(headers: Record<string, string>) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response("zip-bytes", {
      status: 200,
      headers: { "Content-Type": "application/zip", ...headers },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("导出包的未覆盖范围（H3）", () => {
  it("从响应头读出未纳入备份的项数与总字节数", async () => {
    stubArchiveResponse({
      "X-Backup-Uncovered": "2",
      "X-Backup-Uncovered-Bytes": "2048",
      "X-Backup-Uncovered-Truncated": "0",
    });

    const result = await exportDataset("main");

    expect(result.coverage).toEqual({ count: 2, bytes: 2048, truncated: false });
    // 附件问题的口径不受影响：未覆盖项不是"附件问题"，不该让它变成"备份不完整"。
    expect(result.assetIssues.incomplete).toBe(false);
    expect(result.incompleteBackup).toBe(false);
  });

  it("扫描达到上限时 truncated 为 true（数量只是下限）", async () => {
    stubArchiveResponse({
      "X-Backup-Uncovered": "5000",
      "X-Backup-Uncovered-Bytes": "10485760",
      "X-Backup-Uncovered-Truncated": "1",
    });

    const result = await exportAllDatasets();

    expect(result.coverage.count).toBe(5000);
    expect(result.coverage.bytes).toBe(10 * 1024 * 1024);
    expect(result.coverage.truncated).toBe(true);
  });

  it("旧后端没有这三个头时按 0 处理（界面一个字都不多说）", async () => {
    stubArchiveResponse({});

    const result = await exportDataset("main");

    expect(result.coverage).toEqual({ count: 0, bytes: 0, truncated: false });
  });
});
