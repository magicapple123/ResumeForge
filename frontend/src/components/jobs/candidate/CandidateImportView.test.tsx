// SPDX-License-Identifier: Apache-2.0
/**
 * 备选岗位 CSV 导入视图：多文件合并去重、坏文件隔离与粘贴入口。
 *
 * 断言只写 `t(key)`：文案改动时用例自动跟上，也不会在测试里新增中文字面量
 * （`cjkRatchet` 的 tests 口径逐文件比较）。后端错误文案属于"数据"，用常量持有。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import type { CandidateCsvPreview } from "../../../types";
import { CandidateImportView } from "./CandidateImportView";

const previewCandidateImport = vi.fn();
const importCandidatesCsv = vi.fn();

vi.mock("../../../api/candidateJob", () => ({
  previewCandidateImport: (...args: unknown[]) => previewCandidateImport(...args),
  importCandidatesCsv: (...args: unknown[]) => importCandidatesCsv(...args),
}));

/** 后端/解析器给的原文（不是界面文案，用常量持有以免污染文案断言）。 */
const PARSE_FAILED = "parse failed: not a csv";
const LINK_ERROR = "source_url must start with http:// or https://";

function csvFile(name: string): File {
  return new File(["x"], name, { type: "text/csv" });
}

function pickFiles(files: File[]) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  expect(input).not.toBeNull();
  fireEvent.change(input!, { target: { files } });
}

function renderView(onImported = vi.fn(), onClose = vi.fn()) {
  return render(
    <AntdApp>
      <CandidateImportView onClose={onClose} onImported={onImported} />
    </AntdApp>,
  );
}

beforeEach(() => {
  previewCandidateImport.mockReset();
  importCandidatesCsv.mockReset();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("CandidateImportView 多文件", () => {
  it("两个文件按「岗位名 + 链接」去重后合并预览，坏文件不阻断好文件", async () => {
    previewCandidateImport.mockImplementation((file: File) => {
      if (file.name === "bad.csv") return Promise.reject(new Error(PARSE_FAILED));
      if (file.name === "a.csv") {
        return Promise.resolve({
          rows: [
            { line: 2, data: { title: "后端开发", company: "示例科技", source_url: "" } },
            { line: 3, data: { title: "算法工程师", company: "另一家", source_url: "" } },
          ],
          errors: [],
        } satisfies CandidateCsvPreview);
      }
      return Promise.resolve({
        rows: [
          // 与 a.csv 第一行重名且都没链接 → 判为同一岗位。
          { line: 2, data: { title: "后端开发", company: "示例科技", source_url: "" } },
          { line: 4, data: { title: "数据工程师", company: "第三家", source_url: "" } },
        ],
        errors: [{ line: 5, message: LINK_ERROR, code: "invalid" }],
      } satisfies CandidateCsvPreview);
    });
    importCandidatesCsv.mockResolvedValue({ imported: 3, failed: [] });
    const onImported = vi.fn();
    renderView(onImported);

    pickFiles([csvFile("a.csv"), csvFile("bad.csv"), csvFile("b.csv")]);

    expect(
      await screen.findByText(t("jobs.candidate.import.summary", { files: 3, rows: 3 })),
    ).toBeInTheDocument();
    // 去重丢弃 1 行：两份文件里「后端开发 + 空链接」重复。
    expect(
      screen.getByText(t("jobs.candidate.import.duplicates-count", { count: 1 })),
    ).toBeInTheDocument();
    expect(screen.getByText(PARSE_FAILED)).toBeInTheDocument();
    expect(screen.getByText(t("jobs.candidate.import.file-error"))).toBeInTheDocument();
    expect(screen.getByText(LINK_ERROR, { exact: false })).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: t("jobs.candidate.import.confirm", { count: 3 }) }),
    );
    await waitFor(() => expect(importCandidatesCsv).toHaveBeenCalledTimes(1));
    const submitted = importCandidatesCsv.mock.calls[0]?.[0] as { line: number }[];
    // 只提交去重后的 3 行（坏文件一行都没混进来）。
    expect(submitted).toHaveLength(3);
    await waitFor(() => expect(onImported).toHaveBeenCalledWith(3));
  });

  it("does not classify an old duplicate message without a stable code", async () => {
    previewCandidateImport.mockResolvedValue({
      rows: [{ line: 2, data: { title: "Backend", company: "Example" } }],
      errors: [],
    } satisfies CandidateCsvPreview);
    importCandidatesCsv.mockResolvedValue({
      imported: 0,
      failed: [{ line: 2, message: t("jobs.candidate.import.skip-token") }],
    });
    const onClose = vi.fn();
    renderView(vi.fn(), onClose);
    pickFiles([csvFile("a.csv")]);
    fireEvent.click(
      await screen.findByRole("button", { name: t("jobs.candidate.import.confirm", { count: 1 }) }),
    );
    await waitFor(() => expect(importCandidatesCsv).toHaveBeenCalledTimes(1));
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /确认导入 1 条/ })).not.toHaveClass(
        "ant-btn-loading",
      );
    });
  });

  it("classifies a duplicate row by stable code regardless of its display message", async () => {
    previewCandidateImport.mockResolvedValue({
      rows: [{ line: 2, data: { title: "Backend", company: "Example" } }],
      errors: [],
    } satisfies CandidateCsvPreview);
    importCandidatesCsv.mockResolvedValue({
      imported: 0,
      failed: [{ line: 2, message: "Backend already exists", code: "duplicate" }],
    });
    const onClose = vi.fn();
    renderView(vi.fn(), onClose);
    pickFiles([csvFile("a.csv")]);
    fireEvent.click(
      await screen.findByRole("button", { name: t("jobs.candidate.import.confirm", { count: 1 }) }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("粘贴纯文本当作一个 CSV 文件解析", async () => {
    previewCandidateImport.mockResolvedValue({
      rows: [{ line: 2, data: { title: "后端开发", company: "示例科技" } }],
      errors: [],
    } satisfies CandidateCsvPreview);
    renderView();

    fireEvent.paste(screen.getByRole("group", { name: t("jobs.candidate.import.region") }), {
      clipboardData: { files: [], getData: () => "title,company\nbackend,acme" },
    });

    await waitFor(() => expect(previewCandidateImport).toHaveBeenCalledTimes(1));
    expect((previewCandidateImport.mock.calls[0]?.[0] as File).name).toBe(
      t("jobs.candidate.import.pasted-file"),
    );
    expect(
      await screen.findByText(t("jobs.candidate.import.summary", { files: 1, rows: 1 })),
    ).toBeInTheDocument();
  });
});
