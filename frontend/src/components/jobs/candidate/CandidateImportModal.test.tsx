// SPDX-License-Identifier: Apache-2.0
/** 备选岗位 CSV 导入弹窗：多文件合并去重、坏文件隔离与粘贴入口。 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CandidateCsvPreview } from "../../../types";
import { CandidateImportModal } from "./CandidateImportModal";

const previewCandidateImport = vi.fn();
const importCandidatesCsv = vi.fn();

vi.mock("../../../api/candidateJob", () => ({
  previewCandidateImport: (...args: unknown[]) => previewCandidateImport(...args),
  importCandidatesCsv: (...args: unknown[]) => importCandidatesCsv(...args),
}));

function csvFile(name: string): File {
  return new File(["x"], name, { type: "text/csv" });
}

function pickFiles(files: File[]) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  expect(input).not.toBeNull();
  fireEvent.change(input!, { target: { files } });
}

function renderModal(onImported = vi.fn()) {
  return render(
    <AntdApp>
      <CandidateImportModal open onClose={vi.fn()} onImported={onImported} />
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

describe("CandidateImportModal 多文件", () => {
  it("两个文件按「岗位名 + 链接」去重后合并预览，坏文件不阻断好文件", async () => {
    previewCandidateImport.mockImplementation((file: File) => {
      if (file.name === "bad.csv") return Promise.reject(new Error("不是有效的 CSV"));
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
        errors: [{ line: 5, message: "岗位链接必须以 http:// 或 https:// 开头" }],
      } satisfies CandidateCsvPreview);
    });
    importCandidatesCsv.mockResolvedValue({ imported: 3, failed: [] });
    const onImported = vi.fn();
    renderModal(onImported);

    pickFiles([csvFile("a.csv"), csvFile("bad.csv"), csvFile("b.csv")]);

    expect(await screen.findByText(/合计可导入 3 条/)).toBeInTheDocument();
    expect(screen.getByText(/已去除重复 1 行/)).toBeInTheDocument();
    expect(screen.getByText("不是有效的 CSV")).toBeInTheDocument();
    expect(screen.getByText("解析失败")).toBeInTheDocument();
    expect(screen.getByText(/岗位链接必须以 http/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /确认导入 3 条/ }));
    await waitFor(() => expect(importCandidatesCsv).toHaveBeenCalledTimes(1));
    const submitted = importCandidatesCsv.mock.calls[0]?.[0] as { line: number }[];
    // 只提交去重后的 3 行（坏文件一行都没混进来）。
    expect(submitted).toHaveLength(3);
    await waitFor(() => expect(onImported).toHaveBeenCalledWith(3));
  });

  it("粘贴纯文本当作一个 CSV 文件解析", async () => {
    previewCandidateImport.mockResolvedValue({
      rows: [{ line: 2, data: { title: "后端开发", company: "示例科技" } }],
      errors: [],
    } satisfies CandidateCsvPreview);
    renderModal();

    fireEvent.paste(screen.getByRole("group", { name: "CSV 导入区" }), {
      clipboardData: { files: [], getData: () => "岗位名称,公司名称\n后端开发,示例科技" },
    });

    await waitFor(() => expect(previewCandidateImport).toHaveBeenCalledTimes(1));
    expect((previewCandidateImport.mock.calls[0]?.[0] as File).name).toBe("粘贴内容.csv");
    expect(await screen.findByText(/合计可导入 1 条/)).toBeInTheDocument();
  });
});
