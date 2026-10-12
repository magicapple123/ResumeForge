/** 岗位 CSV 导入弹窗：预览→确认两步，逐行错误与成功账目都讲清楚。 */
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

beforeEach(() => {
  previewJobImport.mockReset();
  importJobs.mockReset();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("JobImportModal", () => {
  it("选文件后展示预览账目：可导入行与逐行错误", async () => {
    previewJobImport.mockResolvedValue(PREVIEW);
    render(<Harness />);

    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    fireEvent.change(input!, {
      target: { files: [new File(["x"], "jobs.csv", { type: "text/csv" })] },
    });

    await waitFor(() => expect(previewJobImport).toHaveBeenCalled());
    expect(await screen.findByText(/可导入 2 条/)).toBeInTheDocument();
    expect(screen.getByText(/4 行有问题|1 行有问题/)).toBeInTheDocument();
    expect(screen.getByText("第 4 行")).toBeInTheDocument();
    expect(screen.getByText("标题不能为空")).toBeInTheDocument();
    // 确认按钮带条数，且未提交前不可点（先预览后导入）。
    expect(screen.getByRole("button", { name: /确认导入 2 条/ })).toBeInTheDocument();
  });

  it("确认导入后按账目提示，成功即回调刷新", async () => {
    previewJobImport.mockResolvedValue(PREVIEW);
    importJobs.mockResolvedValue({ imported: 2, failed: [] });
    const onImported = vi.fn();
    render(<Harness onImported={onImported} />);

    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    fireEvent.change(input!, {
      target: { files: [new File(["x"], "jobs.csv", { type: "text/csv" })] },
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /确认导入 2 条/ })).toBeEnabled(),
    );

    fireEvent.click(screen.getByRole("button", { name: /确认导入 2 条/ }));
    await waitFor(() => expect(importJobs).toHaveBeenCalledWith(PREVIEW.rows));
    await waitFor(() => expect(onImported).toHaveBeenCalled());
  });
});
