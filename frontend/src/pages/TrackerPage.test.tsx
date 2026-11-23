// SPDX-License-Identifier: Apache-2.0
/**
 * 求职进度页：漏斗计数、记录卡片、以及导入预览里最要紧的两件事。
 *
 * 导入这一步的风险是"用户以为没保存"和"用户以为保存了但没保存"，所以两条都测：
 * 关闭预览不能写任何数据，确认时只提交勾选的条目。
 *
 * 2026-10-22（行数预算审计 A10）：导入预览与 ?job_id= 深链两个域已拆到
 * TrackerPage.import-modal.test.tsx，共享夹具在 src/test/trackerPageHarness.tsx；
 * 本文件守页面通用行为（列表/骨架/漏斗/筛选/分页/删除/错误态）与指标带配色（T9）。
 */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n";
import { TRACK_STATUS_LABEL_KEYS } from "../i18n/enum/tracker";
import { daysOverdue } from "../features/tracker/trackDates";
import {
  cleanupTrackerPage,
  makePage,
  makeStats,
  makeTrack,
  renderPage,
  resetTrackerApiMocks,
} from "../test/trackerPageHarness";

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

    // 13.2-E：状态改成「6px 圆点 + 文字」，行内不再有彩底 Tag。
    expect(document.querySelector(".track-card .track-status-dot")).not.toBeNull();
    expect(document.querySelector(".track-card .ant-tag")).toBeNull();

    // 13.2-F：元信息压缩成一行，日期只留「月-日」。
    expect(screen.getByText(t("trackerUi.card.appliedAt", { date: "09-18" }))).toBeInTheDocument();

    // 来源（系统字段）收进 ⋮ 菜单顶部，不再与业务日期同级展示。
    fireEvent.click(screen.getByRole("button", { name: "更多操作 示例科技" }));
    expect(
      await screen.findByRole("menuitem", { name: t("trackerUi.source.apply") }),
    ).toBeInTheDocument();
  });

  it("列表是容器 + 分隔线行：每 10 行一条细分隔，不重新加回卡片（13.2-D / 13.5）", async () => {
    const rows = Array.from({ length: 12 }, (_, index) =>
      makeTrack({ id: index + 1, company: `公司-${String(index + 1).padStart(2, "0")}` }),
    );
    apiMocks.listTracksPage.mockResolvedValue(makePage(rows, 12));
    apiMocks.listTrackStats.mockResolvedValue(makeStats(rows));
    renderPage();

    await screen.findByText("公司-01");
    const cards = document.querySelectorAll(".track-card");
    expect(cards).toHaveLength(12);
    // 只有第 11 行（index 10）是分组起点；首行不需要重复的粗分隔线。
    expect(document.querySelectorAll(".track-card.is-group-start")).toHaveLength(1);
    expect(cards[10].classList.contains("is-group-start")).toBe(true);
    expect(cards[0].classList.contains("is-group-start")).toBe(false);
  });

  it("marks a passed deadline as overdue", async () => {
    const tracks = [
      makeTrack({
        next_action: "确认面试时间",
        next_action_date: "2000-01-01",
      }),
      makeTrack({
        id: 99,
        next_action_date: "2999-01-01",
      }),
    ];
    apiMocks.listTracksPage.mockResolvedValue(makePage(tracks));
    apiMocks.listTrackStats.mockResolvedValue(makeStats(tracks));
    renderPage();

    expect(await screen.findByText(/确认面试时间/)).toBeInTheDocument();
    // 第 4 条：从句尾「· 已过期」改成红色短标记「逾期 N 天」。
    const days = daysOverdue("2000-01-01");
    expect(days).toBeGreaterThan(0);
    expect(screen.getByText(t("trackerUi.card.overdueDays", { days }))).toBeInTheDocument();
    // 只有逾期那一行带标记；非逾期行没有，旧的句尾长句也不再出现。
    expect(document.querySelectorAll(".track-card-overdue")).toHaveLength(1);
    expect(screen.queryByText(t("trackerUi.card.overdue"))).not.toBeInTheDocument();
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

  it("构成条按「进行中总数」切段：段宽用 flex 计数，图例百分比用最大余数法合计 100（12.2）", async () => {
    const tracks = [
      makeTrack({ id: 1, status: "applied" }),
      makeTrack({ id: 2, status: "applied", title: "岗位 2" }),
      makeTrack({ id: 3, status: "applied", title: "岗位 3" }),
      makeTrack({ id: 4, status: "screening", title: "岗位 4" }),
      makeTrack({ id: 5, status: "assessment", title: "岗位 5" }),
      makeTrack({ id: 6, status: "interview", title: "岗位 6" }),
      makeTrack({ id: 7, status: "interview", title: "岗位 7" }),
      makeTrack({ id: 8, status: "offer", title: "岗位 8" }),
    ];
    apiMocks.listTracksPage.mockResolvedValue(makePage(tracks));
    apiMocks.listTrackStats.mockResolvedValue(makeStats(tracks));
    renderPage();

    await waitFor(() => expect(document.querySelector(".tracker-funnel")).not.toBeNull());
    const stack = document.querySelector(".tracker-funnel-stack");
    expect(stack?.getAttribute("aria-hidden")).toBe("true");
    // 段宽是 flex 的原始计数（不是各自算的百分比）：数量 3/1/1/2/1。
    const segments = Array.from(document.querySelectorAll<HTMLElement>(".tracker-composition-seg"));
    expect(segments.map((node) => node.style.flexGrow)).toEqual(["3", "1", "1", "2", "1"]);
    expect(segments.every((node) => node.style.flexShrink === "0")).toBe(true);

    // 图例：阶段名 + 数量 + 占比；3/1/1/2/1 → 38/12/12/25/13，合计恰好 100。
    const percents = Array.from(
      document.querySelectorAll<HTMLElement>(".tracker-funnel-percent"),
    ).map((node) => Number((node.textContent ?? "").replace("%", "")));
    expect(percents).toEqual([38, 12, 12, 25, 13]);
    expect(percents.reduce((sum, value) => sum + value, 0)).toBe(100);

    // 旧形态（五条相对长度条 / 序号圆圈）不再存在。
    expect(document.querySelector(".tracker-funnel-bar")).toBeNull();
    expect(document.querySelector(".tracker-funnel-meter")).toBeNull();
    expect(document.querySelector(".tracker-funnel-index")).toBeNull();

    // 无障碍：可访问名来自**可见文本**（WCAG 2.5.3 Label in Name——带「条，占」的
    // 完整 aria-label 不含「面试225%」这个连续串，axe 会判 label-content-name-mismatch），
    // 完整口语版（「面试 2 条，占 25%」）放在 title 里当辅助说明。
    const interviewLabel = t(TRACK_STATUS_LABEL_KEYS.interview);
    const legend = document.querySelector<HTMLElement>(".tracker-funnel-legend");
    expect(legend).not.toBeNull();
    const interviewButton = within(legend as HTMLElement).getByRole("button", {
      name: new RegExp(interviewLabel, "u"),
    });
    expect(interviewButton).toHaveAttribute("aria-pressed", "false");
    expect(interviewButton).toHaveAttribute("title", expect.stringContaining("2 条"));
    expect(interviewButton).toHaveAttribute("title", expect.stringContaining("25%"));
  });

  it("数量为 0 的阶段不画段、图例灰显但仍可点（12.2 验收 2）", async () => {
    const tracks = [
      makeTrack({ id: 1, status: "applied" }),
      makeTrack({ id: 2, status: "interview", title: "算法实习生" }),
      makeTrack({ id: 3, status: "interview", title: "前端实习生" }),
    ];
    apiMocks.listTracksPage.mockResolvedValue(makePage(tracks));
    apiMocks.listTrackStats.mockResolvedValue(makeStats(tracks));
    renderPage();

    await waitFor(() => expect(document.querySelector(".tracker-funnel")).not.toBeNull());
    // 1/0/0/2/0：只画两段，不出现 0 宽度的色块残影。
    expect(document.querySelectorAll(".tracker-composition-seg")).toHaveLength(2);
    const steps = Array.from(document.querySelectorAll<HTMLElement>(".tracker-funnel-step"));
    expect(steps).toHaveLength(5);
    expect(steps.filter((node) => node.classList.contains("is-empty"))).toHaveLength(3);
    const percents = steps.map((node) =>
      Number((node.querySelector(".tracker-funnel-percent")?.textContent ?? "").replace("%", "")),
    );
    expect(percents).toEqual([33, 0, 0, 67, 0]);
    expect(percents.reduce((sum, value) => sum + value, 0)).toBe(100);
    // 灰显的空阶段仍可点（点了会按该阶段筛选，列表给空态）。
    expect(steps[1]).toHaveAttribute("aria-pressed", "false");
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
    // 软删不再二次确认：点「删除」即执行，回头路是 Toast 上的撤销（useDeleteUndo）。

    await waitFor(() => expect(apiMocks.deleteTrack).toHaveBeenCalledWith(1));
    // 撤销入口必须在：单条删除没有确认这一步了，这张卡片就是"刚删错了"的唯一出路。
    expect(await screen.findByText(t("toast.deleted.single"))).toBeInTheDocument();
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

/**
 * T9：统计卡的上色从 `:nth-child(2..5)` 换成**语义类名**。
 *
 * 位置选择器的故障很隐蔽：`statsError` 时网格里会多出一个错误文案节点，于是"总数"拿到
 * 灰色之外的配色、五张卡的颜色整体前移一格——看起来只是"颜色好像不太对"，没人会觉得
 * 那是 bug。类名与顺序解耦之后，加任何兄弟节点都不影响配色。
 */
describe("TrackerPage 指标带配色（T9）", () => {
  const STAT_KEYS = ["total", "active", "month", "offer", "closed"];

  it("5 项指标各带自己的语义类名", async () => {
    apiMocks.listTrackStats.mockResolvedValue(makeStats([makeTrack()]));
    renderPage();
    await screen.findByText("总数");

    for (const key of STAT_KEYS) {
      expect(
        document.querySelector(`.tracker-metric--${key}`),
        `缺少 .tracker-metric--${key}`,
      ).not.toBeNull();
    }
  });

  it("统计失败时：错误文案排在最前，5 项指标的类名一个不少（位置不再决定配色）", async () => {
    apiMocks.listTrackStats.mockRejectedValue(new Error("统计接口挂了"));
    renderPage();

    const summary = await waitFor(() => {
      const node = document.querySelector<HTMLElement>(".tracker-summary");
      if (!node?.textContent?.includes("统计加载失败")) throw new Error("还没渲染错误态");
      return node;
    });

    // 多出来的这个兄弟节点（错误文案）不该再"顶掉"任何一张卡的配色。
    const card = summary.querySelector(".tracker-summary-card");
    expect(card?.firstElementChild?.textContent).toContain("统计加载失败");
    for (const key of STAT_KEYS) {
      expect(summary.querySelector(`.tracker-metric--${key}`)).not.toBeNull();
    }
  });
});
