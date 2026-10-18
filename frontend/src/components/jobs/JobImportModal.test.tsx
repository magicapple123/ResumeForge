/** 岗位 CSV 导入弹窗：多文件预览→确认两步，逐行错误、去重与分块账目都讲清楚。 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobImportPreview } from "../../types";
import { JobImportModal } from "./JobImportModal";

const previewJobImport = vi.fn();
const importJobs = vi.fn();

vi.mock("../../api/jobs", () => ({
  previewJobImport: (...args: unknown[]) => previewJobImport(...args),
  importJobs: (...args: unknown[]) => importJobs(...args),
}));

const PREVIEW: JobImportPreview = {
  rows: [
    { line: 2, data: { title: "后端开发", company: "示例科技", origin_source: "内推" } },
    { line: 5, data: { title: "算法工程师", company: "另一家", origin_source: "" } },
  ],
  errors: [{ line: 4, message: "标题不能为空" }],
};

function Harness({ onImported = vi.fn() }: { onImported?: () => void }) {
  return (
    <AntdApp>
      <JobImportModal open onClose={vi.fn()} onImported={onImported} />
    </AntdApp>
  );
}

function csvFile(name: string): File {
  return new File(["x"], name, { type: "text/csv" });
}

function pickFiles(files: File[]) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  expect(input).not.toBeNull();
  fireEvent.change(input!, { target: { files } });
}

function pasteCsv(text: string) {
  fireEvent.paste(screen.getByRole("group", { name: "CSV 导入区" }), {
    clipboardData: { files: [], getData: () => text },
  });
}

beforeEach(() => {
  previewJobImport.mockReset();
  importJobs.mockReset();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("JobImportModal 多文件", () => {
  it("选两个文件：预览条数等于去重后的行数之和", async () => {
    previewJobImport.mockImplementation((file: File) => {
      if (file.name === "a.csv") return Promise.resolve(PREVIEW);
      return Promise.resolve({
        rows: [
          // 与 a.csv 的第一行重复（公司 + 岗位名相同）→ 应当被去掉。
          { line: 2, data: { title: "后端开发", company: "示例科技" } },
          { line: 3, data: { title: "数据工程师", company: "第三家" } },
        ],
        errors: [],
      } satisfies JobImportPreview);
    });
    render(<Harness />);

    pickFiles([csvFile("a.csv"), csvFile("b.csv")]);

    // 2（a）+ 2（b）- 1（重复）= 3
    expect(await screen.findByText(/合计可导入 3 条/)).toBeInTheDocument();
    expect(screen.getByText(/已去除重复 1 行/)).toBeInTheDocument();
    // 汇总行与文件条目都会说"1 行有问题"，这里只要求至少出现一处。
    expect(screen.getAllByText(/1 行有问题/).length).toBeGreaterThan(0);
    // 错误条目带文件名，用户知道该改哪个 CSV。
    expect(screen.getByText("第 4 行")).toBeInTheDocument();
    expect(screen.getByText("标题不能为空")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /确认导入 3 条/ })).toBeEnabled();
  });

  it("一个坏文件不阻断好文件：坏文件标解析失败，好文件仍可导入", async () => {
    previewJobImport.mockImplementation((file: File) => {
      if (file.name === "bad.csv") return Promise.reject(new Error("文件编码无法识别"));
      return Promise.resolve(PREVIEW);
    });
    importJobs.mockResolvedValue({ imported: 2, failed: [] });
    render(<Harness />);

    pickFiles([csvFile("bad.csv"), csvFile("good.csv")]);

    expect(await screen.findByText("解析失败")).toBeInTheDocument();
    expect(screen.getByText("文件编码无法识别")).toBeInTheDocument();
    expect(await screen.findByText(/合计可导入 2 条/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /确认导入 2 条/ }));
    await waitFor(() => expect(importJobs).toHaveBeenCalledTimes(1));
    // 只提交好文件的行，坏文件一个行都没混进来。
    expect(importJobs).toHaveBeenCalledWith(PREVIEW.rows);
  });

  it("粘贴纯文本当作一个 CSV 文件解析", async () => {
    previewJobImport.mockResolvedValue(PREVIEW);
    render(<Harness />);

    pasteCsv("岗位名称,公司名称\n后端开发,示例科技");

    await waitFor(() => expect(previewJobImport).toHaveBeenCalledTimes(1));
    const file = previewJobImport.mock.calls[0]?.[0] as File;
    expect(file.name).toBe("粘贴内容.csv");
    expect(await screen.findByText(/合计可导入 2 条/)).toBeInTheDocument();
  });

  it("超过 500 行按块提交：600 行调用两次 importJobs", async () => {
    const rows = Array.from({ length: 600 }, (_, index) => ({
      line: index + 2,
      data: { title: `岗位 ${index}`, company: "示例科技" },
    }));
    previewJobImport.mockResolvedValue({ rows, errors: [] });
    importJobs.mockImplementation((chunk: unknown[]) =>
      Promise.resolve({ imported: chunk.length, failed: [] }),
    );
    const onImported = vi.fn();
    render(<Harness onImported={onImported} />);

    pickFiles([csvFile("big.csv")]);
    fireEvent.click(await screen.findByRole("button", { name: /确认导入 600 条/ }));

    await waitFor(() => expect(importJobs).toHaveBeenCalledTimes(2));
    expect(importJobs.mock.calls[0]?.[0]).toHaveLength(500);
    expect(importJobs.mock.calls[1]?.[0]).toHaveLength(100);
    await waitFor(() => expect(onImported).toHaveBeenCalled());
  });
});
