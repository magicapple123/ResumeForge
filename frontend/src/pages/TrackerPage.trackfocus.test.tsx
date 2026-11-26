// SPDX-License-Identifier: Apache-2.0
/**
 * 求职进度页的 `?track=N` 深链（整改 #18）：「更新进度」写完之后要有去处。
 *
 * 链路是「投递记录 → 求职进度的那一条」：记录行点「查看进度」跳到
 * `/tracker?track=N`，这一页负责把用户**指到那一行**上：
 *
 * 1. 先 `GET /tracker/{N}` 拿到 `job_id` 并收窄筛选（同一岗位可能有多条进度，
 *    不收窄的话那一行可能根本不在当前页/当前筛选里）；
 * 2. 等列表真的加载出这一行，才 `scrollIntoView` + 打高亮，2 秒后自动摘掉
 *    （**临时底色，不是常驻左色条**）；
 * 3. 404（记录已删 / id 不存在）是正常分支：提示一句、去掉 `track` 参数，
 *    **保留用户原来的视图**——不空高亮、不清空筛选、不抛未捕获错误。
 *
 * 为什么不用 `?job_id=` 顶替：`/tracker?job_id=N` 是"按岗位筛选"，指不到具体那一条。
 */
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n";
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

const jobApiMocks = vi.hoisted(() => ({ listJobs: vi.fn(), getJob: vi.fn() }));
vi.mock("../api/jobs", () => jobApiMocks);

const COMPANY = "Acme Labs";
const JOB = "Backend intern";
const TRACK_ID = 142;
const JOB_ID = 77;

/** 读当前 URL：深链清理必须看真实地址（`useLocation` 只能在 Router 里用）。 */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function currentUrl(): string {
  return screen.getByTestId("location").textContent ?? "";
}

/** 目标行（TrackCard 的 article 带 `data-track-id`，深链按它找人）。 */
function trackNode(id: number): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-track-id="${id}"]`);
}

const TRACK = makeTrack({
  id: TRACK_ID,
  company: COMPANY,
  title: JOB,
  job_id: JOB_ID,
  status: "applied",
});

beforeEach(() => {
  resetTrackerApiMocks(apiMocks, jobApiMocks);
  apiMocks.listTracksPage.mockResolvedValue(makePage([TRACK]));
  apiMocks.listTrackStats.mockResolvedValue(makeStats([TRACK]));
  apiMocks.getTrack.mockResolvedValue(TRACK);
  // jsdom 没有 scrollIntoView：补一个探针，用来断言"真的滚过去了"。
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(cleanupTrackerPage);

describe("TrackerPage 的 ?track= 深链（#18）", () => {
  it("定位到那一行并高亮，2 秒后自动摘掉", async () => {
    renderPage([`/tracker?track=${TRACK_ID}`], <LocationProbe />);

    await screen.findByText(COMPANY);
    // 拿到 job_id 就收窄筛选：不收窄的话这一行可能不在当前页里。
    await waitFor(() =>
      expect(apiMocks.listTracksPage).toHaveBeenCalledWith(
        expect.objectContaining({ jobId: JOB_ID }),
        1,
        20,
      ),
    );

    await waitFor(() => expect(trackNode(TRACK_ID)?.className).toContain("is-highlighted"));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    // 高亮只是临时底色：不留常驻左色条（第 13 条已按用户意见砍掉）。
    expect(currentUrl()).toContain(`job_id=${JOB_ID}`);

    // 2 秒后自动摘掉（真实计时器 + 3 秒超时：假时钟会跟 RTL 的 waitFor 打架）。
    await waitFor(
      () => expect(trackNode(TRACK_ID)?.className ?? "").not.toContain("is-highlighted"),
      { timeout: 3000 },
    );
  });

  it("记录已删（404）：提示一句、去掉 track 参数，用户原视图保留", async () => {
    apiMocks.getTrack.mockRejectedValue(new Error("404 not found"));
    // 已删的那条不在列表里（后端也不会返回它）。
    apiMocks.listTracksPage.mockResolvedValue(makePage([makeTrack({ id: 9, company: COMPANY })]));

    renderPage([`/tracker?track=${TRACK_ID}`], <LocationProbe />);

    expect(await screen.findByText(t("trackerPage.trackFocus.missing"))).toBeInTheDocument();
    // 不崩、不空高亮：列表照常可用。
    expect(await screen.findByText(COMPANY)).toBeInTheDocument();
    expect(document.querySelector(".track-card.is-highlighted")).toBeNull();
    // 参数被 clean 掉，避免用户刷新又踩一次同一个 404。
    await waitFor(() => expect(currentUrl()).not.toContain("track="));
  });

  it("参数非数字/0 时当作没有深链：不请求单条，也不高亮任何行", async () => {
    renderPage(["/tracker?track=0"], <LocationProbe />);

    await screen.findByText(COMPANY);
    expect(apiMocks.getTrack).not.toHaveBeenCalled();
    expect(document.querySelector(".track-card.is-highlighted")).toBeNull();
    // 非法值不静默删参数（可能是别人拼错的链接），页面照常可用。
    expect(currentUrl()).toContain("track=0");
  });

  it("筛选标签仍可清除：清掉 job_id 后回到全量列表", async () => {
    renderPage([`/tracker?track=${TRACK_ID}`], <LocationProbe />);

    await screen.findByText(COMPANY);
    await waitFor(() => expect(currentUrl()).toContain(`job_id=${JOB_ID}`));

    fireEvent.click(screen.getByRole("button", { name: t("trackerPage.action.clearJobFilter") }));

    await waitFor(() => expect(currentUrl()).not.toContain("job_id="));
  });
});
