// SPDX-License-Identifier: Apache-2.0
/**
 * 求职进度页的「状态就地改」（整改 #15）。
 *
 * 需求原话：「希望能有一个地方可以方便地更新进度，当前每次都要点到编辑里去才能更新」。
 * 改动前状态是只读 span，改它要走 ⋮ → 编辑 → 找「状态」字段 → 保存（四步）。
 *
 * 这一层守的是**页面接线**（单行的菜单结构由 TrackCard.test.tsx 守）：
 * 1. 点某一格 → 只发一次 `PATCH /tracker/{id}/status`，参数是 `(id, 目标状态)`；
 * 2. 成功后 toast 说明改成了什么，并给一个「撤销」；
 * 3. 列表与顶部构成条**一起**重拉（只刷列表会让漏斗数字停在旧值）；
 * 4. 撤销 = 再 PATCH 一次改回去（不是删事件）；
 * 5. 提交未完成时连点不会写第二条事件。
 */
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n";
import { TRACK_STATUS_LABEL_KEYS } from "../i18n/enum/tracker";
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
  patchTrackStatus: vi.fn(),
}));

vi.mock("../api/tracker", () => apiMocks);
vi.mock("../utils/download", () => ({ downloadBlob: vi.fn(), printHtml: vi.fn() }));

const jobApiMocks = vi.hoisted(() => ({ listJobs: vi.fn(), getJob: vi.fn() }));
vi.mock("../api/jobs", () => jobApiMocks);

const COMPANY = "Acme Labs";
const JOB = "Backend intern";

/** 胶囊的无障碍名：`更改 {name} 的进度状态`（名字里带公司名，多行时不串）。 */
function statusTriggerName(): string {
  return t("trackerUi.card.aria.statusMenu", { name: COMPANY });
}

/** 打开这一行的状态菜单。 */
async function openStatusMenu() {
  const trigger = await screen.findByRole("button", { name: statusTriggerName() });
  fireEvent.click(trigger);
  return trigger;
}

/** 菜单里文案等于某个状态的那一项。 */
async function statusMenuItem(status: keyof typeof TRACK_STATUS_LABEL_KEYS) {
  const label = t(TRACK_STATUS_LABEL_KEYS[status]);
  const items = await screen.findAllByRole("menuitem");
  const found = items.find((node) => node.textContent === label);
  if (!found) throw new Error(`菜单里没有「${label}」这一项`);
  return found;
}

beforeEach(() => {
  resetTrackerApiMocks(apiMocks, jobApiMocks);
  const track = makeTrack({ id: 5, company: COMPANY, title: JOB, status: "applied" });
  apiMocks.listTracksPage.mockResolvedValue(makePage([track]));
  apiMocks.listTrackStats.mockResolvedValue(makeStats([track]));
  apiMocks.patchTrackStatus.mockResolvedValue({ ...track, status: "interview" });
});

afterEach(cleanupTrackerPage);

describe("TrackerPage 的状态就地改（#15）", () => {
  it("点某一格：只发一次 PATCH，toast 报出新状态，列表与统计一起重拉", async () => {
    renderPage();
    await screen.findByText(COMPANY);
    const listCalls = apiMocks.listTracksPage.mock.calls.length;
    const statsCalls = apiMocks.listTrackStats.mock.calls.length;

    await openStatusMenu();
    fireEvent.click(await statusMenuItem("interview"));

    await waitFor(() => expect(apiMocks.patchTrackStatus).toHaveBeenCalledTimes(1));
    expect(apiMocks.patchTrackStatus).toHaveBeenCalledWith(5, "interview");
    // toast 里说清改成了哪一格（不是"保存成功"这种没有信息量的话）。
    expect(
      await screen.findByText(
        t("trackerUi.card.statusChanged", { status: t(TRACK_STATUS_LABEL_KEYS.interview) }),
      ),
    ).toBeInTheDocument();
    // 漏斗与列表同一份筛选：只刷一边会让数字停在旧值。
    await waitFor(() => {
      expect(apiMocks.listTracksPage.mock.calls.length).toBeGreaterThan(listCalls);
      expect(apiMocks.listTrackStats.mock.calls.length).toBeGreaterThan(statsCalls);
    });
  });

  it("撤销 = 再 PATCH 一次改回去（不是删事件）", async () => {
    renderPage();
    await screen.findByText(COMPANY);

    await openStatusMenu();
    fireEvent.click(await statusMenuItem("interview"));
    await waitFor(() => expect(apiMocks.patchTrackStatus).toHaveBeenCalledTimes(1));

    fireEvent.click(await screen.findByRole("button", { name: t("toast.undo.label") }));

    await waitFor(() => expect(apiMocks.patchTrackStatus).toHaveBeenCalledTimes(2));
    // 第二次是"改回来"：目标状态是这一行原来的 applied。
    expect(apiMocks.patchTrackStatus).toHaveBeenLastCalledWith(5, "applied");
  });

  it("提交未完成时连点：不会写第二条事件", async () => {
    // 挂住请求，模拟慢网：此时那一行应当已经进 pending。
    apiMocks.patchTrackStatus.mockReturnValue(new Promise(() => {}));
    renderPage();
    await screen.findByText(COMPANY);

    await openStatusMenu();
    const item = await statusMenuItem("interview");
    fireEvent.click(item);
    // 同一个节点再点一次（菜单关掉之前/之后的重复触发都要被挡住）。
    fireEvent.click(item);

    await waitFor(() => expect(apiMocks.patchTrackStatus).toHaveBeenCalledTimes(1));
    // pending 期间胶囊不再可点：这是给用户的可见反馈，也是连点的第一道闸。
    const trigger = screen.getByRole("button", { name: statusTriggerName() });
    expect(trigger).toBeDisabled();
    expect(trigger.className).toContain("is-pending");
  });

  it("同状态不发请求（后端虽幂等，但明知无效的请求不该发）", async () => {
    renderPage();
    await screen.findByText(COMPANY);

    await openStatusMenu();
    const current = await statusMenuItem("applied");
    expect(current).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(current);

    // 等一拍确认没有请求发出去。
    await waitFor(() => expect(apiMocks.patchTrackStatus).not.toHaveBeenCalled());
  });
});
