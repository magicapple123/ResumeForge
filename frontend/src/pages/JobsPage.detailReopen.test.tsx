// SPDX-License-Identifier: Apache-2.0
/**
 * 岗位详情抽屉的重复打开与竞态（R2）：双击同一行、关闭后重开、快速 A→B 的晚到响应。
 *
 * 从 `JobsPage.test.tsx` 拆出（行数预算）：这里只放详情抽屉的打开/重开/竞态这一域，
 * 列表展示、补齐详情与 URL 状态化仍在主文件里。`vi.mock` 按测试文件装配，所以 mock
 * 声明必须在本文件内逐字声明。
 */

import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job, JobList } from "../types";
import JobsPage from "./JobsPage";

const mocks = vi.hoisted(() => ({
  reload: vi.fn(),
  startBackfill: vi.fn(),
  getJob: vi.fn(),
  getJobAnalysis: vi.fn(),
  jobs: [] as JobList[],
}));

// 详情统一经 getJob 拉全量（列表项已瘦身），点击行会触发；不 mock 会在 jsdom 里真发请求。
// getJobAnalysis 同理：解读弹窗一打开就去读缓存，不挡掉也会真发 fetch。
vi.mock("../api/jobs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/jobs")>();
  return { ...actual, getJob: mocks.getJob, getJobAnalysis: mocks.getJobAnalysis };
});

// 解读弹窗打开就会读缓存：默认给"没有缓存"，需要的用例再用 mockResolvedValueOnce 覆盖。
// 不 reset（各 describe 的 beforeEach 只管自己的 mock），否则会退回 undefined → 弹窗里
// `.then` 拿到 undefined 直接抛。
mocks.getJobAnalysis.mockResolvedValue({
  cached: false,
  stale: false,
  generated_at: null,
  result: null,
});

vi.mock("../hooks/useApi", () => ({
  useApi: () => ({
    data: { items: mocks.jobs, total: mocks.jobs.length },
    loading: false,
    reload: mocks.reload,
    error: null,
  }),
}));

// 只替换要断言的 `startBackfill`，其余导出（addToQueue / QueueConflictError）保持真实，
// 免得漏掉某个导出让 `import` 变成 undefined。
vi.mock("../api/apply", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/apply")>();
  return { ...actual, startBackfill: mocks.startBackfill };
});

const BASE_JOB: Job = {
  id: 1,
  title: "护士",
  company: "示例医院",
  location: "杭州市余杭区",
  salary: "",
  job_type: "社招",
  description: "负责病区护理工作。",
  requirements: "持有护士执业资格证。",
  additional_info: "提供岗位培训。",
  keywords: [],
  source: "手动添加",
  source_url: "",
  posted_at: "2026年8月20日",
  status: "开放中",
  note: "",
  note_images: [],
  recognition_source: "",
  origin_source: "",
  favorite: false,
  created_at: "2026-08-19T08:00:00",
  updated_at: "2026-08-21T09:30:00",
};

function makeJob(overrides: Partial<Job> = {}): JobList {
  const merged = { ...BASE_JOB, ...overrides };
  const { description, ...rest } = merged;
  return { ...rest, has_description: description.trim().length > 0 };
}

/** 把当前 search 显示出来，供 URL 状态化断言用。 */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.search}</div>;
}

function renderPageWithProbe(initialEntries: string[] = ["/jobs"]) {
  return render(
    <AntdApp>
      <MemoryRouter initialEntries={initialEntries}>
        <JobsPage />
        <LocationProbe />
      </MemoryRouter>
    </AntdApp>,
  );
}

// 备选岗位抽屉与「导入到岗位」都会调它；不挡掉的话 jsdom 里会真发 fetch。
const candidateMocks = vi.hoisted(() => ({
  listCandidateJobs: vi.fn(),
  listCandidateJobsPage: vi.fn(),
  listCandidateJobIds: vi.fn(),
  exportCandidatesCsv: vi.fn(),
  getCandidateJob: vi.fn(),
  createCandidateJob: vi.fn(),
  updateCandidateJob: vi.fn(),
  deleteCandidateJob: vi.fn(),
  importCandidateJobs: vi.fn(),
  markCandidateJobImported: vi.fn(),
}));

vi.mock("../api/candidateJob", () => candidateMocks);

describe("岗位详情重复打开（R2：双击、重开与竞态）", () => {
  afterEach(cleanup);

  beforeEach(() => {
    // 两行：一为"护士"(id=1)，一为"后端开发"(id=2)，竞态用例需要两个岗位。
    mocks.jobs = [makeJob({ id: 1, title: "护士" }), makeJob({ id: 2, title: "后端开发" })];
    mocks.getJob.mockReset();
    mocks.getJob.mockResolvedValue({ ...BASE_JOB });
    mocks.startBackfill.mockReset();
    mocks.startBackfill.mockResolvedValue({} as never);
    for (const mock of Object.values(candidateMocks)) mock.mockReset();
  });

  /** 抽屉是否处于展开态：antd 在打开的抽屉根节点上挂 `-open` 类。 */
  function drawerOpened(): boolean {
    return document.querySelector(".ant-drawer-open") !== null;
  }

  it("连续两次点击同一岗位标题，抽屉仍然显示详情，且不重复请求", async () => {
    // **这条守的是一个真实缺陷**：openDetail 原先无条件 setDetailJob(null)，而
    // openedLinkedJobId 锁存着同一个 id，effect 因此不再拉取 —— 双击同一行之后抽屉
    // 就是一片空白，用户看到的是"点了没反应"。
    renderPageWithProbe();
    fireEvent.click(screen.getByRole("button", { name: "护士" }));

    await waitFor(() => expect(drawerOpened()).toBe(true));
    await waitFor(() => expect(screen.getByText("负责病区护理工作。")).toBeInTheDocument());
    expect(mocks.getJob).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "护士" }));

    await waitFor(() => expect(drawerOpened()).toBe(true));
    expect(screen.getByText("负责病区护理工作。")).toBeInTheDocument();
    expect(mocks.getJob).toHaveBeenCalledTimes(1);
  });

  it("关闭抽屉后再点同一岗位，会重新拉取详情并重新打开", async () => {
    renderPageWithProbe();
    fireEvent.click(screen.getByRole("button", { name: "护士" }));
    await waitFor(() => expect(screen.getByText("负责病区护理工作。")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(drawerOpened()).toBe(false));

    fireEvent.click(screen.getByRole("button", { name: "护士" }));

    await waitFor(() => expect(mocks.getJob).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(drawerOpened()).toBe(true));
    expect(screen.getByText("负责病区护理工作。")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("job_id=1");
  });

  it("快速 A→B：晚到的 A 响应不会覆盖 B", async () => {
    let resolveFirst: ((job: Job) => void) | undefined;
    mocks.getJob.mockImplementation((id: number) => {
      if (id === 1) {
        // A 故意挂住：等 B 先回来之后再放行，模拟慢响应。
        return new Promise<Job>((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve({
        ...BASE_JOB,
        id: 2,
        title: "后端开发",
        description: "负责服务端开发。",
      });
    });

    renderPageWithProbe();
    fireEvent.click(screen.getByRole("button", { name: "护士" }));
    await waitFor(() => expect(resolveFirst).toBeTypeOf("function"));

    fireEvent.click(screen.getByRole("button", { name: "后端开发" }));
    await waitFor(() => expect(screen.getByText("负责服务端开发。")).toBeInTheDocument());
    expect(screen.getByTestId("location")).toHaveTextContent("job_id=2");

    resolveFirst?.({ ...BASE_JOB, description: "负责病区护理工作。" });

    // 晚到的 A 已经被序号守卫作废：内容仍然是 B 的。
    await waitFor(() => expect(screen.queryByText("负责病区护理工作。")).not.toBeInTheDocument());
    expect(screen.getByText("负责服务端开发。")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("job_id=2");
  });
});
