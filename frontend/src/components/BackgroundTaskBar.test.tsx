/**
 * 顶部常驻任务条（T1）：三源聚合、无任务不渲染、查看与取消。
 *
 * 三个来源里只驱动岗位解读（真实 store + mock 掉的 api），简历生成 / 批量匹配的 hook
 * 直接打桩返回空数组——这里要验的是"任务条怎么摆这三类任务"，不是它们各自的轮询。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { App as AntdApp } from "antd";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobAnalysisResult } from "../types";
import { resetJobAnalysisStoreForTests, startJobAnalysis } from "../features/jobs/jobAnalysisStore";
import BackgroundTaskBar from "./BackgroundTaskBar";

const sourceMocks = vi.hoisted(() => ({
  resumeTasks: [] as unknown[],
  matchTasks: [] as unknown[],
  generateJobAnalysis: vi.fn(),
}));

vi.mock("../hooks/useBackgroundTasks", () => ({
  useBackgroundTasks: () => sourceMocks.resumeTasks,
}));
vi.mock("../hooks/useJobMatchBackgroundTasks", () => ({
  useJobMatchBackgroundTasks: () => sourceMocks.matchTasks,
}));
vi.mock("../api/jobs", () => ({ generateJobAnalysis: sourceMocks.generateJobAnalysis }));

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

/** 让 store 里一个"永不结束"的解读任务跑起来（任务条的典型输入）。 */
function startRunningAnalysis() {
  sourceMocks.generateJobAnalysis.mockReturnValueOnce(
    new Promise<JobAnalysisResult>(() => undefined),
  );
  startJobAnalysis({ jobId: 12, title: "算法工程师", company: "字节跳动" });
}

beforeEach(() => {
  resetJobAnalysisStoreForTests();
  sourceMocks.resumeTasks = [];
  sourceMocks.matchTasks = [];
  sourceMocks.generateJobAnalysis.mockReset();
});

afterEach(() => {
  cleanup();
  resetJobAnalysisStoreForTests();
});

describe("BackgroundTaskBar", () => {
  it("没有任务时完全不渲染（不留一条空横条占位）", () => {
    const { container } = renderBar();

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    // 连外框都不该有——空横条会白占一条视口高度，看起来像加载失败。
    expect(container.querySelector(".background-task-bar")).toBeNull();
  });

  it("有岗位解读任务时出 chip：名称 + 计时 + 查看 + 取消", async () => {
    startRunningAnalysis();
    renderBar();

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText("岗位解读 · 字节跳动 · 算法工程师")).toBeInTheDocument();
    expect(screen.getByText(/已运行 \d+ 秒/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "取消岗位解读 · 字节跳动 · 算法工程师" }),
    ).toBeInTheDocument();
  });

  it("「查看」跳到对应岗位并带上打开解读的参数", () => {
    startRunningAnalysis();
    renderBar();

    fireEvent.click(screen.getByRole("button", { name: "查看" }));

    expect(screen.getByTestId("location")).toHaveTextContent("/jobs?job_id=12&analysis=1");
  });

  it("「取消」立刻停掉本次生成，chip 随之消失", async () => {
    startRunningAnalysis();
    renderBar();

    fireEvent.click(screen.getByRole("button", { name: "取消岗位解读 · 字节跳动 · 算法工程师" }));

    // store 里状态回 idle → 订阅者重渲染 → 任务条没有任务了，整个消失。
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
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
