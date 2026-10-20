// SPDX-License-Identifier: Apache-2.0
/** 面经知识库面板：列表渲染、真实问题清单展示、错误透出、批量删除。 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { App as AntApp } from "antd";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import InterviewExperiencePanel from "./InterviewExperiencePanel";

const apiMocks = vi.hoisted(() => ({
  listInterviewExperiences: vi.fn(),
  createInterviewExperience: vi.fn(),
  updateInterviewExperience: vi.fn(),
  deleteInterviewExperience: vi.fn(),
  batchDeleteInterviewExperiences: vi.fn(),
}));

vi.mock("../api/interviewExperiences", () => apiMocks);

const ITEMS = [
  {
    id: 1,
    title: "某司一面",
    company: "示例公司",
    position: "后端开发",
    job_id: null,
    content: "先问八股再深挖项目",
    questions: ["说一个你主导的项目", "这个指标怎么算的"],
    tags: ["后端", "一面"],
    source: "self",
    difficulty: "中等",
    round_type: "一面",
    interview_date: "2026-09-20",
    created_at: "2026-09-20T10:00:00",
    updated_at: "2026-09-20T10:00:00",
  },
];

beforeEach(() => {
  apiMocks.listInterviewExperiences.mockReset();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("InterviewExperiencePanel", () => {
  it("渲染面经列表与真实问题清单", async () => {
    apiMocks.listInterviewExperiences.mockResolvedValue(ITEMS);
    render(
      <AntApp>
        {/* 关联岗位下拉已改为内部远程搜索（P0-1），不再从页面传选项。 */}
        <InterviewExperiencePanel />
      </AntApp>,
    );

    expect(await screen.findByText("某司一面")).toBeInTheDocument();
    expect(screen.getByText(/示例公司/)).toBeInTheDocument();
    expect(screen.getByText(/真实问题 2 个/)).toBeInTheDocument();
    expect(screen.getByText(/说一个你主导的项目/)).toBeInTheDocument();
    expect(apiMocks.listInterviewExperiences).toHaveBeenCalled();
  });

  it("读取失败时透出中文错误", async () => {
    apiMocks.listInterviewExperiences.mockRejectedValue(new Error("读取面经失败"));
    render(
      <AntApp>
        {/* 关联岗位下拉已改为内部远程搜索（P0-1），不再从页面传选项。 */}
        <InterviewExperiencePanel />
      </AntApp>,
    );

    expect(await screen.findByText("读取面经失败")).toBeInTheDocument();
  });

  it("点「详情」打开详情抽屉，看得到正文与完整问题清单", async () => {
    apiMocks.listInterviewExperiences.mockResolvedValue(ITEMS);
    render(
      <AntApp>
        {/* 关联岗位下拉已改为内部远程搜索（P0-1），不再从页面传选项。 */}
        <InterviewExperiencePanel />
      </AntApp>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "详情" }));

    // 列表里只显示前 3 条问题摘要，抽屉里要给完整清单与正文。
    expect(await screen.findByText("正文")).toBeInTheDocument();
    expect(screen.getByText("真实问题（2）")).toBeInTheDocument();
    expect(screen.getByText("先问八股再深挖项目")).toBeInTheDocument();
  });

  it("批量选择：右键进多选 → 勾 2 条 → 删除所选（确认文案带数量）→ 一次批量删除请求带全部 id 并重拉", async () => {
    const two = [ITEMS[0], { ...ITEMS[0], id: 2, title: "某司二面" }];
    apiMocks.listInterviewExperiences.mockResolvedValue(two);
    apiMocks.batchDeleteInterviewExperiences.mockResolvedValue({ deleted: 2 });
    render(
      <AntApp>
        <InterviewExperiencePanel />
      </AntApp>,
    );

    await screen.findByText("某司一面");
    fireEvent.contextMenu(screen.getByText("某司一面"));
    fireEvent.click(await screen.findByRole("menuitem", { name: /批量选择/ }));

    fireEvent.click(screen.getByRole("checkbox", { name: "选择面经 某司一面" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "选择面经 某司二面" }));
    expect(screen.getByText("已选 2 项")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "删除所选" }));
    // Popconfirm 确认（文案带数量）；确认前绝不发请求。
    const popover = await waitFor(() => {
      const root = document.querySelector(".ant-popover");
      expect(root).not.toBeNull();
      return root as HTMLElement;
    });
    expect(popover.textContent).toContain("删除选中的 2 条面经");
    expect(apiMocks.batchDeleteInterviewExperiences).not.toHaveBeenCalled();
    fireEvent.click(within(popover).getByRole("button", { name: /删\s*除/ }));

    await waitFor(() => {
      expect(apiMocks.batchDeleteInterviewExperiences).toHaveBeenCalledTimes(1);
    });
    expect(apiMocks.batchDeleteInterviewExperiences).toHaveBeenCalledWith([1, 2]);
    // 成功后清空选择并重拉列表。
    expect(await screen.findByText(/已删除 2 条面经/)).toBeInTheDocument();
    expect(screen.queryByText(/已选/)).not.toBeInTheDocument();
    await waitFor(() => {
      expect(apiMocks.listInterviewExperiences.mock.calls.length).toBeGreaterThan(1);
    });
  });
});
