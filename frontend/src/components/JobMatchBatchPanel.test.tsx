import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobMatchBatchOut } from "../types";
import JobMatchBatchPanel from "./JobMatchBatchPanel";

const apiMocks = vi.hoisted(() => ({
  generateJobMatchBatch: vi.fn(),
  listJobMatchBatches: vi.fn(),
  getJobMatchBatch: vi.fn(),
  startJobMatchBatchTask: vi.fn(),
}));
const backgroundMocks = vi.hoisted(() => ({ watchJobMatchBatchTask: vi.fn() }));

vi.mock("../api/jobs", () => apiMocks);
vi.mock("../utils/jobMatchBackgroundTasks", () => backgroundMocks);

const BATCH: JobMatchBatchOut = {
  id: 7,
  requested_count: 2,
  completed_count: 2,
  failed_count: 0,
  model: "demo-model",
  created_at: "2026-09-29T08:00:00",
  updated_at: "2026-09-29T08:00:00",
  items: [
    {
      job_id: 2,
      job_title: "后端开发",
      company: "示例科技",
      status: "completed",
      rank: 1,
      reference_score: { score: 88, dimensions: [], disclaimer: "仅供展示" },
      result: {
        hard_conditions: [],
        core_abilities: [],
        bonus_items: [],
        hard_gate: "met",
        admission: "allow",
        advice: "",
        notes: [],
      },
      model: "demo-model",
      analysis_source: "new",
      error: "",
    },
    {
      job_id: 1,
      job_title: "产品助理",
      company: "示例公司",
      status: "completed",
      rank: 2,
      reference_score: { score: 61, dimensions: [], disclaimer: "仅供展示" },
      result: {
        hard_conditions: [],
        core_abilities: [],
        bonus_items: [],
        hard_gate: "unknown",
        admission: "needs_confirm",
        advice: "",
        notes: [],
      },
      model: "demo-model",
      analysis_source: "new",
      error: "",
    },
  ],
};

function renderPanel(props: Partial<React.ComponentProps<typeof JobMatchBatchPanel>> = {}) {
  return render(
    <AntdApp>
      <JobMatchBatchPanel open jobIds={[2, 1]} autoRun onClose={vi.fn()} {...props} />
    </AntdApp>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.listJobMatchBatches.mockResolvedValue([]);
  apiMocks.generateJobMatchBatch.mockResolvedValue(BATCH);
  apiMocks.getJobMatchBatch.mockResolvedValue(BATCH);
  apiMocks.startJobMatchBatchTask.mockResolvedValue({
    task_id: "background-task-1",
    status: "pending",
    job_ids: [2, 1],
    force: false,
    requested_count: 2,
    completed_count: 0,
    failed_count: 0,
    current_job_id: null,
    current_job_title: "",
    batch_id: null,
    message: "等待后台任务启动",
    error: "",
    created_at: "2026-09-30T08:00:00",
    started_at: null,
    finished_at: null,
  });
});

afterEach(cleanup);

describe("JobMatchBatchPanel", () => {
  it("批量分析后按参考分展示并保留记录入口", async () => {
    renderPanel();

    await waitFor(() =>
      expect(apiMocks.generateJobMatchBatch).toHaveBeenCalledWith({
        job_ids: [2, 1],
        force: false,
      }),
    );
    expect(await screen.findByText("已完成 2 个岗位，0 个岗位失败")).toBeInTheDocument();
    expect(screen.getByText("匹配度参考分：88")).toBeInTheDocument();
    expect(screen.getByText("匹配度参考分：61")).toBeInTheDocument();
    expect(screen.getByText("历史记录")).toBeInTheDocument();
  });

  it("历史记录可以加载并回看某一批结果", async () => {
    apiMocks.listJobMatchBatches.mockResolvedValue([
      {
        id: 7,
        requested_count: 2,
        completed_count: 2,
        failed_count: 0,
        top_score: 88,
        model: "demo-model",
        created_at: "2026-09-29T08:00:00",
      },
    ]);
    renderPanel({ autoRun: false, jobIds: [] });

    fireEvent.click(await screen.findByText("历史记录"));
    expect(await screen.findByText(/第 7 批/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查看结果" }));

    await waitFor(() => expect(apiMocks.getJobMatchBatch).toHaveBeenCalledWith(7));
    expect(await screen.findByText("匹配度参考分：88")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重新分析" })).not.toBeInTheDocument();
  });

  it("后台模式创建任务后关闭弹窗，不阻塞当前页面", async () => {
    const onClose = vi.fn();
    renderPanel({ runMode: "background", onClose });

    await waitFor(() =>
      expect(apiMocks.startJobMatchBatchTask).toHaveBeenCalledWith({
        job_ids: [2, 1],
        force: false,
      }),
    );
    expect(backgroundMocks.watchJobMatchBatchTask).toHaveBeenCalledWith(
      expect.objectContaining({ task_id: "background-task-1" }),
      "岗位适配度分析（2 个岗位）",
    );
    expect(onClose).toHaveBeenCalledOnce();
  });
});
