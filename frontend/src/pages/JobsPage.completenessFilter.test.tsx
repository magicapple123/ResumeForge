// SPDX-License-Identifier: Apache-2.0
/**
 * 岗位广场「数据完整度」筛选（CR-36）的接线：筛选状态进 URL、计数只针对筛选结果。
 *
 * 口径在**后端**（`job_queries.filtered_query` 的 `incomplete_only`）——前端只传布尔，
 * 不再自己判断「缺公司 + 缺薪资 + 无链接」，否则列表与跨页全选会各有一套口径。
 */

import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import JobsPage from "./JobsPage";

const apiMocks = vi.hoisted(() => ({
  listJobs: vi.fn(),
  listJobIds: vi.fn(),
}));

vi.mock("../api/jobs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/jobs")>()),
  listJobs: apiMocks.listJobs,
  listJobIds: apiMocks.listJobIds,
}));
// 补齐详情等入口在 jsdom 里会真发请求；这里只关心列表筛选，挡掉即可。
vi.mock("../api/apply", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/apply")>()),
  startBackfill: vi.fn(),
}));

// 断言用的中文标题收成常量：`getByText`/`findByText` 里不落 CJK 字面量（cjkRatchet 口径）。
const HEALTHY_TITLE = "AI产品实习生";
const SUSPICIOUS_TITLE = "首页";
const HEALTHY = { id: 35, title: HEALTHY_TITLE, company: "美团", job_type: "实习", keywords: [] };
const SUSPICIOUS = { id: 36, title: SUSPICIOUS_TITLE, company: "", job_type: "其他", keywords: [] };

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{location.search}</span>;
}

function renderPage(initialEntries: string[] = ["/jobs"]) {
  return render(
    <AntdApp>
      <MemoryRouter initialEntries={initialEntries}>
        <JobsPage />
        <LocationProbe />
      </MemoryRouter>
    </AntdApp>,
  );
}

function filterCheckbox() {
  return within(screen.getByTestId("job-completeness-filter")).getByRole("checkbox");
}

beforeEach(() => {
  apiMocks.listJobs
    .mockReset()
    .mockImplementation((params?: { incomplete_only?: boolean }) =>
      Promise.resolve(
        params?.incomplete_only
          ? { items: [SUSPICIOUS], total: 1 }
          : { items: [HEALTHY, SUSPICIOUS], total: 2 },
      ),
    );
  apiMocks.listJobIds.mockReset().mockResolvedValue([36]);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("JobsPage 数据完整度筛选", () => {
  it("默认不传 incomplete_only，列表是全部岗位", async () => {
    renderPage();

    expect(await screen.findByText(HEALTHY_TITLE)).toBeTruthy();
    await waitFor(() => expect(apiMocks.listJobs).toHaveBeenCalled());
    expect(apiMocks.listJobs.mock.calls[0][0].incomplete_only).toBeFalsy();
    expect(screen.queryByTestId("job-completeness-count")).toBeNull();
  });

  it("勾选后把 incomplete_only 传给后端、写进 URL，并只显示可疑行与它的计数", async () => {
    renderPage();
    await screen.findByText(HEALTHY_TITLE);

    fireEvent.click(filterCheckbox());

    expect(await screen.findByText(SUSPICIOUS_TITLE)).toBeTruthy();
    expect(screen.queryByText(HEALTHY_TITLE)).toBeNull();
    await waitFor(() =>
      expect(apiMocks.listJobs).toHaveBeenLastCalledWith(
        expect.objectContaining({ incomplete_only: true }),
      ),
    );
    await waitFor(() =>
      expect(
        new URLSearchParams(screen.getByTestId("location").textContent ?? "").get("incomplete"),
      ).toBe("1"),
    );
    expect(screen.getByTestId("job-completeness-count").textContent).toContain("1");
  });

  it("从 ?incomplete=1 进入时直接是筛选态", async () => {
    renderPage(["/jobs?incomplete=1"]);

    expect(await screen.findByText(SUSPICIOUS_TITLE)).toBeTruthy();
    await waitFor(() =>
      expect(apiMocks.listJobs).toHaveBeenCalledWith(
        expect.objectContaining({ incomplete_only: true }),
      ),
    );
    expect(filterCheckbox()).toHaveProperty("checked", true);
  });

  it("取消勾选回到全部岗位，并从 URL 移除 incomplete", async () => {
    renderPage(["/jobs?incomplete=1"]);
    await screen.findByText(SUSPICIOUS_TITLE);

    fireEvent.click(filterCheckbox());

    expect(await screen.findByText(HEALTHY_TITLE)).toBeTruthy();
    await waitFor(() =>
      expect(
        new URLSearchParams(screen.getByTestId("location").textContent ?? "").has("incomplete"),
      ).toBe(false),
    );
  });
});
