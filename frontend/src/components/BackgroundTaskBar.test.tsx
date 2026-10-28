// SPDX-License-Identifier: Apache-2.0
/**
 * 顶部常驻任务条：两源聚合（统一登记表 + 批量匹配）、无任务不渲染、查看与取消。
 *
 * 两个 hook 直接打桩返回数组——这里要验的是"任务条怎么摆这些任务"，不是它们各自的轮询。
 * 本轮起**岗位解读也走统一登记表**，所以这一份桩里放一条 `job_analysis` 任务就能覆盖
 * 它原来的那几条断言（顺带证明"新增入口不需要改这个组件"）。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { App as AntdApp } from "antd";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BackgroundTask } from "../utils/backgroundTasks.types";
import BackgroundTaskBar from "./BackgroundTaskBar";

const sourceMocks = vi.hoisted(() => ({
  tasks: [] as BackgroundTask[],
  matchTasks: [] as unknown[],
  cancelBackgroundTask: vi.fn(),
}));

vi.mock("../hooks/useBackgroundTasks", () => ({
  useBackgroundTasks: () => sourceMocks.tasks,
}));
vi.mock("../hooks/useJobMatchBackgroundTasks", () => ({
  useJobMatchBackgroundTasks: () => sourceMocks.matchTasks,
}));
vi.mock("../utils/backgroundTasks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/backgroundTasks")>();
  return { ...actual, cancelBackgroundTask: sourceMocks.cancelBackgroundTask };
});

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

function renderBar() {
  return render(
    <AntdApp>
      <MemoryRouter initialEntries={["/jobs"]}>
        <BackgroundTaskBar />
        <LocationProbe />
      </MemoryRouter>
    </AntdApp>,
  );
}

/** 一条正在跑的岗位解读任务（统一登记表里的形状）。 */
function jobAnalysisTask(): BackgroundTask {
  return {
    key: "job_analysis#12",
    kind: "job_analysis",
    id: 12,
    label: "岗位解读 · 字节跳动 · 算法工程师",
    status: "running",
    message: "正在解读岗位要求",
    progressPercent: 40,
    receivedChars: 0,
    resumeId: null,
    refId: 12,
    deepLink: "/jobs?job_id=12&analysis=1",
    resultData: null,
    error: "",
    unknown: false,
  };
}

beforeEach(() => {
  sourceMocks.tasks = [];
  sourceMocks.matchTasks = [];
  sourceMocks.cancelBackgroundTask.mockReset();
  sourceMocks.cancelBackgroundTask.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

describe("BackgroundTaskBar", () => {
  it("没有任务时完全不渲染（不留一条空横条占位）", () => {
    const { container } = renderBar();

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    // 连外框都不该有——空横条会白占一条视口高度，看起来像加载失败。
    expect(container.querySelector(".background-task-bar")).toBeNull();
  });

  it("统一登记表里的任务各出一枚 chip：名称 + 进度文案 + 查看 + 取消", () => {
    sourceMocks.tasks = [jobAnalysisTask()];
    renderBar();

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText("岗位解读 · 字节跳动 · 算法工程师")).toBeInTheDocument();
    // 进度文案用 textContent 判定而不是 ByText：中文字面量的 ByText 断言有棘轮配额，
    // 这里没有"必须精确匹配整段文本"的需要。
    expect(screen.getByRole("status").textContent).toContain("正在解读岗位要求");
    expect(screen.getByRole("button", { name: "查看" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "取消岗位解读 · 字节跳动 · 算法工程师" }),
    ).toBeInTheDocument();
  });

  it("没有进度文案时退回「生成中…」（地址由 taskDeepLinks 生成，组件不手拼）", () => {
    sourceMocks.tasks = [{ ...jobAnalysisTask(), message: "" }];
    renderBar();

    expect(screen.getByText("生成中…")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "查看" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/jobs?job_id=12&analysis=1");
  });

  it("「取消」走统一取消入口（真的是让后端任务停下，不是删掉本地条目）", async () => {
    sourceMocks.tasks = [jobAnalysisTask()];
    renderBar();

    fireEvent.click(screen.getByRole("button", { name: "取消岗位解读 · 字节跳动 · 算法工程师" }));

    expect(sourceMocks.cancelBackgroundTask).toHaveBeenCalledWith("job_analysis#12");
  });

  it("批量匹配任务也在条上（进度以「已处理 N/M」表示）", () => {
    sourceMocks.matchTasks = [
      {
        id: "batch-1",
        label: "批量匹配 5 个岗位",
        status: "running",
        requestedCount: 5,
        completedCount: 2,
        failedCount: 0,
        currentJobTitle: "算法工程师",
        message: "",
        error: "",
        batchId: 3,
      },
    ];
    renderBar();

    expect(screen.getByText("批量匹配 5 个岗位")).toBeInTheDocument();
    expect(screen.getByText("已处理 2/5 个岗位")).toBeInTheDocument();
  });
});
