// SPDX-License-Identifier: Apache-2.0
/** CSV 批量导入状态机（R1）：合并、去重、坏文件隔离、上限与分块账目。 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  CSV_TOO_MANY_FILES_MESSAGE,
  CSV_TOO_MANY_ROWS_MESSAGE,
  chunkRows,
  commitRowsInChunks,
  useCsvFileBatch,
} from "./useCsvFileBatch";

interface Row {
  line: number;
  data: Record<string, string>;
}

interface RowError {
  line: number;
  message: string;
  code?: "duplicate" | "invalid" | "error";
}

function row(line: number, title: string, company = "示例科技", url = ""): Row {
  return { line, data: { title, company, source_url: url } };
}

/** 岗位口径的去重键：company|title|source_url（trim + lower）。 */
function jobKey(item: Row): string {
  return [item.data.company, item.data.title, item.data.source_url]
    .map((value) => (value ?? "").trim().toLowerCase())
    .join("|");
}

function csvFile(name: string): File {
  return new File(["title"], name, { type: "text/csv" });
}

/** 按文件名返回预设的解析结果；未列出的文件视为解析失败。 */
function parseByFile(table: Record<string, { rows: Row[]; errors: RowError[] }>) {
  return vi.fn((file: File) => {
    const result = table[file.name];
    if (!result) return Promise.reject(new Error(`${file.name} 不是 CSV`));
    return Promise.resolve(result);
  });
}

describe("useCsvFileBatch 合并与去重", () => {
  it("多个文件的 rows/errors 合并，并逐条带上 sourceFile", async () => {
    const parseFile = parseByFile({
      "a.csv": { rows: [row(2, "后端开发"), row(3, "前端开发")], errors: [] },
      "b.csv": { rows: [row(2, "算法工程师")], errors: [{ line: 5, message: "标题不能为空" }] },
    });
    const { result } = renderHook(() =>
      useCsvFileBatch<Row, RowError>({ parseFile, dedupeKey: jobKey }),
    );

    await act(() => result.current.addFiles([csvFile("a.csv"), csvFile("b.csv")]));

    expect(result.current.files.map((item) => [item.file, item.status])).toEqual([
      ["a.csv", "ok"],
      ["b.csv", "ok"],
    ]);
    expect(result.current.rows.map((item) => item.data.title)).toEqual([
      "后端开发",
      "前端开发",
      "算法工程师",
    ]);
    // 每条都记得自己来自哪个文件：预览与错误列表都要说清楚。
    expect(result.current.rows.map((item) => item.sourceFile)).toEqual(["a.csv", "a.csv", "b.csv"]);
    expect(result.current.errors).toEqual([
      { line: 5, message: "标题不能为空", sourceFile: "b.csv" },
    ]);
    expect(result.current.canCommit).toBe(true);
    expect(result.current.duplicates).toBe(0);
  });

  it("跨文件重复行被丢弃，并计到后一个文件的 duplicates 上", async () => {
    const parseFile = parseByFile({
      "a.csv": { rows: [row(2, "后端开发", "示例科技")], errors: [] },
      "b.csv": {
        rows: [row(2, " 后端开发 ", " 示例科技 "), row(3, "算法工程师", "示例科技")],
        errors: [],
      },
    });
    const { result } = renderHook(() =>
      useCsvFileBatch<Row, RowError>({ parseFile, dedupeKey: jobKey }),
    );

    await act(() => result.current.addFiles([csvFile("a.csv"), csvFile("b.csv")]));

    expect(result.current.rows.map((item) => item.data.title)).toEqual(["后端开发", "算法工程师"]);
    expect(result.current.duplicates).toBe(1);
    expect(result.current.files[1]?.importable).toBe(1);
    expect(result.current.files[1]?.duplicates).toBe(1);
  });

  it("同一文件内部的重复行也算重复", async () => {
    const parseFile = parseByFile({
      "a.csv": { rows: [row(2, "后端开发"), row(4, "后端开发")], errors: [] },
    });
    const { result } = renderHook(() =>
      useCsvFileBatch<Row, RowError>({ parseFile, dedupeKey: jobKey }),
    );

    await act(() => result.current.addFiles([csvFile("a.csv")]));

    expect(result.current.rows).toHaveLength(1);
    expect(result.current.duplicates).toBe(1);
  });
});

describe("useCsvFileBatch 错误隔离", () => {
  it("单个文件解析失败只标记自己，其它文件仍可导入", async () => {
    const parseFile = parseByFile({
      "good.csv": { rows: [row(2, "后端开发")], errors: [] },
    });
    const { result } = renderHook(() =>
      useCsvFileBatch<Row, RowError>({ parseFile, dedupeKey: jobKey }),
    );

    await act(() => result.current.addFiles([csvFile("bad.csv"), csvFile("good.csv")]));

    const bad = result.current.files[0]!;
    expect(bad.status).toBe("error");
    expect(bad.message).toBe("bad.csv 不是 CSV");
    expect(bad.importable).toBe(0);
    expect(result.current.files[1]?.status).toBe("ok");
    expect(result.current.rows).toHaveLength(1);
    // 坏文件不影响提交：好文件照常能导。
    expect(result.current.canCommit).toBe(true);
  });

  it("移除文件后合并结果与去重账目一起重算", async () => {
    const parseFile = parseByFile({
      "a.csv": { rows: [row(2, "后端开发")], errors: [] },
      "b.csv": { rows: [row(2, "后端开发")], errors: [] },
    });
    const { result } = renderHook(() =>
      useCsvFileBatch<Row, RowError>({ parseFile, dedupeKey: jobKey }),
    );

    await act(() => result.current.addFiles([csvFile("a.csv"), csvFile("b.csv")]));
    expect(result.current.duplicates).toBe(1);

    act(() => result.current.removeFile(result.current.files[0]!.id));

    expect(result.current.files).toHaveLength(1);
    expect(result.current.duplicates).toBe(0);
    expect(result.current.rows).toHaveLength(1);
  });
});

describe("useCsvFileBatch 上限", () => {
  it("超过 10 个文件直接拒绝，一个都不解析", async () => {
    const parseFile = parseByFile({});
    const { result } = renderHook(() =>
      useCsvFileBatch<Row, RowError>({ parseFile, dedupeKey: jobKey }),
    );

    await act(() =>
      result.current.addFiles(Array.from({ length: 11 }, (_, index) => csvFile(`f${index}.csv`))),
    );

    expect(result.current.files).toHaveLength(0);
    expect(result.current.notice).toBe(CSV_TOO_MANY_FILES_MESSAGE);
    expect(parseFile).not.toHaveBeenCalled();
  });

  it("合并超过 2000 行时如实拒绝：不截断行，只禁止提交", async () => {
    const rows = Array.from({ length: 2001 }, (_, index) => row(index + 2, `岗位 ${index}`));
    const parseFile = parseByFile({ "big.csv": { rows, errors: [] } });
    const { result } = renderHook(() =>
      useCsvFileBatch<Row, RowError>({ parseFile, dedupeKey: jobKey }),
    );

    await act(() => result.current.addFiles([csvFile("big.csv")]));

    expect(result.current.rows).toHaveLength(2001);
    expect(result.current.canCommit).toBe(false);
    expect(result.current.notice).toBe(CSV_TOO_MANY_ROWS_MESSAGE);
  });

  it("reset 清空文件、合并结果与提示", async () => {
    const parseFile = parseByFile({ "a.csv": { rows: [row(2, "后端开发")], errors: [] } });
    const { result } = renderHook(() =>
      useCsvFileBatch<Row, RowError>({ parseFile, dedupeKey: jobKey }),
    );

    await act(() => result.current.addFiles([csvFile("a.csv")]));
    act(() => result.current.reset());

    expect(result.current.files).toHaveLength(0);
    expect(result.current.rows).toHaveLength(0);
    expect(result.current.canCommit).toBe(false);
    expect(result.current.notice).toBe("");
  });
});

describe("分块提交", () => {
  it("按 500 行切块：1200 行切成 500/500/200", () => {
    const chunks = chunkRows(Array.from({ length: 1200 }, (_, index) => index));
    expect(chunks.map((chunk) => chunk.length)).toEqual([500, 500, 200]);
    expect(chunks[2]?.[0]).toBe(1000);
  });

  it("顺序提交并累加 imported/failed（后端一次只吃 500 行）", async () => {
    const commitRows = vi.fn((chunk: Row[]) =>
      Promise.resolve({ imported: chunk.length, failed: [] }),
    );
    const rows = Array.from({ length: 600 }, (_, index) => row(index + 2, `岗位 ${index}`));

    const outcome = await commitRowsInChunks<Row, RowError>({ rows, commitRows });

    expect(commitRows).toHaveBeenCalledTimes(2);
    expect(commitRows.mock.calls[0]?.[0]).toHaveLength(500);
    expect(commitRows.mock.calls[1]?.[0]).toHaveLength(100);
    expect(outcome.imported).toBe(600);
    expect(outcome.failedChunk).toBeUndefined();
  });

  it("某块请求失败即停止后续块，返回已导入数量与失败块序号", async () => {
    const commitRows = vi
      .fn<(chunk: Row[]) => Promise<{ imported: number; failed: RowError[] }>>()
      .mockResolvedValueOnce({ imported: 500, failed: [] })
      .mockRejectedValueOnce(new Error("网络中断"));
    const rows = Array.from({ length: 1200 }, (_, index) => row(index + 2, `岗位 ${index}`));

    const outcome = await commitRowsInChunks<Row, RowError>({ rows, commitRows });

    expect(commitRows).toHaveBeenCalledTimes(2);
    expect(outcome.imported).toBe(500);
    expect(outcome.failedChunk).toBe(2);
    expect(outcome.failedMessage).toBe("网络中断");
  });

  it("后端逐行失败累加到同一个账目里", async () => {
    const commitRows = vi.fn((chunk: Row[]) =>
      Promise.resolve({
        imported: chunk.length - 1,
        failed: [{ line: chunk[0]!.line, message: "岗位广场已有这个岗位，已跳过" }],
      }),
    );

    const outcome = await commitRowsInChunks<Row, RowError>({
      rows: [row(2, "后端开发"), row(3, "前端开发")],
      commitRows,
    });

    expect(outcome.imported).toBe(1);
    expect(outcome.failed).toHaveLength(1);
    expect(outcome.failedChunk).toBeUndefined();
  });

  it("keeps machine-readable error codes intact across chunk commits", async () => {
    const failure: RowError = {
      line: 9,
      message: "Localized duplicate message",
      code: "duplicate",
    };
    const outcome = await commitRowsInChunks<Row, RowError>({
      rows: [row(2, "Backend")],
      commitRows: vi.fn().mockResolvedValue({ imported: 0, failed: [failure] }),
    });
    expect(outcome.failed).toEqual([failure]);
    expect(outcome.failed[0]?.code).toBe("duplicate");
  });
});
