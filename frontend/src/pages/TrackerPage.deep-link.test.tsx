// SPDX-License-Identifier: Apache-2.0
/**
 * 求职进度页的深链参数：`?reminder=N`（整改 #13）。
 *
 * 这条链路此前是**断在前端**的：后端一直在发 `/tracker?reminder={id}`
 * （`reminder_occurrences.py` / `reminder_delivery.py`），而 `TrackerPage` 只读
 * `job_id / status / keyword`，参数一路落空——用户点「提醒已过期」通知只能落到列表页，
 * 还得自己在几十条提醒里找回那一条。
 *
 * 钉四件事：
 * 1. `?reminder=12` → 提醒面板打开，且展开 12 号那条的详情抽屉（标题为那条的标题）；
 * 2. 关掉抽屉 → URL 里的 `reminder` 被 replace 掉（刷新 / 转发不会再展开一次）；
 * 3. `?reminder=9999`（已删或不在筛选里）→ 说清原因、留在列表、**不开空抽屉**，URL 同样清掉；
 * 4. 非法值（`?reminder=abc`）当作没有深链：不弹提示、不开抽屉。
 *
 * 断言里的界面文案一律走 `t()`；条目标题是本文件自造的 ASCII 测试数据，
 * 避免在 ByText 参数里新增中文字面量（cjkRatchet 对新增文件没有额度）。
 */
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
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

const reminderMocks = vi.hoisted(() => ({
  listReminders: vi.fn(),
  listUpcomingReminders: vi.fn(),
  createReminder: vi.fn(),
  updateReminder: vi.fn(),
  snoozeReminder: vi.fn(),
  deleteReminder: vi.fn(),
}));
vi.mock("../api/reminders", () => reminderMocks);

const settingsMocks = vi.hoisted(() => ({ getAgentTaskEvents: vi.fn() }));
vi.mock("../api/settings", () => settingsMocks);

/** 深链那条提醒的标题（测试数据，不是界面文案）。 */
const LINKED_TITLE = "Board interview with Acme";
const OTHER_TITLE = "Send the portfolio";

function makeReminder(id: number, title: string) {
  return {
    id,
    title,
    remind_at: "2026-12-02T15:21:00",
    kind: "interview",
    status: "active",
    track_id: null,
    job_id: null,
    resume_id: null,
    note: "",
    created_at: "2026-11-20T08:00:00",
    updated_at: "2026-11-20T08:00:00",
  };
}

/** 读当前 URL：`useLocation` 只有在 Router 内部才拿得到（由 harness 的 renderPage 包裹）。 */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function currentUrl(): string {
  return screen.getByTestId("location").textContent ?? "";
}

/** 打开着的详情抽屉标题（没打开时返回 null，不给"空抽屉"用例蒙混过关的机会）。 */
function drawerTitle(): string | null {
  return document.querySelector(".ant-drawer-title")?.textContent ?? null;
}

beforeEach(() => {
  resetTrackerApiMocks(apiMocks, jobApiMocks);
  for (const mock of Object.values(reminderMocks)) mock.mockReset();
  reminderMocks.listReminders.mockResolvedValue([
    makeReminder(12, LINKED_TITLE),
    makeReminder(13, OTHER_TITLE),
  ]);
  settingsMocks.getAgentTaskEvents.mockReset().mockResolvedValue({ enabled: false });
});

afterEach(() => {
  // 本文件多条用例都开过 Modal / Drawer 浮层：统一清干净再交给下一条。
  cleanupTrackerPage();
  cleanup();
  document.body.innerHTML = "";
});

describe("TrackerPage 的 ?reminder= 深链", () => {
  it("展开该条提醒的详情抽屉，列表里其它提醒不受影响", async () => {
    renderPage(["/tracker?reminder=12"], <LocationProbe />);

    await waitFor(() => expect(drawerTitle()).toBe(LINKED_TITLE));
    expect(currentUrl()).toBe("/tracker?reminder=12");
    // 抽屉里是**12 号**那一条，不是列表第一条碰巧同名。
    expect(drawerTitle()).not.toBe(OTHER_TITLE);
  });

  it("关掉抽屉后 URL 里的 reminder 被清掉（刷新不会再展开一次）", async () => {
    renderPage(["/tracker?reminder=12"], <LocationProbe />);
    await waitFor(() => expect(drawerTitle()).toBe(LINKED_TITLE));

    const closeButton = document.querySelector<HTMLElement>(".ant-drawer-close");
    expect(closeButton).not.toBeNull();
    fireEvent.click(closeButton as HTMLElement);

    await waitFor(() => expect(drawerTitle()).toBeNull());
    // replace 而不是 push：返回键要回到"来这页之前"，不是回到带参数的自己。
    await waitFor(() => expect(currentUrl()).toBe("/tracker"));
    // 面板本身不关：用户是从一条提醒进来的，把他踢回空列表更莫名其妙。
    expect(document.querySelector(".ant-modal")).not.toBeNull();
  });

  it("id 不在列表里：说清原因、不开空抽屉，并清掉参数", async () => {
    renderPage(["/tracker?reminder=9999"], <LocationProbe />);

    expect(await screen.findByText(t("trackerPage.reminder.notFound"))).toBeInTheDocument();
    expect(drawerTitle()).toBeNull();
    await waitFor(() => expect(currentUrl()).toBe("/tracker"));
  });

  it("非法值当作没有深链：不弹提示、不开面板、URL 原样保留", async () => {
    renderPage(["/tracker?reminder=abc"], <LocationProbe />);

    // 等首屏取数完成（统计接口被调用）之后再看有没有多余的浮层/提示。
    await waitFor(() => expect(apiMocks.listTrackStats).toHaveBeenCalled());
    expect(drawerTitle()).toBeNull();
    // 连提醒面板都不该打开：非法值不是"打开一个空列表"的理由。
    expect(document.querySelector(".ant-modal")).toBeNull();
    expect(screen.queryByText(t("trackerPage.reminder.notFound"))).toBeNull();
    expect(currentUrl()).toBe("/tracker?reminder=abc");
  });
});

/**
 * 三个深链参数共用同一份解析与清理（`features/tracker/useTrackerDeepLink`）：
 * 清理时只删自己那个键，别人的（`job_id` / `track` / `status` / `keyword`）原样保留。
 * 各写一份 `searchParams.get` 的旧写法会在关抽屉时把刚点的 `track` 一起删掉。
 */
describe("深链参数之间互不覆盖", () => {
  it("关掉提醒抽屉时保留 job_id 与 status 筛选", async () => {
    apiMocks.listTracksPage.mockResolvedValue(makePage([makeTrack({ job_id: 7 })]));
    apiMocks.listTrackStats.mockResolvedValue(makeStats([makeTrack({ job_id: 7 })]));
    jobApiMocks.getJob.mockResolvedValue({ id: 7, title: "Backend intern", company: "Acme" });

    renderPage(["/tracker?job_id=7&status=applied&reminder=12"], <LocationProbe />);
    await waitFor(() => expect(drawerTitle()).toBe(LINKED_TITLE));

    fireEvent.click(document.querySelector(".ant-drawer-close") as HTMLElement);

    await waitFor(() => expect(drawerTitle()).toBeNull());
    await waitFor(() => {
      const url = currentUrl();
      expect(url).not.toContain("reminder=");
      expect(url).toContain("job_id=7");
      expect(url).toContain("status=applied");
    });
  });
});
