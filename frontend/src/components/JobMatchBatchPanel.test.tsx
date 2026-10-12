import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobMatchBatchOut, JobMatchBackgroundTask } from "../types";
import JobMatchBatchPanel from "./JobMatchBatchPanel";

const apiMocks = vi.hoisted(() => ({
  listJobMatchBatches: vi.fn(),
  getJobMatchBatch: vi.fn(),
  getJobMatchBatchTask: vi.fn(),
  startJobMatchBatchTask: vi.fn(),
}));
const backgroundMocks = vi.hoisted(() => ({
  watchJobMatchBatchTask: vi.fn(),
  cancelJobMatchBackgroundTask: vi.fn(),
}));
const tasksHookMocks = vi.hoisted(() => ({ useJobMatchBackgroundTasks: vi.fn() }));

vi.mock("../api/jobs", () => apiMocks);
vi.mock("../utils/jobMatchBackgroundTasks", () => backgroundMocks);
vi.mock("../hooks/useJobMatchBackgroundTasks", () => tasksHookMocks);

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

function makeTask(overrides: Partial<JobMatchBackgroundTask> = {}): JobMatchBackgroundTask {
  return {
    task_id: "background-task-1",
    status: "running",
    job_ids: [2, 1],
    force: false,
    requested_count: 2,
    completed_count: 1,
    failed_count: 0,
    current_job_id: 1,
    current_job_title: "产品助理",
    batch_id: null,
    message: "正在分析",
    error: "",
    created_at: "2026-09-30T08:00:00",
    started_at: "2026-09-30T08:00:01",
    finished_at: null,
    ...overrides,
  };
}

function renderPanel(props: Partial<React.ComponentProps<typeof JobMatchBatchPanel>> = {}) {
  return render(
    <AntdApp>
      <JobMatchBatchPanel open jobIds={[2, 1]} onClose={vi.fn()} {...props} />
    </AntdApp>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.listJobMatchBatches.mockResolvedValue([]);
  apiMocks.getJobMatchBatch.mockResolvedValue(BATCH);
  apiMocks.startJobMatchBatchTask.mockResolvedValue(makeTask({ status: "pending" }));
  // 面板的完成判定轮询会真调这个端点：默认回一个"仍在跑"的任务，个别用例再覆盖。
  apiMocks.getJobMatchBatchTask.mockResolvedValue(makeTask({ status: "running" }));
  backgroundMocks.cancelJobMatchBackgroundTask.mockResolvedValue(makeTask({ status: "cancelled" }));
  tasksHookMocks.useJobMatchBackgroundTasks.mockReturnValue([]);
});

afterEach(cleanup);

describe("JobMatchBatchPanel", () => {
  it("打开面板先停在设置视图，点「开始分析」才创建后台任务", async () => {
    renderPanel();

    // 设置视图：不再一点击入口就开跑——同步批量端点（会撞超时）也不该被调用。
    expect(await screen.findByText(/将为 2 个勾选的岗位逐一分析适配度/)).toBeInTheDocument();
    expect(apiMocks.startJobMatchBatchTask).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /开始分析/ }));

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
    // 任务创建后面板进入进度视图（进度来自后台任务注册表，见下一个用例）。
  });

  it("任务进行中显示进度与取消入口；可以转入后台", async () => {
    tasksHookMocks.useJobMatchBackgroundTasks.mockReturnValue([
      {
        id: "background-task-1",
        label: "岗位适配度分析（2 个岗位）",
        status: "running",
        requestedCount: 2,
        completedCount: 1,
        failedCount: 0,
        currentJobTitle: "产品助理",
        message: "正在分析",
        error: "",
        batchId: null,
      },
    ]);
    renderPanel();

    console.log("DEBUG-3 phase text:", document.querySelector(".ant-tabs-tab-active")?.textContent);
    console.log("DEBUG-3 has alert:", !!screen.queryByText(/正在后台分析/));
    const alertEl = document.querySelector(".ant-alert-title, .ant-alert-message");
    console.log("DEBUG-3 alert text:", JSON.stringify(alertEl?.textContent ?? null));
    expect(await screen.findByText(/正在后台分析，关闭这个窗口也不会中断/)).toBeInTheDocument();
    expect(screen.getByText(/已完成 1 \/ 2 个岗位/)).toBeInTheDocument();
    expect(screen.getByText(/正在分析：产品助理/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "取消本次分析" }));
    await waitFor(() =>
      expect(backgroundMocks.cancelJobMatchBackgroundTask).toHaveBeenCalledWith(
        "background-task-1",
      ),
    );
  });

  it("任务完成后自动展示该批结果（不再调会超时的同步端点）", async () => {
    // 打开面板时任务还在跑（进度来自注册表）；面板自己的轮询随后发现任务完成，
    // 拉最终批次进结果视图。
    tasksHookMocks.useJobMatchBackgroundTasks.mockReturnValue([
      {
        id: "background-task-1",
        label: "岗位适配度分析（2 个岗位）",
        status: "running",
        requestedCount: 2,
        completedCount: 1,
        failedCount: 0,
        currentJobTitle: "产品助理",
        message: "正在分析",
        error: "",
        batchId: null,
      },
    ]);
    apiMocks.getJobMatchBatchTask.mockResolvedValue(
      makeTask({ status: "completed", batch_id: 7, completed_count: 2 }),
    );
    renderPanel();

    // 轮询立即发现任务已完成（mock 即时返回终态），面板直接落到结果视图。
    expect(await screen.findByText("已完成 2 个岗位，0 个岗位失败")).toBeInTheDocument();
    expect(apiMocks.getJobMatchBatch).toHaveBeenCalledWith(7);
    // 新版式：右侧是"匹配度参考分"标签，数字与单位在圆环内（.batch-score-number）
    expect(screen.getAllByText("匹配度参考分")).toHaveLength(2);
    const numbers = [...document.querySelectorAll(".batch-score-number")].map(
      (node) => node.textContent,
    );
    expect(numbers).toEqual(["88分", "61分"]);
  });

  it("历史记录的「查看结果」弹出独立结果卡片，不切换面板页签", async () => {
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
    renderPanel({ initialView: "history" });

    fireEvent.click(await screen.findByRole("button", { name: /查看\s*结\s*果|查看结果/ }));

    await waitFor(() => expect(apiMocks.getJobMatchBatch).toHaveBeenCalledWith(7));
    // 弹卡标题带批次号；结果在弹卡内渲染完成。
    expect(await screen.findByText("第 7 批分析结果")).toBeInTheDocument();
    await waitFor(() =>
      expect(document.querySelector(".batch-score-number")?.textContent).toBe("88分"),
    );
    // 弹卡有自己的关闭按钮；面板没有被切走（分析设置页签的入口还在）。
    expect(screen.getAllByRole("button", { name: /关\s*闭/ }).length).toBeGreaterThan(1);
  });
});
