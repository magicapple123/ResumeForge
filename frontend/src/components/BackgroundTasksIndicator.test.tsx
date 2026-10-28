// SPDX-License-Identifier: Apache-2.0
/**
 * 页头「后台任务」面板：**唯一**的状态出口。
 *
 * 本轮起新接入的 AI 入口（单条岗位适配）也在这里出现——不再为新任务造第二种指示器。
 * 所以两条断言最要紧：通用 AI 任务的进度与取消入口能显示，且取消走的是它自己的端点。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiTaskSnapshot, ResumeGenerateTask } from "../types";
import BackgroundTasksIndicator from "./BackgroundTasksIndicator";
import { t } from "../i18n";
import { resetBackgroundTasks, watchAiTask, watchResumeTask } from "../utils/backgroundTasks";

const apiMocks = vi.hoisted(() => ({
  getResumeGenerateTask: vi.fn(),
  cancelResumeGenerateTask: vi.fn(),
}));

vi.mock("../api/resumes", () => ({
  getResumeGenerateTask: apiMocks.getResumeGenerateTask,
  cancelResumeGenerateTask: apiMocks.cancelResumeGenerateTask,
}));

const aiMocks = vi.hoisted(() => ({
  getAiTask: vi.fn(),
  cancelAiTask: vi.fn(),
  listActiveAiTasks: vi.fn(),
}));

vi.mock("../api/aiTasks", () => ({
  getAiTask: aiMocks.getAiTask,
  cancelAiTask: aiMocks.cancelAiTask,
  listActiveAiTasks: aiMocks.listActiveAiTasks,
}));

// 另外两套来源（批量匹配 / 岗位解读）与本轮无关，给空替身即可。
vi.mock("../hooks/useJobMatchBackgroundTasks", () => ({
  useJobMatchBackgroundTasks: () => [],
}));
vi.mock("../features/jobs/jobAnalysisStore", () => ({
  useRunningJobAnalyses: () => [],
  cancelJobAnalysis: vi.fn(),
}));

const RESUME_LABEL = "resume-generation-task";
const AI_LABEL = "job-match-task";
const RESUME_MESSAGE = "writing paragraph 2";
const AI_MESSAGE = "calling the model";

function resumeTask(overrides: Partial<ResumeGenerateTask> = {}): ResumeGenerateTask {
  return {
    id: 7,
    status: "running",
    resume_id: null,
    error: "",
    message: RESUME_MESSAGE,
    received_chars: 320,
    job_id: null,
    title: "",
    created_at: "2026-10-28T00:00:00",
    started_at: "2026-10-28T00:00:00",
    finished_at: null,
    ...overrides,
  };
}

function aiTask(overrides: Partial<AiTaskSnapshot> = {}): AiTaskSnapshot {
  return {
    id: 5,
    kind: "job_match",
    status: "running",
    progress: 45,
    label: AI_LABEL,
    message: AI_MESSAGE,
    result_ref: null,
    error: "",
    created_at: "2026-10-28T00:00:00",
    started_at: "2026-10-28T00:00:00",
    finished_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  resetBackgroundTasks();
  vi.clearAllMocks();
  apiMocks.getResumeGenerateTask.mockResolvedValue(resumeTask());
  aiMocks.getAiTask.mockResolvedValue(aiTask());
  aiMocks.listActiveAiTasks.mockResolvedValue([]);
});

afterEach(() => {
  resetBackgroundTasks();
  cleanup();
  document.body.innerHTML = "";
});

/** 打开页头那颗「后台任务」按钮弹出的面板。 */
async function openPanel() {
  fireEvent.click(await screen.findByRole("button", { name: t("backgroundTasks.aria.viewTasks") }));
  return screen.findByText(t("backgroundTasks.popover.title"));
}

/**
 * 面板当前可见文本。
 *
 * 用 textContent 而不是 `getByText("中文字面量")`：CJK 棘轮统计的就是
 * ByText 里的中文字面量，而这里验的是"进度拼装”这件事，用语言包取值更不会因改文案而红。
 */
function panelText(): string {
  return document.body.textContent ?? "";
}

describe("BackgroundTasksIndicator", () => {
  it("没有任务时整个入口不渲染", () => {
    const { container } = render(
      <AntdApp>
        <BackgroundTasksIndicator />
      </AntdApp>,
    );
    expect(container.querySelector(".background-tasks-button")).toBeNull();
  });

  it("显示通用 AI 任务：名称 + 可信百分比 + 取消入口", async () => {
    watchAiTask(aiTask(), AI_LABEL);

    render(
      <AntdApp>
        <BackgroundTasksIndicator />
      </AntdApp>,
    );
    await openPanel();

    expect(screen.getByText(AI_LABEL)).toBeInTheDocument();
    // 百分比与后端给的阶段文案拼在同一行。
    const text = panelText();
    expect(text).toContain(t("backgroundTasks.progress.percent", { percent: 45 }));
    expect(text).toContain(AI_MESSAGE);
    expect(
      screen.getByRole("button", { name: new RegExp(t("backgroundTasks.action.cancel")) }),
    ).toBeInTheDocument();
  });

  it("取消通用 AI 任务走它自己的端点（/ai-tasks/{id}/cancel）", async () => {
    aiMocks.cancelAiTask.mockResolvedValue(aiTask({ status: "canceled" }));
    watchAiTask(aiTask(), AI_LABEL);

    render(
      <AntdApp>
        <BackgroundTasksIndicator />
      </AntdApp>,
    );
    await openPanel();

    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(t("backgroundTasks.action.cancel")) }),
    );

    await waitFor(() => expect(aiMocks.cancelAiTask).toHaveBeenCalledWith(5));
    // 取消后条目从面板消失（终态不再显示在"正在进行的任务"里）。
    await waitFor(() => expect(screen.queryByText(AI_LABEL)).toBeNull());
  });

  it("简历生成任务显示已接收字数，取消走既有端点", async () => {
    apiMocks.cancelResumeGenerateTask.mockResolvedValue(resumeTask({ status: "cancelled" }));
    watchResumeTask(resumeTask(), RESUME_LABEL);

    render(
      <AntdApp>
        <BackgroundTasksIndicator />
      </AntdApp>,
    );
    await openPanel();

    expect(screen.getByText(RESUME_LABEL)).toBeInTheDocument();
    expect(panelText()).toContain(t("backgroundTasks.progress.received", { count: 320 }));

    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(t("backgroundTasks.action.cancel")) }),
    );
    await waitFor(() => expect(apiMocks.cancelResumeGenerateTask).toHaveBeenCalledWith(7));
  });

  it("状态未知时给「移除」而不是「取消」（再取消只会再吃 404）", async () => {
    const { ApiError } = await import("../api/client");
    apiMocks.getResumeGenerateTask.mockRejectedValue(new ApiError("task gone", 404));
    watchResumeTask(resumeTask(), RESUME_LABEL);

    render(
      <AntdApp>
        <BackgroundTasksIndicator />
      </AntdApp>,
    );
    await openPanel();

    await waitFor(() => expect(panelText()).toContain(t("backgroundTasks.status.unknownDetail")));
    // 「状态未知」不能再给取消（后端已经不认识这个任务，取消只会再吃一个 404）。
    expect(
      screen.queryByRole("button", { name: new RegExp(t("backgroundTasks.action.cancel")) }),
    ).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(t("backgroundTasks.action.remove")) }),
    );
    await waitFor(() => expect(screen.queryByText(RESUME_LABEL)).toBeNull());
  });
});
