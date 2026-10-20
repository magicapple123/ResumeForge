// SPDX-License-Identifier: Apache-2.0
/**
 * 求职进度页：漏斗计数、记录卡片、以及导入预览里最要紧的两件事。
 *
 * 导入这一步的风险是"用户以为没保存"和"用户以为保存了但没保存"，所以两条都测：
 * 关闭预览不能写任何数据，确认时只提交勾选的条目。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Track, TrackList } from "../types";
import type { Page } from "../types/common";
import TrackerPage from "./TrackerPage";

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

function makeTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 1,
    company: "示例科技",
    title: "后端开发实习生",
    status: "applied",
    stage_note: "",
    applied_at: "2026-09-18",
    status_date: "",
    next_action: "",
    next_action_date: "",
    note: "",
    evidence: "",
    source: "apply",
    job_id: null,
    resume_id: null,
    resume_title: "",
    channel: "unknown",
    created_at: "2026-09-18T00:00:00",
    updated_at: "2026-09-18T00:00:00",
    ...overrides,
  };
}

function makeList(items: Track[]): TrackList {
  const counts: Record<string, number> = {};
  for (const item of items) counts[item.status] = (counts[item.status] ?? 0) + 1;
  return {
    items,
    total: items.length,
    status_counts: counts,
    active_count: items.filter((item) => item.status !== "offer" && item.status !== "rejected")
      .length,
    offer_count: counts.offer ?? 0,
    rejected_count: counts.rejected ?? 0,
    month_count: items.filter((item) => item.applied_at.startsWith("2026-09")).length,
  };
}

/** P1-2：`GET /tracker/stats` 响应 = TrackList 去掉 items/total。 */
function makeStats(items: Track[]) {
  const { status_counts, active_count, offer_count, rejected_count, month_count } = makeList(items);
  return { status_counts, active_count, offer_count, rejected_count, month_count };
}

function makePage(items: Track[], total = items.length): Page<Track> {
  return { items, total };
}

function renderPage(initialEntries: string[] = ["/tracker"]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <AntdApp>
        <TrackerPage />
      </AntdApp>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  for (const mock of Object.values(apiMocks)) mock.mockReset();
  apiMocks.listTrackStats.mockResolvedValue(makeStats([]));
  apiMocks.listTracksPage.mockResolvedValue(makePage([]));
  jobApiMocks.listJobs.mockReset().mockRejectedValue(new Error("jobs unavailable"));
  jobApiMocks.getJob.mockReset().mockRejectedValue(new Error("job unavailable"));
});

afterEach(cleanup);

describe("TrackerPage", () => {
  it("统计加载中渲染骨架占位、不渲染 0 值卡片；完成后骨架消失（空数据才显示 0 值卡）", async () => {
    // 用未 resolve 的 Promise 托住统计请求：加载中不应出现「总数」等 0 值卡片，
    // 也不应出现旧的「统计加载中…」文字（用户截图里布局错乱的来源）。
    apiMocks.listTrackStats.mockReturnValueOnce(new Promise(() => {}));
    const { unmount } = renderPage();
    expect(screen.queryByText("统计加载中…")).not.toBeInTheDocument();
    expect(screen.queryByText("总数")).not.toBeInTheDocument();
    expect(document.querySelector(".tracker-summary-skeleton")).not.toBeNull();
    expect(document.querySelector(".tracker-summary")).toHaveAttribute("aria-busy", "true");
    unmount();
    renderPage();
    expect(await screen.findByText("总数")).toBeInTheDocument();
    expect(document.querySelector(".tracker-summary-skeleton")).toBeNull();
    expect(document.querySelector(".tracker-summary")).not.toHaveAttribute("aria-busy");
  });

  it("renders a record with its stage and source", async () => {
    apiMocks.listTracksPage.mockResolvedValue(
      makePage([makeTrack({ status: "interview", stage_note: "二面" })]),
    );
    apiMocks.listTrackStats.mockResolvedValue(
      makeStats([makeTrack({ status: "interview", stage_note: "二面" })]),
    );
    renderPage();

    expect(await screen.findByText("示例科技")).toBeInTheDocument();
    expect(screen.getByText("后端开发实习生")).toBeInTheDocument();
    // 漏斗里也有「面试」两个字，所以这里用 getAllByText 而不是断言唯一。
    expect(screen.getAllByText("面试").length).toBeGreaterThan(0);
    expect(screen.getByText("二面")).toBeInTheDocument();
    expect(screen.getByText("投递台自动记录")).toBeInTheDocument();
  });

  it("marks a passed deadline as overdue", async () => {
    const tracks = [
      makeTrack({
        next_action: "确认面试时间",
        next_action_date: "2000-01-01",
      }),
    ];
    apiMocks.listTracksPage.mockResolvedValue(makePage(tracks));
    apiMocks.listTrackStats.mockResolvedValue(makeStats(tracks));
    renderPage();

    expect(await screen.findByText(/确认面试时间/)).toBeInTheDocument();
    expect(screen.getByText(/已过期/)).toBeInTheDocument();
  });

  it("shows funnel counts drawn from the server summary", async () => {
    const tracks = [
      makeTrack({ id: 1, status: "applied" }),
      makeTrack({ id: 2, status: "interview", title: "算法实习生" }),
      makeTrack({ id: 3, status: "offer", title: "前端实习生" }),
    ];
    apiMocks.listTracksPage.mockResolvedValue(makePage(tracks));
    apiMocks.listTrackStats.mockResolvedValue(makeStats(tracks));
    renderPage();

    await screen.findAllByText("示例科技");
    // 漏斗每一级都要在，哪怕是 0——少一级会让用户以为这个阶段不存在。
    for (const label of ["已投递", "筛选中", "测评/笔试", "面试", "Offer"]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it("filters by status when a funnel step is clicked", async () => {
    apiMocks.listTracksPage.mockResolvedValue(makePage([makeTrack({ status: "interview" })]));
    apiMocks.listTrackStats.mockResolvedValue(makeStats([makeTrack({ status: "interview" })]));
    renderPage();
    await screen.findByText("示例科技");

    fireEvent.click(screen.getByRole("button", { name: /面试/ }));

    // 列表与统计都带着同一套筛选重新拉取。
    await waitFor(() => {
      expect(apiMocks.listTracksPage).toHaveBeenLastCalledWith(
        { status: "interview", keyword: "" },
        1,
        20,
      );
      expect(apiMocks.listTrackStats).toHaveBeenLastCalledWith({
        status: "interview",
        keyword: "",
      });
    });
  });

  it("翻页时用新页码重新拉取，取到旧截断之外的记录", async () => {
    // 第 1 页 20 条 + 第 2 页 1 条：旧列表端点 500 条内翻不到的语义由服务端页码保证。
    const pageOne = Array.from({ length: 20 }, (_, index) =>
      makeTrack({ id: index + 1, company: `公司-${String(index + 1).padStart(3, "0")}` }),
    );
    apiMocks.listTracksPage
      .mockResolvedValueOnce(makePage(pageOne, 21))
      .mockResolvedValueOnce(makePage([makeTrack({ id: 21, company: "深层历史公司" })], 21));
    apiMocks.listTrackStats.mockResolvedValue(makeStats(pageOne));
    renderPage();

    expect(await screen.findByText("公司-001")).toBeInTheDocument();
    expect(screen.queryByText("深层历史公司")).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByTitle("2")[0]);

    await waitFor(() => {
      expect(apiMocks.listTracksPage).toHaveBeenLastCalledWith({ status: "", keyword: "" }, 2, 20);
    });
    expect(await screen.findByText("深层历史公司")).toBeInTheDocument();
  });

  it("offers guidance when there is nothing yet", async () => {
    renderPage();
    expect(await screen.findByText(/还没有进度记录/)).toBeInTheDocument();
  });

  it("shows the error state rather than an empty list when loading fails", async () => {
    apiMocks.listTracksPage.mockRejectedValue(new Error("接口不可用"));
    renderPage();

    expect(await screen.findByText("接口不可用")).toBeInTheDocument();
    expect(screen.queryByText(/还没有进度记录/)).not.toBeInTheDocument();
  });

  it("deletes a record and reloads", async () => {
    apiMocks.listTracksPage.mockResolvedValue(makePage([makeTrack()]));
    apiMocks.listTrackStats.mockResolvedValue(makeStats([makeTrack()]));
    apiMocks.deleteTrack.mockResolvedValue(undefined);
    renderPage();
    await screen.findByText("示例科技");

    fireEvent.click(screen.getByRole("button", { name: "更多操作 示例科技" }));
    fireEvent.click(await screen.findByText("删除"));
    // 二次确认走 modal.confirm（测试环境默认英文，确认按钮是「OK」）。
    fireEvent.click(await screen.findByRole("button", { name: "OK" }));

    await waitFor(() => expect(apiMocks.deleteTrack).toHaveBeenCalledWith(1));
  });

  it("删除后列表与统计一起刷新，漏斗数字不滞留旧值（PR-13）", async () => {
    apiMocks.listTracksPage.mockResolvedValue(makePage([makeTrack()]));
    apiMocks.listTrackStats.mockResolvedValue(makeStats([makeTrack()]));
    apiMocks.deleteTrack.mockResolvedValue(undefined);
    renderPage();
    await screen.findByText("示例科技");
    const listCallsBefore = apiMocks.listTracksPage.mock.calls.length;
    const statsCallsBefore = apiMocks.listTrackStats.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "更多操作 示例科技" }));
    fireEvent.click(await screen.findByText("删除"));
    fireEvent.click(await screen.findByRole("button", { name: "OK" }));

    await waitFor(() => {
      // 一次 mutation 之后两边都要失效重拉：只刷列表的话漏斗停在删除前的数字。
      expect(apiMocks.listTracksPage.mock.calls.length).toBeGreaterThan(listCallsBefore);
      expect(apiMocks.listTrackStats.mock.calls.length).toBeGreaterThan(statsCallsBefore);
    });
  });

  it("深链 job_id：统计与导出与列表同口径（PR-13）", async () => {
    jobApiMocks.getJob.mockResolvedValue({ id: 7, title: "市场运营专员", company: "示例科技" });
    apiMocks.exportTracks.mockResolvedValue({ blob: new Blob(["x"]), filename: "a.csv" });
    // 有记录导出菜单才可用（totalCount > 0）。
    apiMocks.listTracksPage.mockResolvedValue(makePage([makeTrack({ job_id: 7 })]));
    renderPage(["/tracker?job_id=7"]);
    await screen.findByText(/只看该岗位的投递/);

    // 统计带 job_id：漏斗不再是"全部岗位"。
    await waitFor(() => {
      expect(apiMocks.listTrackStats).toHaveBeenCalledWith({
        status: "",
        keyword: "",
        jobId: 7,
      });
    });

    // 「导出」按钮带图标（可访问名可能含图标标注）；Dropdown 默认 hover 触发。
    const exportButton = screen.getByRole("button", { name: /导出/ });
    fireEvent.mouseEnter(exportButton);
    await waitFor(() => {
      expect(document.querySelector(".ant-dropdown:not(.ant-dropdown-hidden)")).not.toBeNull();
    });
    fireEvent.click(await screen.findByText("导出 CSV（可直接用 Excel 打开）"));
    await waitFor(() => {
      // 导出同样只带该岗位的进度。
      expect(apiMocks.exportTracks).toHaveBeenCalledWith("csv", {
        status: "",
        keyword: "",
        jobId: 7,
      });
    });
  });

  it("从 URL 恢复状态筛选与关键词", async () => {
    apiMocks.listTracksPage.mockResolvedValue(makePage([]));
    apiMocks.listTrackStats.mockResolvedValue(makeStats([]));
    renderPage(["/tracker?status=interview&keyword=%E7%A4%BA%E4%BE%8B"]);

    await waitFor(() => {
      expect(apiMocks.listTracksPage).toHaveBeenLastCalledWith(
        { status: "interview", keyword: "示例" },
        1,
        20,
      );
    });
    // 搜索框回填恢复出的关键词。
    const searchInput = screen.getByPlaceholderText(
      "搜索公司、岗位、备注或下一步",
    ) as HTMLInputElement;
    expect(searchInput.value).toBe("示例");
  });

  it("筛选条件变化时回第 1 页再拉取", async () => {
    // 首屏就是 21 条的空页（跨两页），翻页条才可见。
    apiMocks.listTracksPage.mockResolvedValue({ items: [], total: 21 });
    apiMocks.listTrackStats.mockResolvedValue(makeStats([]));
    renderPage();
    await screen.findByText(/还没有进度记录/);

    // 先翻到第 2 页，再换筛选：页码必须归位，否则会拿着第 2 页去请求新筛选。
    fireEvent.click(screen.getAllByTitle("2")[0]);
    await waitFor(() => {
      expect(apiMocks.listTracksPage).toHaveBeenLastCalledWith({ status: "", keyword: "" }, 2, 20);
    });

    fireEvent.click(screen.getByRole("button", { name: /已投递/ }));
    await waitFor(() => {
      expect(apiMocks.listTracksPage).toHaveBeenLastCalledWith(
        { status: "applied", keyword: "" },
        1,
        20,
      );
    });
  });
});

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

/**
 * T9：统计卡的上色从 `:nth-child(2..5)` 换成**语义类名**。
 *
 * 位置选择器的故障很隐蔽：`statsError` 时网格里会多出一个错误文案节点，于是"总数"拿到
 * 灰色之外的配色、五张卡的颜色整体前移一格——看起来只是"颜色好像不太对"，没人会觉得
 * 那是 bug。类名与顺序解耦之后，加任何兄弟节点都不影响配色。
 */
describe("TrackerPage 统计卡配色（T9）", () => {
  const STAT_KEYS = ["total", "active", "month", "offer", "closed"];

  it("5 张统计卡各带自己的语义类名", async () => {
    apiMocks.listTrackStats.mockResolvedValue(makeStats([makeTrack()]));
    renderPage();
    await screen.findByText("总数");

    for (const key of STAT_KEYS) {
      expect(
        document.querySelector(`.tracker-summary > .tracker-stat--${key}`),
        `缺少 .tracker-stat--${key}`,
      ).not.toBeNull();
    }
  });

  it("统计失败时：错误文案排在最前，5 张卡的类名一个不少（位置不再决定配色）", async () => {
    apiMocks.listTrackStats.mockRejectedValue(new Error("统计接口挂了"));
    renderPage();

    const summary = await waitFor(() => {
      const node = document.querySelector<HTMLElement>(".tracker-summary");
      if (!node?.textContent?.includes("统计加载失败")) throw new Error("还没渲染错误态");
      return node;
    });

    // 多出来的这个兄弟节点（错误文案）不该再"顶掉"任何一张卡的配色。
    expect(summary.firstElementChild?.textContent).toContain("统计加载失败");
    for (const key of STAT_KEYS) {
      expect(summary.querySelector(`.tracker-stat--${key}`)).not.toBeNull();
    }
  });
});
