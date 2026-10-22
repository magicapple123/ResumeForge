// SPDX-License-Identifier: Apache-2.0
/**
 * TrackerPage 测试共用的夹具、渲染与 mock 重置脚手架。
 *
 * 2026-10-22（行数预算审计 A10）：TrackerPage.test.tsx 按自身豁免的触发条件拆分为
 * 「页面通用行为 + 统计卡配色」（TrackerPage.test.tsx）与「导入预览 + ?job_id= 深链」
 * （TrackerPage.import-modal.test.tsx）两个文件。vi.mock 声明必须留在各测试文件内
 * （vitest 的 mock 注册是文件级的），但 Track 夹具、渲染辅助与 mock 重置逻辑只有
 * 一份实现——就是本文件。
 *
 * 命名遵循 src/test/ 下既有共享测试基建的约定（profilePageHarness.tsx /
 * assistantPageHarness.tsx 同款），不带 `.test.` 后缀（不会被 vitest 收集、也不会被
 * 行数预算当成生产代码误判——它本来就是测试脚手架，与 resumeFixtures.ts 同类）。
 */
import { App as AntdApp } from "antd";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Mock } from "vitest";
import type { Track, TrackList } from "../types";
import type { Page } from "../types/common";
import TrackerPage from "../pages/TrackerPage";

/** 测试文件里 `vi.hoisted` 创建的那组 ../api/tracker mock 的形状。 */
export interface TrackerApiMocks {
  listTracks: Mock;
  listTrackStats: Mock;
  listTracksPage: Mock;
  getTrack: Mock;
  createTrack: Mock;
  updateTrack: Mock;
  deleteTrack: Mock;
  parseTracks: Mock;
  applyTracks: Mock;
  exportTracks: Mock;
}

/** 测试文件里 `vi.hoisted` 创建的那组 ../api/jobs mock 的形状。 */
export interface TrackerJobApiMocks {
  listJobs: Mock;
  getJob: Mock;
}

export function makeTrack(overrides: Partial<Track> = {}): Track {
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

export function makeList(items: Track[]): TrackList {
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
export function makeStats(items: Track[]) {
  const { status_counts, active_count, offer_count, rejected_count, month_count } = makeList(items);
  return { status_counts, active_count, offer_count, rejected_count, month_count };
}

export function makePage(items: Track[], total = items.length): Page<Track> {
  return { items, total };
}

/** 渲染整页（与拆分前逐字节等价的挂载方式：MemoryRouter + AntdApp 包裹一并下沉）。 */
export function renderPage(initialEntries: string[] = ["/tracker"]) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <AntdApp>
        <TrackerPage />
      </AntdApp>
    </MemoryRouter>,
  );
}

/**
 * 每条用例前的 mock 复位 + 默认返回值。
 *
 * apiMocks / jobApiMocks 是各测试文件用 `vi.hoisted` 自建的对象（vi.mock 工厂只能
 * 引用同文件的 hoisted 值），这里接收进来统一复位。
 */
export function resetTrackerApiMocks(mocks: TrackerApiMocks, jobs: TrackerJobApiMocks): void {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.listTrackStats.mockResolvedValue(makeStats([]));
  mocks.listTracksPage.mockResolvedValue(makePage([]));
  jobs.listJobs.mockReset().mockRejectedValue(new Error("jobs unavailable"));
  jobs.getJob.mockReset().mockRejectedValue(new Error("job unavailable"));
}

/** 每条用例后的清理：卸载刚渲染的树（与拆分前的 `afterEach(cleanup)` 等价）。 */
export function cleanupTrackerPage(): void {
  cleanup();
}
