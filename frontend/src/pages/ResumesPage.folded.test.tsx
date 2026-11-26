// SPDX-License-Identifier: Apache-2.0
/**
 * CR-33 折叠视图的页面级验收：同一岗位多版本时折成一行、展开后能选到具体版本。
 *
 * ## 为什么改成"按行结构断言"（2026-11-26 #2 返工）
 *
 * 方案 A 把组行第一列拆成了**两个节点**：主行是「岗位名（链接）」按钮，紧跟着一个
 * `versionCount` chip（`resumeGroupedColumns.tsx` 的 `groupIdentity`）。旧用例断言的是
 * 已退役的整串 key `resumes.list.group.title`（「{job} · {count} 个版本」），于是两条
 * 正向用例变红、而第三条的**负向** `toBeNull()` 反而恒真——用废弃 key 断言"不存在"，
 * 永远都成立，等于折叠这件事没人守。
 *
 * 现在一律断言**用户能看到的结构**：
 * - 组行 = `tr[data-row-key="job:17"]`（`job:` / `resume:` 前缀是 `resumeGroups` 的契约）；
 * - 主身份 `.rf-group-identity-name` 与版本数 chip `.rf-group-count` **分别**断言；
 * - 负向断言指向"平铺态没有折叠表、也没有任何 `job:` / `resume:` 组行"这个真实结构。
 *
 * 文案一律走 `t()`，不写死中文（i18n 棘轮）。分组口径本身在 `resumeGroups.test.ts` 里测。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n";
import { TEMPLATE_CATALOG } from "../test/resumeFixtures";
import type { ResumeBrief } from "../types";
import ResumesPage from "./ResumesPage";
import { EXPANDED_GROUPS_KEY } from "../features/resume/list/expandedGroups";

const apiMocks = vi.hoisted(() => ({
  deleteResume: vi.fn(),
  batchDeleteResumes: vi.fn(),
  listResumes: vi.fn(),
  listResumeIds: vi.fn(),
  updateResumeFavorite: vi.fn(),
  getResume: vi.fn(),
  fetchResumePreviewHtml: vi.fn(),
  renderResume: vi.fn(),
}));

vi.mock("../api/resumes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/resumes")>()),
  deleteResume: apiMocks.deleteResume,
  batchDeleteResumes: apiMocks.batchDeleteResumes,
  listResumes: apiMocks.listResumes,
  listResumeIds: apiMocks.listResumeIds,
  updateResumeFavorite: apiMocks.updateResumeFavorite,
  getResume: apiMocks.getResume,
  fetchResumePreviewHtml: apiMocks.fetchResumePreviewHtml,
  renderResume: apiMocks.renderResume,
  updateResume: vi.fn(),
  fetchResumeTemplates: vi.fn().mockResolvedValue(TEMPLATE_CATALOG),
}));

vi.mock("../features/resume/preview/ResumeDetailPreview", () => ({
  default: () => <div data-testid="resume-preview-stub" />,
}));

const jobMocks = vi.hoisted(() => ({ listJobs: vi.fn(), getJob: vi.fn() }));

vi.mock("../api/jobs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/jobs")>()),
  listJobs: jobMocks.listJobs,
  getJob: jobMocks.getJob,
}));

function brief(overrides: Partial<ResumeBrief> & { id: number }): ResumeBrief {
  return {
    title: `简历 ${overrides.id}`,
    job_id: null,
    job_title: "",
    company: "星海智能",
    source: "manual",
    favorite: false,
    note: "",
    model: "",
    enhancement_enabled: false,
    enhancement_level: "balanced",
    template: "classic",
    format_name: "",
    format_config: {},
    page_limit: 1,
    font_scale: "standard",
    created_at: "2026-11-01T08:00:00",
    updated_at: "2026-11-01T08:00:00",
    ...overrides,
  };
}

const JOB = "前沿部署工程师";
/** 多版本组的行 key（`resumeGroups` 的契约：`job:<job_id>` / `resume:<resume_id>`）。 */
const JOB_ROW_KEY = "job:17";
/** 通用简历（无 job_id）自成一行的 key。 */
const GENERAL_ROW_KEY = "resume:4";

/** 同一岗位 3 个版本 + 1 份通用简历：应折成 2 行。 */
const ITEMS: ResumeBrief[] = [
  brief({
    id: 1,
    title: `${JOB}-v1`,
    job_id: 17,
    job_title: JOB,
    delivery_count: 4,
    updated_at: "2026-11-01T08:00:00",
  }),
  brief({
    id: 2,
    title: `${JOB}-v2`,
    job_id: 17,
    job_title: JOB,
    delivery_count: 4,
    updated_at: "2026-11-20T08:00:00",
  }),
  brief({
    id: 3,
    title: `${JOB}-v3`,
    job_id: 17,
    job_title: JOB,
    delivery_count: 4,
    updated_at: "2026-11-10T08:00:00",
  }),
  brief({ id: 4, title: "通用简历", job_id: null, job_title: "软件开发" }),
];

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/resumes"]}>
      <AntdApp>
        <ResumesPage />
      </AntdApp>
    </MemoryRouter>,
  );
}

/** 当前页所有组行的 key（按渲染顺序）。 */
function groupRowKeys(container: HTMLElement): string[] {
  return [...container.querySelectorAll<HTMLElement>("tbody tr[data-row-key]")].map(
    (row) => row.getAttribute("data-row-key") ?? "",
  );
}

/** 等目标组行出现并返回它。 */
async function findGroupRow(container: HTMLElement, rowKey: string): Promise<HTMLElement> {
  return waitFor(() => {
    const row = container.querySelector<HTMLElement>(`tbody tr[data-row-key="${rowKey}"]`);
    if (!row) throw new Error(`group row not rendered: ${rowKey}`);
    return row;
  });
}

beforeEach(() => {
  window.localStorage.clear();
  apiMocks.listResumes.mockReset().mockResolvedValue({ items: ITEMS, total: ITEMS.length });
  apiMocks.listResumeIds.mockReset().mockResolvedValue(ITEMS.map((item) => item.id));
  apiMocks.updateResumeFavorite.mockReset().mockResolvedValue({});
  apiMocks.deleteResume.mockReset().mockResolvedValue(undefined);
  apiMocks.batchDeleteResumes.mockReset().mockResolvedValue({ deleted: 0 });
  apiMocks.getResume.mockReset();
  apiMocks.fetchResumePreviewHtml.mockReset();
  apiMocks.renderResume.mockReset();
  jobMocks.listJobs.mockReset().mockResolvedValue({ items: [], total: 0 });
  jobMocks.getJob.mockReset();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ResumesPage 版本堆叠（CR-33）", () => {
  it("同一岗位的 3 个版本折成一行：主行是岗位名 + 版本数 chip，行上给出最近更新与投递次数", async () => {
    const { container } = renderPage();

    const row = await findGroupRow(container, JOB_ROW_KEY);

    // 3 份同一岗位的简历只占一行；这一页共 2 行（1 个多版本岗位 + 1 份通用简历）。
    expect(container.querySelectorAll(`tbody tr[data-row-key="${JOB_ROW_KEY}"]`)).toHaveLength(1);
    expect(groupRowKeys(container)).toEqual([JOB_ROW_KEY, GENERAL_ROW_KEY]);

    // 第一列是**两节点**：主行岗位名（链接）+ 版本数 chip。分别断言，不拼成一整串。
    expect(row.querySelector(".rf-group-identity-main .rf-group-identity-name")?.textContent).toBe(
      JOB,
    );
    expect(row.querySelector(".rf-group-identity-main .rf-group-count")?.textContent).toBe(
      t("resumesPage.list.group.versionCount", { count: 3 }),
    );

    // 投递次数是**组级聚合**：3 个版本各 4 次，组上显示 4 次而不是 12。
    expect(
      within(row).getByText(t("resumesPage.list.group.deliveryCount", { count: 4 })),
    ).toBeInTheDocument();

    // 折叠态下没有任何版本行（版本只在展开区出现）。
    expect(container.querySelectorAll(".resume-version-row")).toHaveLength(0);
  });

  it("展开后能逐版操作：点「展开 3 个版本」出现 3 条版本行，每版一个收藏按钮", async () => {
    const { container } = renderPage();
    const row = await findGroupRow(container, JOB_ROW_KEY);

    // 展开入口在操作列（主行岗位名是"去岗位广场"的链接，不是展开）。
    fireEvent.click(
      within(row).getByRole("button", {
        name: t("resumesPage.list.group.expandVersions", { count: 3 }),
      }),
    );
    await waitFor(() => expect(container.querySelectorAll(".resume-version-row")).toHaveLength(3));

    // 版本行按更新时间倒序：v2（11-20）→ v3（11-10）→ v1（11-01）。
    const titles = [...container.querySelectorAll<HTMLElement>(".resume-version-title")].map(
      (node) => node.textContent,
    );
    expect(titles).toEqual([`${JOB}-v2`, `${JOB}-v3`, `${JOB}-v1`]);

    // 展开区里每一版一个收藏按钮；组行本身没有「整组收藏」这种动作。
    const list = container.querySelector<HTMLElement>(".resume-version-list");
    if (!list) throw new Error("expanded group must render a version list");
    expect(
      within(list).getAllByRole("button", { name: t("resumes.list.favoriteAdd") }),
    ).toHaveLength(3);

    // 展开状态按 `job:17` 这个组 key 持久化。
    await waitFor(() =>
      expect(window.localStorage.getItem(EXPANDED_GROUPS_KEY)).toContain(JOB_ROW_KEY),
    );
  });

  it("只在有同岗位多版本时才折叠；全是不重复的记录时保持平铺（没有任何组行）", async () => {
    const flatTitles = ["简历 A", "简历 B"];
    const flat = flatTitles.map((title, index) => brief({ id: index + 1, title }));
    apiMocks.listResumes.mockResolvedValue({ items: flat, total: flat.length });
    const { container } = renderPage();

    // 平铺视图照旧：两条记录各占一行，行 key 是简历 id。
    await findGroupRow(container, "1");
    expect(groupRowKeys(container)).toEqual(["1", "2"]);

    // 负向断言指向**真实结构**：平铺态根本没有折叠表，也没有任何 `job:` / `resume:` 组行。
    // （旧写法用已退役的 `resumes.list.group.title` 做 toBeNull，恒真、等于没守。）
    expect(container.querySelector(".resume-group-table")).toBeNull();
    expect(container.querySelector('tbody tr[data-row-key^="job:"]')).toBeNull();
    expect(container.querySelector('tbody tr[data-row-key^="resume:"]')).toBeNull();
  });
});
