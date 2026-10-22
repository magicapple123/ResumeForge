// SPDX-License-Identifier: Apache-2.0
/**
 * 求职进度页的「导入预览」与「?job_id= 深链」两个域。
 *
 * 2026-10-22（行数预算审计 A10）：按 TrackerPage.test.tsx 既有豁免的触发条件从该文件
 * 拆出——本文件守「导入时不写脏数据」与「深链过滤口径」；页面通用行为与统计卡配色
 * 仍在 TrackerPage.test.tsx，共享夹具在 src/test/trackerPageHarness.tsx。
 *
 * 这两个域放同一个文件，是因为它们共用同一份 jobApiMocks（listJobs/getJob）：
 * 深链要看岗位名，导入面板的提醒下拉也拉岗位。
 */
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupTrackerPage, renderPage, resetTrackerApiMocks } from "../test/trackerPageHarness";

const apiMocks = vi.hoisted(() => ({
  listTracks: vi.fn(),
  listTrackStats: vi.fn(),
  listTracksPage: vi.fn(),
  getTrack: vi.fn(),
  createTrack: vi.fn(),
  updateTrack: vi.fn(),
  deleteTrack: vi.fn(),
  parseTracks: vi.fn(),
  applyTracks: vi.fn(),
  exportTracks: vi.fn(),
}));

vi.mock("../api/tracker", () => apiMocks);
vi.mock("../utils/download", () => ({ downloadBlob: vi.fn(), printHtml: vi.fn() }));

// TrackerPage 还会拉岗位/简历做提醒面板下拉、深链标签岗位名；默认让它们失败走静默
// catch（与真实环境"接口不可达"同路径），深链用例再按需给 getJob 返回值。
const jobApiMocks = vi.hoisted(() => ({ listJobs: vi.fn(), getJob: vi.fn() }));

vi.mock("../api/jobs", () => jobApiMocks);

beforeEach(() => {
  resetTrackerApiMocks(apiMocks, jobApiMocks);
});

afterEach(cleanupTrackerPage);

describe("TrackImportModal", () => {
  async function openImport() {
    renderPage();
    await screen.findByText(/还没有进度记录/);
    fireEvent.click(screen.getByRole("button", { name: /从通知导入/ }));
    fireEvent.change(screen.getByPlaceholderText(/按 Ctrl\+V 可以直接贴截图/), {
      target: { value: "【示例科技有限公司】您投递的「后端开发实习生」岗位已进入面试环节。" },
    });
    fireEvent.click(screen.getByRole("button", { name: /识别并预览/ }));
  }

  it("shows what will happen and why before writing anything", async () => {
    apiMocks.parseTracks.mockResolvedValue({
      items: [
        {
          record: {
            company: "示例科技",
            title: "后端开发实习生",
            status: "interview",
            stage_note: "",
            applied_at: "",
            status_date: "",
            next_action: "",
            next_action_date: "",
            note: "",
            evidence: "已进入面试环节",
          },
          action: "updated",
          reason: "「已投递」推进为「面试」",
          current_status: "applied",
        },
      ],
      parse_engine: "ai",
      notes: ["邮件里没有写投递日期"],
    });

    await openImport();

    expect(await screen.findByText("更新进度")).toBeInTheDocument();
    // 原因比结论重要：用户据此判断这条该不该勾。
    expect(screen.getByText("「已投递」推进为「面试」")).toBeInTheDocument();
    expect(screen.getByText("依据：已进入面试环节")).toBeInTheDocument();
    expect(screen.getByText(/邮件里没有写投递日期/)).toBeInTheDocument();
    // 预览阶段绝不能写数据。
    expect(apiMocks.applyTracks).not.toHaveBeenCalled();
  });

  it("submits only the checked records", async () => {
    const record = {
      company: "示例科技",
      title: "后端开发实习生",
      status: "interview" as const,
      stage_note: "",
      applied_at: "",
      status_date: "",
      next_action: "",
      next_action_date: "",
      note: "",
      evidence: "",
    };
    apiMocks.parseTracks.mockResolvedValue({
      items: [
        {
          record,
          action: "created",
          reason: "新增「示例科技 · 后端开发实习生」",
          current_status: "",
        },
        {
          record: { ...record, title: "算法实习生" },
          action: "unchanged",
          reason: "状态本来就是「面试」，没有新变化",
          current_status: "interview",
        },
      ],
      parse_engine: "local",
      notes: [],
    });
    apiMocks.applyTracks.mockResolvedValue({
      items: [],
      created: 1,
      updated: 0,
      unchanged: 0,
    });

    await openImport();
    await screen.findByText("新增记录");

    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[1]); // 取消第二条
    fireEvent.click(screen.getByRole("button", { name: /确认写入勾选的 1 条/ }));

    await waitFor(() => expect(apiMocks.applyTracks).toHaveBeenCalledTimes(1));
    const [submitted] = apiMocks.applyTracks.mock.calls[0];
    expect(submitted).toHaveLength(1);
    expect(submitted[0].title).toBe("后端开发实习生");
  });

  it("reports created and updated separately instead of a flat success", async () => {
    const record = {
      company: "示例科技",
      title: "后端开发实习生",
      status: "interview" as const,
      stage_note: "",
      applied_at: "",
      status_date: "",
      next_action: "",
      next_action_date: "",
      note: "",
      evidence: "",
    };
    apiMocks.parseTracks.mockResolvedValue({
      items: [{ record, action: "created", reason: "新增", current_status: "" }],
      parse_engine: "local",
      notes: [],
    });
    apiMocks.applyTracks.mockResolvedValue({ items: [], created: 1, updated: 2, unchanged: 0 });

    await openImport();
    await screen.findByText("新增记录");
    fireEvent.click(screen.getByRole("button", { name: /确认写入/ }));

    // 全都说成"已保存"会让用户以为每条进度都更新了。
    expect(await screen.findByText(/新增 1 条，更新 2 条/)).toBeInTheDocument();
  });
});

describe("TrackerPage ?job_id= 深链（RF-11）", () => {
  it("带 job_id 进入：按其过滤并显示带岗位名的筛选标签", async () => {
    jobApiMocks.getJob.mockResolvedValue({ id: 7, title: "市场运营专员", company: "示例科技" });
    renderPage(["/tracker?job_id=7"]);

    // 过滤参数透传给分页端点。
    await waitFor(() =>
      expect(apiMocks.listTracksPage).toHaveBeenCalledWith(
        expect.objectContaining({ jobId: 7 }),
        1,
        20,
      ),
    );
    expect(await screen.findByText(/只看该岗位的投递/)).toBeInTheDocument();
    expect(screen.getByText(/市场运营专员 · 示例科技/)).toBeInTheDocument();
  });

  it("清除按钮：移除 job_id 参数并重拉（不再带过滤）", async () => {
    jobApiMocks.getJob.mockResolvedValue({ id: 7, title: "市场运营专员", company: "示例科技" });
    renderPage(["/tracker?job_id=7"]);
    await screen.findByText(/只看该岗位的投递/);

    fireEvent.click(screen.getByRole("button", { name: "清除岗位筛选" }));

    await waitFor(() =>
      expect(apiMocks.listTracksPage).toHaveBeenLastCalledWith(
        expect.objectContaining({ jobId: undefined }),
        1,
        20,
      ),
    );
    expect(screen.queryByText(/只看该岗位的投递/)).toBeNull();
  });

  it("岗位已删除：标签仍显示但写明实话，仍可清除", async () => {
    jobApiMocks.getJob.mockRejectedValue(new Error("404"));
    renderPage(["/tracker?job_id=7"]);

    expect(await screen.findByText(/该岗位可能已删除/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "清除岗位筛选" }));
    await waitFor(() => expect(screen.queryByText(/只看该岗位的投递/)).toBeNull());
  });

  it("非法 job_id（非数字/≤0）一律忽略：不过滤、不出标签", async () => {
    renderPage(["/tracker?job_id=abc"]);
    await waitFor(() =>
      expect(apiMocks.listTracksPage).toHaveBeenCalledWith(
        expect.objectContaining({ jobId: undefined }),
        1,
        20,
      ),
    );
    expect(screen.queryByText(/只看该岗位的投递/)).toBeNull();

    cleanup();
    renderPage(["/tracker?job_id=-3"]);
    await waitFor(() =>
      expect(apiMocks.listTracksPage).toHaveBeenLastCalledWith(
        expect.objectContaining({ jobId: undefined }),
        1,
        20,
      ),
    );
    expect(screen.queryByText(/只看该岗位的投递/)).toBeNull();
  });
});
