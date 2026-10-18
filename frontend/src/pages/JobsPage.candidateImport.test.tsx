/**
 * 岗位页的「备选岗位」侧：导入到岗位、按采集记录跳转、卡片详情、批量选择。
 *
 * 从 `JobsPage.test.tsx` 拆出（行数预算 500）。`vi.mock` 不跨文件 hoist，
 * 所以这里自带一份 api mock 脚手架；用例名、注释与断言原样搬迁。
 */

import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CandidateJobDetail, Job, JobList } from "../types";
import JobsPage from "./JobsPage";

const mocks = vi.hoisted(() => ({
  reload: vi.fn(),
  startBackfill: vi.fn(),
  getJob: vi.fn(),
  jobs: [] as JobList[],
}));

// 详情统一经 getJob 拉全量（列表项已瘦身），点击行会触发；不 mock 会在 jsdom 里真发请求。
vi.mock("../api/jobs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/jobs")>();
  return { ...actual, getJob: mocks.getJob };
});

vi.mock("../hooks/useApi", () => ({
  useApi: () => ({
    data: { items: mocks.jobs, total: mocks.jobs.length },
    loading: false,
    reload: mocks.reload,
    error: null,
  }),
}));

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

function renderPage(initialEntries: string[] = ["/jobs"]) {
  return render(
    <AntdApp>
      <MemoryRouter initialEntries={initialEntries}>
        <JobsPage />
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

function makeCandidate(overrides: Partial<CandidateJobDetail> = {}): CandidateJobDetail {
  return {
    id: 1,
    title: "后端开发工程师",
    company: "示例公司",
    location: "",
    salary: "",
    raw_text: "",
    images: [],
    note: "",
    source: "官网采集",
    source_url: "",
    collect_task_id: null,
    status: "pending",
    imported_job_id: null,
    created_at: "2026-09-23T10:00:00",
    updated_at: "2026-09-23T10:00:00",
    description: "",
    requirements: "",
    job_type: "",
    additional_info: "",
    ...overrides,
  };
}

const makeCandidateDetail = makeCandidate;

describe("从备选岗位导入", () => {
  afterEach(cleanup);

  // 与拆分前一致的初始态：一行岗位 + 各 api mock 归零（原用例依赖上一个 describe
  // 的 beforeEach，这里显式写出来，避免文件独立运行时的串味）。
  beforeEach(() => {
    mocks.jobs = [makeJob()];
    mocks.getJob.mockReset();
    mocks.getJob.mockResolvedValue({ ...BASE_JOB });
    mocks.startBackfill.mockReset();
    mocks.startBackfill.mockResolvedValue({} as never);
    for (const mock of Object.values(candidateMocks)) mock.mockReset();
  });

  it("用详情那份预填表单，而不是列表那一行", async () => {
    // **这条守的是一个已经发生过的缺陷**：候选有两条来路，字段分布正好相反——手工粘贴的只有
    // raw_text，而采集来的内容全在 description/requirements 里、raw_text 是空的。
    // 而「导入到岗位」原先只预填 raw_text，于是采集来的候选打开的是一个**全空的表单**，
    // 用户看到的就是"导入进来什么都没有"——数据其实一直都在。
    //
    // 列表接口也刻意不带 JD（最多 300 条 × 单条上限几万字符），所以要取详情那一条。
    candidateMocks.listCandidateJobsPage.mockResolvedValue({
      items: [makeCandidate({ id: 9, title: "后端开发工程师", raw_text: "" })],
      total: 1,
    });
    candidateMocks.getCandidateJob.mockResolvedValue(
      makeCandidateDetail({
        id: 9,
        title: "后端开发工程师",
        description: "负责服务端开发与维护，参与架构演进。",
        requirements: "三年以上后端经验。",
      }),
    );
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: /备选岗位/ }));
    fireEvent.click(await screen.findByRole("button", { name: "导入到岗位" }));

    await waitFor(() => expect(candidateMocks.getCandidateJob).toHaveBeenCalledWith(9));
    // 表单里岗位描述那一栏要有内容——这才叫"导入进来了"。
    const description = await screen.findByLabelText("岗位描述（JD）");
    await waitFor(() => expect(description).toHaveValue("负责服务端开发与维护，参与架构演进。"));
    expect(screen.getByLabelText("岗位名称")).toHaveValue("后端开发工程师");
  });

  it("从采集记录跳转时只加载对应批次，并自动打开备选岗位", async () => {
    candidateMocks.listCandidateJobsPage.mockResolvedValue({
      items: [makeCandidate({ id: 12, title: "官网后端工程师", collect_task_id: 8 })],
      total: 1,
    });
    renderPage(["/jobs?collect_task_ids=8,9"]);

    await waitFor(() =>
      expect(candidateMocks.listCandidateJobsPage).toHaveBeenCalledWith(
        { collectTaskIds: [8, 9] },
        1,
        12,
      ),
    );
    expect(await screen.findByText(/这里只显示选中采集记录的岗位/)).toBeInTheDocument();
    expect(screen.getByText("官网后端工程师")).toBeInTheDocument();
  });

  it("点击备选岗位卡片会读取并展示完整详情", async () => {
    const candidate = makeCandidate({ id: 21, title: "数据分析师" });
    candidateMocks.listCandidateJobsPage.mockResolvedValue({ items: [candidate], total: 1 });
    candidateMocks.getCandidateJob.mockResolvedValue(
      makeCandidateDetail({
        id: 21,
        title: "数据分析师",
        description: "负责业务数据分析。",
        requirements: "熟悉 SQL。",
      }),
    );
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: /备选岗位/ }));
    fireEvent.click(await screen.findByText("数据分析师"));

    await waitFor(() => expect(candidateMocks.getCandidateJob).toHaveBeenCalledWith(21));
    expect(await screen.findByText("负责业务数据分析。")).toBeInTheDocument();
    expect(screen.getByText("熟悉 SQL。")).toBeInTheDocument();
  });

  it("备选岗位批量导入入口已移除（产品决策）；卡片勾选框只在多选模式出现", async () => {
    candidateMocks.listCandidateJobsPage.mockResolvedValue({
      items: [
        makeCandidate({ id: 31, title: "岗位一" }),
        makeCandidate({ id: 32, title: "岗位二" }),
      ],
      total: 2,
    });
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: /备选岗位/ }));
    // 普通模式：卡片上没有勾选框、也没有批量工具栏（含批量导入/批量删除）。
    expect(await screen.findByText("岗位一")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "全选本页" })).toBeNull();
    expect(screen.queryByRole("button", { name: "批量导入" })).toBeNull();
    expect(screen.queryByRole("button", { name: "批量删除" })).toBeNull();

    // 右键进入多选模式后：勾选框与批量操作区一起出现（仍无批量导入）。
    fireEvent.contextMenu(screen.getByText("岗位一"));
    fireEvent.click(await screen.findByRole("menuitem", { name: /批量选择/ }));
    expect(await screen.findByRole("checkbox", { name: "全选本页" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "批量删除" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "批量导入" })).toBeNull();
  });

  it("「全选全部」后翻页保留跨页选择：计数不丢、本页勾选框亮起", async () => {
    // 守的是 2026 的产品决策：跨页「全选全部」（选中 N 条）后翻页，不再清空 selectedIds
    // ——清空与「全选全部」的语义相悖。翻页后：工具条计数跨页保留（CandidateBatchToolbar
    // 的「已选 X / 总数」），「全选本页」勾选框按本页口径自然收敛为 checked 亮起。
    const pageOne = Array.from({ length: 12 }, (_, index) =>
      makeCandidate({ id: index + 1, title: `候选-${index + 1}` }),
    );
    const pageTwo = Array.from({ length: 3 }, (_, index) =>
      makeCandidate({ id: 13 + index, title: `候选-${13 + index}` }),
    );
    candidateMocks.listCandidateJobsPage.mockImplementation((_filters: unknown, page: number) =>
      Promise.resolve(page === 1 ? { items: pageOne, total: 15 } : { items: pageTwo, total: 15 }),
    );
    candidateMocks.listCandidateJobIds.mockResolvedValue(
      Array.from({ length: 15 }, (_, index) => index + 1),
    );
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: /备选岗位/ }));
    expect(await screen.findByText("候选-1")).toBeInTheDocument();
    // 「全选全部」只在多选模式出现——先右键进入批量选择。
    fireEvent.contextMenu(screen.getByText("候选-1"));
    fireEvent.click(await screen.findByRole("menuitem", { name: /批量选择/ }));
    fireEvent.click(await screen.findByRole("button", { name: "全选全部" }));
    expect(await screen.findByText("已选 15 / 15 条")).toBeInTheDocument();

    // 翻页：中途不点任何条目的勾选框，选择集应当原样保留。
    const pageTwoButton = document.querySelector(".ant-pagination-item-2");
    expect(pageTwoButton).not.toBeNull();
    fireEvent.click(pageTwoButton as HTMLElement);
    expect(await screen.findByText("候选-13")).toBeInTheDocument();
    expect(candidateMocks.listCandidateJobsPage).toHaveBeenLastCalledWith({}, 2, 12);

    // 计数跨页保留；本页 3 条全在选中集里 → 勾选框 checked 亮起而非半选/未选。
    expect(screen.getByText("已选 15 / 15 条")).toBeInTheDocument();
    const checkbox = screen.getByRole("checkbox", { name: "全选本页" }) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    expect(checkbox.indeterminate).toBe(false);
  });
});
