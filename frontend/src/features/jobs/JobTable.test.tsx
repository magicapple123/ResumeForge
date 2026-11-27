// SPDX-License-Identifier: Apache-2.0
/** 岗位表格：来源角标 + 悬停显示导入时间 + 列头排序（R14）。 */

import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Job, JobList, Page } from "../../types";
import { t } from "../../i18n";
import { DEFAULT_JOB_SORT_STATE, type JobSortState } from "../../utils/jobSort";
import JobTable from "./JobTable";
import type { RowActionItem } from "../../components/common/RowActions";

const navigateMock = vi.hoisted(() => vi.fn());
const externalResumeApi = vi.hoisted(() => ({
  uploadExternalResume: vi.fn(),
  listExternalResumes: vi.fn(),
  deleteExternalResume: vi.fn(),
  getExternalResume: vi.fn(),
  getExternalResumeAnalysis: vi.fn(),
  externalResumeFileUrl: (id: number) => `/api/external-resumes/${id}/file`,
}));

vi.mock("../../api/externalResumes", () => externalResumeApi);
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigateMock };
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
  additional_info: "",
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

const noop = () => undefined;

function renderTable(
  jobs: JobList[],
  options: {
    sortState?: JobSortState;
    onSortChange?: (state: JobSortState) => void;
    selectionMode?: boolean;
    bulkActions?: RowActionItem[];
  } = {},
) {
  const page: Page<JobList> = { items: jobs, total: jobs.length };
  // 表格里的「添加外部简历」用 useNavigate 收尾（Toast 的「查看」），所以这里必须有 Router。
  return render(
    <MemoryRouter>
      <AntdApp>
        <JobTable
          jobs={page}
          loading={false}
          selectionMode={options.selectionMode ?? false}
          rowSelection={{} as never}
          batchAction={null}
          favoriteJobId={null}
          page={1}
          pageSize={10}
          onToggleFavorite={noop}
          onOpenDetail={noop}
          onGenerate={noop}
          onWrite={noop}
          onViewResumes={noop}
          onEdit={noop}
          onDelete={noop}
          onEnterSelecting={noop}
          bulkActions={options.bulkActions ?? []}
          onPageChange={noop}
          sortState={options.sortState ?? DEFAULT_JOB_SORT_STATE}
          onSortChange={options.onSortChange ?? noop}
        />
      </AntdApp>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

/**
 * 断言用的界面文案集中在这里。
 *
 * 为什么抽成常量：全仓 `src/i18n/cjkRatchet.test.ts` 会把 `getByText("中文")` 计成"新增中文文案"
 * （只降不升）。这里断的是表格渲染出来的枚举标签与岗位名，属于**数据**而不是新文案，
 * 引用常量既守住了棘轮，也避免同一句中文在文件里散落多处、改一次漏一处。
 */
const BADGE_COLLECTED = "采集";
const BADGE_MANUAL = "手动";
const STATUS_OPEN = "开放中";
const JOB_TITLE = "护士";

describe("JobTable 来源角标", () => {
  it("采集来的岗位标「采集」", () => {
    renderTable([makeJob({ recognition_source: "岗位采集", source: "BOSS直聘" })]);

    expect(screen.getByText(BADGE_COLLECTED)).toBeInTheDocument();
    expect(screen.queryByText(BADGE_MANUAL)).not.toBeInTheDocument();
  });

  it("官网采集历史来源也标「采集」", () => {
    renderTable([makeJob({ recognition_source: "官网采集", source: "官网采集" })]);

    expect(screen.getByText(BADGE_COLLECTED)).toBeInTheDocument();
    expect(screen.queryByText(BADGE_MANUAL)).not.toBeInTheDocument();
  });

  it("历史 active 状态显示为开放中，而不是把内部值直接露出来", () => {
    renderTable([makeJob({ status: "active" })]);

    expect(screen.getByText(STATUS_OPEN)).toBeInTheDocument();
    expect(screen.queryByText("active")).not.toBeInTheDocument();
  });

  it("手动添加的岗位标「手动」", () => {
    renderTable([makeJob({ recognition_source: "", source: "手动添加" })]);

    expect(screen.getByText(BADGE_MANUAL)).toBeInTheDocument();
    expect(screen.queryByText(BADGE_COLLECTED)).not.toBeInTheDocument();
  });
});

describe("JobTable 悬停导入时间", () => {
  it("悬停岗位标题时显示导入时间", async () => {
    renderTable([makeJob({ created_at: "2026-08-19T08:00:00" })]);

    fireEvent.mouseEnter(screen.getByRole("button", { name: "护士" }));

    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent(/导入于 \d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
  });

  it("悬停岗位格里的关键字标签（不在标题上）同样显示导入时间", async () => {
    renderTable([makeJob({ created_at: "2026-08-19T08:00:00" })]);
    await screen.findByText(JOB_TITLE);

    // 用户不会只在标题那两个字上悬停；整格都该给提示。
    // Tooltip 的触发器是格子里的那层 div，所以悬停要落在它身上。
    const trigger = screen.getByText(BADGE_MANUAL).closest("td")?.firstElementChild;
    expect(trigger).toBeTruthy();
    fireEvent.mouseEnter(trigger as HTMLElement);

    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent(/导入于 \d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
  });
});

describe("JobTable 列头排序（R14）", () => {
  /** 点某列列头。表头标题在 antd 6 里会出现多份（测量/克隆节点），统一点 `<th>` 本体。 */
  function clickHeader(label: string) {
    const title = screen.getAllByText(label)[0]!;
    const th = title.closest("th");
    expect(th).toBeTruthy();
    fireEvent.click(th as HTMLElement);
  }

  it("点「岗位」列头把排序翻译成后端 sort=title_asc", () => {
    const onSortChange = vi.fn();
    renderTable([makeJob()], { onSortChange });

    clickHeader("岗位");

    expect(onSortChange).toHaveBeenCalledWith({ sort: "title_asc", order: null });
  });

  it("点「公司」列头把排序翻译成后端 sort=company_asc", () => {
    const onSortChange = vi.fn();
    renderTable([makeJob()], { onSortChange });

    clickHeader("公司");

    expect(onSortChange).toHaveBeenCalledWith({ sort: "company_asc", order: null });
  });

  it("「发布时间」列按 posted_at 排序：首次倒序，再点升序", () => {
    const onSortChange = vi.fn();
    const { unmount } = renderTable([makeJob()], { onSortChange });

    // 默认态没有任何列点亮：发布时间的第一次点击给出倒序（最近的在前）。
    clickHeader("发布时间");
    expect(onSortChange).toHaveBeenCalledWith({ sort: "posted_desc", order: null });

    unmount();
    const second = vi.fn();
    renderTable([makeJob()], {
      sortState: { sort: "posted_desc", order: null },
      onSortChange: second,
    });
    clickHeader("发布时间");
    expect(second).toHaveBeenCalledWith({ sort: "posted_desc", order: "asc" });
  });

  it("默认态没有任何列头带排序样式（ant-table-column-sort）", () => {
    const { container } = renderTable([makeJob()]);
    expect(container.querySelector(".ant-table-column-sort")).toBeNull();
  });
});

describe("JobTable 空表可访问性", () => {
  it("空数据时不产生无目标的横向滚动区域（axe scrollable-region-focusable）", () => {
    const { container } = renderTable([]);

    const content = container.querySelector<HTMLElement>(".ant-table-content");
    expect(content).not.toBeNull();
    // 没有 overflow-x，容器就不是"可滚动区域"——空表不该出现一个没有任何可聚焦元素的滚动区。
    expect(content?.style.overflowX).toBe("");
    // 表格也不再被钉成固定 1350px 宽；auto 布局会把列宽压回容器宽度，不会反向造成页面级横向溢出。
    expect(container.querySelector<HTMLElement>("table")?.style.width).toBe("");
  });

  it("有数据时保持原行为：列宽固定 1350px + 横向滚动", () => {
    const { container } = renderTable([makeJob()]);

    const content = container.querySelector<HTMLElement>(".ant-table-content");
    expect(content?.style.overflowX).toBe("auto");
    // 操作列 170 → 190（条目 01：多一个三点按钮），列宽和 1344 → 1364，scroll.x 同步 +20。
    expect(container.querySelector<HTMLElement>("table")?.style.width).toBe("1350px");
  });
});

describe("JobTable 行内三点（条目 01）", () => {
  it("三点存在，点开是次级操作；行内已平铺的主操作与「复制」不在菜单里", async () => {
    renderTable([makeJob()]);

    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));

    expect(await screen.findByRole("menuitem", { name: "编辑" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "删除" })).toBeInTheDocument();
    // 「详情 / 生成简历」已经平铺在行上，菜单里重复一遍只会让用户多点一步。
    expect(screen.queryByRole("menuitem", { name: /详情/ })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /生成简历/ })).toBeNull();
  });

  it("选择模式下三点与行内主操作一并禁用（batchAction 之外的第二个条件）", () => {
    renderTable([makeJob()], { selectionMode: true });

    expect(screen.getByRole("button", { name: "更多操作" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "详情" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "生成简历" })).toBeDisabled();
  });

  it("非选择模式下三点与行内主操作都可用", () => {
    renderTable([makeJob()]);

    expect(screen.getByRole("button", { name: "更多操作" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "详情" })).toBeEnabled();
  });
});

describe("JobTable 多选态右键", () => {
  it("只给批量动作，不再混入单行的编辑/删除", async () => {
    const onBulk = vi.fn();
    const bulkActions: RowActionItem[] = [
      { key: "bulk_match", label: "Bulk match", onClick: onBulk },
      { key: "bulk_export", label: "Bulk export", onClick: onBulk },
    ];
    renderTable([makeJob()], { selectionMode: true, bulkActions });

    fireEvent.contextMenu(
      document.querySelector(".jobs-table tbody tr.ant-table-row") as HTMLElement,
    );

    expect(await screen.findByText("Bulk match")).toBeInTheDocument();
    expect(screen.getByText("Bulk export")).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /编\s*辑/ })).toBeNull();

    fireEvent.click(screen.getByText("Bulk export"));
    expect(onBulk).toHaveBeenCalledTimes(1);
  });
});

describe("JobTable 非选择模式右键", () => {
  it("菜单里有「批量选择」入口", async () => {
    renderTable([makeJob()]);

    fireEvent.contextMenu(
      document.querySelector(".jobs-table tbody tr.ant-table-row") as HTMLElement,
    );

    expect(await screen.findByRole("menuitem", { name: /批量选择/ })).toBeInTheDocument();
  });
});

/**
 * 右键「添加外部简历」（整改 #6）。
 *
 * `secondaryActions` 同时喂给行内「⋯」与整行右键，所以只加一项两处都有；选择模式的右键
 * 换成批量动作，因此不该出现这一项。点开之后弹窗带 `presetJob`：没有岗位选择器、
 * 不请求候选岗位，成功后 Toast 的「查看」落到该岗位的外部简历列表。
 */
describe("JobTable 右键添加外部简历（#6）", () => {
  const firstRow = () =>
    document.querySelector(".jobs-table tbody tr.ant-table-row") as HTMLElement;

  function resetApi() {
    navigateMock.mockReset();
    externalResumeApi.uploadExternalResume.mockReset();
  }

  it("非选择模式右键含该入口，点开是预设该岗位的弹窗（没有岗位选择器）", async () => {
    resetApi();
    renderTable([makeJob()]);

    fireEvent.contextMenu(firstRow());
    fireEvent.click(await screen.findByText(t("resumesPage.external.addFromJob")));

    expect(await screen.findByTestId("external-resume-preset-job")).toHaveTextContent("护士");
    // 岗位选择器不渲染：只在弹窗内断言（分页的「每页条数」下拉也是 combobox）。
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("combobox")).toBeNull();
  });

  it("选择模式的右键只有批量动作，不含该入口", async () => {
    resetApi();
    renderTable([makeJob()], {
      selectionMode: true,
      bulkActions: [{ key: "bulk", label: "Bulk action", onClick: noop }],
    });

    fireEvent.contextMenu(firstRow());
    expect(await screen.findByText("Bulk action")).toBeInTheDocument();
    expect(screen.queryByText(t("resumesPage.external.addFromJob"))).toBeNull();
  });

  it("上传成功后 Toast 带「查看」，点了跳到该岗位的外部简历列表", async () => {
    resetApi();
    externalResumeApi.uploadExternalResume.mockResolvedValue({
      id: 3,
      name: "cv",
      has_text: true,
    });
    renderTable([makeJob()]);

    fireEvent.contextMenu(firstRow());
    fireEvent.click(await screen.findByText(t("resumesPage.external.addFromJob")));
    await screen.findByTestId("external-resume-preset-job");

    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error("upload input missing");
    Object.defineProperty(input, "files", {
      value: [new File(["resume text"], "cv.txt", { type: "text/plain" })],
      configurable: true,
    });
    fireEvent.change(input);
    await waitFor(() => expect(screen.getByDisplayValue("cv")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: t("resumesPage.external.upload") }));

    // 关联的岗位恒为入口那一行（id 1），不依赖弹窗内的任何选择状态。
    await waitFor(() => expect(externalResumeApi.uploadExternalResume).toHaveBeenCalledTimes(1));
    expect(externalResumeApi.uploadExternalResume.mock.calls[0][1]).toEqual({
      name: "cv",
      jobId: 1,
    });
    expect(
      await screen.findByText(t("resumesPage.external.addedToJob", { name: "cv", job: "护士" })),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: t("resumesPage.external.openList") }));
    // Toast 的动作是先关卡片、再在微任务里执行回调（见 useToast 的 render），所以等一下。
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/resumes/external?job_id=1"));
  });
});
