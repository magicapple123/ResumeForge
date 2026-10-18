/**
 * 岗位页：列表展示、批量补齐详情与选择模式、URL 状态化、详情抽屉的重复打开与竞态。
 *
 * 「备选岗位」侧（导入/采集跳转/卡片详情/批量选择）的用例已拆到
 * `JobsPage.candidateImport.test.tsx`（行数预算）。
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

function renderPage(initialEntries: string[] = ["/jobs"]) {
  return render(
    <AntdApp>
      <MemoryRouter initialEntries={initialEntries}>
        <JobsPage />
      </MemoryRouter>
    </AntdApp>,
  );
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

describe("JobsPage", () => {
  // 本仓库没有全局 auto-cleanup（见 ApplyPage.test.tsx），必须显式清理，
  // 否则前一个用例渲染出的 DOM 会留在 document 里，让后面的 getByRole 命中多个元素。
  afterEach(cleanup);

  beforeEach(() => {
    mocks.jobs = [makeJob()];
    mocks.getJob.mockReset();
    mocks.getJob.mockResolvedValue({ ...BASE_JOB });
    mocks.startBackfill.mockReset();
    mocks.startBackfill.mockResolvedValue({} as never);
    for (const mock of Object.values(candidateMocks)) mock.mockReset();
  });

  it("shows the recruitment posted date instead of the local update timestamp", () => {
    renderPage();

    expect(screen.getAllByText("发布时间").length).toBeGreaterThan(0);
    expect(screen.getByText("2026年8月20日")).toBeInTheDocument();
    expect(screen.queryByText("更新时间")).not.toBeInTheDocument();
    expect(screen.queryByText("2026-08-21 17:30")).not.toBeInTheDocument();
  });

  it("有 JD 为空的岗位时显示「补齐详情」按钮", () => {
    mocks.jobs = [makeJob({ id: 7, title: "后端开发", description: "" })];
    renderPage();

    expect(screen.getByRole("button", { name: "补齐详情" })).toBeInTheDocument();
  });

  it("所有岗位都有岗位描述时不显示「补齐详情」按钮", () => {
    mocks.jobs = [makeJob({ description: "有正文的岗位描述" })];
    renderPage();

    expect(screen.queryByRole("button", { name: "补齐详情" })).not.toBeInTheDocument();
  });

  /** 右键第一行，从菜单点「批量选择」进入选择模式（入口已从工具栏收进右键菜单，R8）。 */
  async function enterSelectionModeViaContextMenu() {
    // 用 findAll：多条岗位可能同名（默认标题相同），取第一行的标题按钮即可。
    const firstJobButton = (
      await screen.findAllByRole("button", { name: mocks.jobs[0]!.title })
    )[0]!;
    fireEvent.contextMenu(firstJobButton.closest("tr") as HTMLElement);
    fireEvent.click(await screen.findByRole("menuitem", { name: /批量选择/ }));
  }

  it("「批量选择」入口在行右键菜单里，工具栏不再有直接按钮（R8）", async () => {
    renderPage();

    expect(screen.queryByRole("button", { name: "选择" })).not.toBeInTheDocument();

    await enterSelectionModeViaContextMenu();

    // 进入选择模式的标志：复选框列出现，退出按钮接管工具栏。
    // （按钮名带图标的前缀 aria-label，用正则匹配。）
    expect(screen.getAllByRole("checkbox").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /退出选择/ })).toBeInTheDocument();
  });

  it("选择模式下有勾选时只补勾选的岗位，而不是本页所有空 JD", async () => {
    mocks.jobs = [
      makeJob({ id: 1, title: "空A", description: "" }),
      makeJob({ id: 2, title: "空B", description: "" }),
    ];
    renderPage();

    await enterSelectionModeViaContextMenu();
    // 第 0 个复选框是全选表头，第 1 个才是第一行；只勾第一行。
    fireEvent.click(screen.getAllByRole("checkbox")[1]);

    fireEvent.click(screen.getByRole("button", { name: "补齐详情" }));

    await waitFor(() => expect(mocks.startBackfill).toHaveBeenCalledTimes(1));
    // 勾选了就只补勾选的：不能把本页所有空 JD 也一起送出去。
    expect(mocks.startBackfill).toHaveBeenCalledWith([1]);
  });

  it("选择模式下没有勾选时退回补本页所有空 JD", async () => {
    mocks.jobs = [makeJob({ id: 1, description: "" }), makeJob({ id: 2, description: "" })];
    renderPage();

    await enterSelectionModeViaContextMenu();
    fireEvent.click(screen.getByRole("button", { name: "补齐详情" }));

    await waitFor(() => expect(mocks.startBackfill).toHaveBeenCalledTimes(1));
    expect(mocks.startBackfill).toHaveBeenCalledWith([1, 2]);
  });

  it("本页没有空 JD 时不出现按钮（即使进了选择模式），因而不存在提交空数组的路径", async () => {
    // 空数组会被后端 400 拒绝。若按钮常驻，用户就会看到一个"点得动、点了报错"的按钮。
    // 这里证明了那条路径不存在：没有空 JD → 按钮不渲染 → 连点击入口都没有。
    mocks.jobs = [makeJob({ id: 1, description: "有正文" })];
    renderPage();

    await enterSelectionModeViaContextMenu();

    expect(screen.queryByRole("button", { name: "补齐详情" })).not.toBeInTheDocument();
    expect(mocks.startBackfill).not.toHaveBeenCalled();
  });

  it("点「补齐详情」只把这页 JD 为空的岗位 id 交给后端", async () => {
    mocks.jobs = [
      makeJob({ id: 1, title: "有正文的岗位", description: "正文" }),
      makeJob({ id: 2, title: "空的岗位", description: "" }),
      makeJob({ id: 3, title: "只有空白的岗位", description: "   " }),
    ];
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "补齐详情" }));

    await waitFor(() => expect(mocks.startBackfill).toHaveBeenCalledTimes(1));
    // 只送"描述为空"的两条；有正文的那条不该被带上。
    expect(mocks.startBackfill).toHaveBeenCalledWith([2, 3]);
  });

  it("后端拒绝时提示错误而不是谎报成功", async () => {
    mocks.jobs = [makeJob({ id: 5, description: "" })];
    mocks.startBackfill.mockRejectedValueOnce(new Error("一次最多补齐 200 个岗位的详情"));
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "补齐详情" }));

    await waitFor(() =>
      expect(screen.getByText(/一次最多补齐 200 个岗位的详情/)).toBeInTheDocument(),
    );
  });

  it("未进选择模式点「AI 分析适配度」时直接进入选择模式并提示", async () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "AI 分析适配度" }));

    // 不是「请先选择岗位」的死路提示，而是把用户带进选择模式。
    expect(await screen.findByText("已进入选择模式，勾选岗位后点分析")).toBeInTheDocument();
    expect(screen.getByText("退出选择")).toBeInTheDocument();
  });

  it("后端因来源不支持拒收时只给提示，不给「仍然加入」的按钮", async () => {
    // 这是**兜底**分支：正常情况下按钮对这类岗位已经禁用了；万一前端数据里没有
    // apply_supported（旧缓存 / 旧版本），后端仍会拦下，界面必须说清楚而不能弹"确认继续"。
    const applyApi = await import("../api/apply");
    const spy = vi.spyOn(applyApi, "addToQueue").mockRejectedValue(
      new applyApi.QueueConflictError({
        message: "「护士」的来源不是投递台支持的招聘网站（当前支持：BOSS直聘），无法自动投递。",
        site_unsupported: true,
      }),
    );
    mocks.jobs = [makeJob({ id: 6, source: "手动添加", source_url: "" })];
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "护士" }));
    fireEvent.click(await screen.findByRole("button", { name: /加入投递台/ }));

    // antd 的确认弹窗把 title 同时渲染在弹窗头和内容区（本项目其它 modal.confirm 也是这个形状），
    // 所以这里按"至少出现一次"断言，真正的判据是内容里带上了后端那句话。
    expect((await screen.findAllByText("这个岗位不能自动投递")).length).toBeGreaterThan(0);
    expect(screen.getByText(/来源不是投递台支持的招聘网站/)).toBeInTheDocument();
    // 这一类确认也没用，所以不能出现"仍然加入"。
    expect(screen.queryByRole("button", { name: /仍然加入/ })).not.toBeInTheDocument();
    spy.mockRestore();
  });
});

describe("JobsPage URL 状态化", () => {
  afterEach(cleanup);

  beforeEach(() => {
    mocks.jobs = [makeJob()];
    mocks.getJob.mockReset();
    mocks.getJob.mockResolvedValue({ ...BASE_JOB });
    mocks.startBackfill.mockReset();
    mocks.startBackfill.mockResolvedValue({} as never);
    for (const mock of Object.values(candidateMocks)) mock.mockReset();
  });

  it("改筛选后写回 URL（replace 语义由 useSearchParams 的 replace 选项保证）", async () => {
    renderPageWithProbe();

    const searchBox = screen.getByPlaceholderText("搜索岗位 / 公司 / 城市 / 描述 / 备注");
    fireEvent.change(searchBox, { target: { value: "算法工程师" } });
    fireEvent.keyDown(searchBox, { key: "Enter" });

    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        `keyword=${encodeURIComponent("算法工程师")}`,
      ),
    );
  });

  it("进页面时从 URL 恢复筛选与页码", () => {
    mocks.jobs = Array.from({ length: 12 }, (_, index) =>
      makeJob({ id: index + 1, title: `示例岗位${index + 1}` }),
    );
    renderPageWithProbe(["/jobs?keyword=%E6%8A%A4%E5%A3%AB&page=2"]);

    const searchInput = screen.getByPlaceholderText(
      "搜索岗位 / 公司 / 城市 / 描述 / 备注",
    ) as HTMLInputElement;
    expect(searchInput.value).toBe("护士");
    // 分页器停在恢复出的第 2 页（12 条 × 每页 10 条 → 共 2 页）。
    expect(document.querySelector(".ant-pagination-item-active")?.getAttribute("title")).toBe("2");
  });

  it("打开详情时把 job_id 写进 URL，关闭时移除", async () => {
    renderPageWithProbe();

    fireEvent.click(screen.getByRole("button", { name: "护士" }));

    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("job_id=1"));

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => expect(screen.getByTestId("location").textContent).not.toContain("job_id"));
  });
});

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
