// SPDX-License-Identifier: Apache-2.0
/**
 * 外部简历页的筛选行为：URL 深链可还原、改关键词不丢岗位筛选、零结果给明确出路、
 * 超过一页要说明「只显示最近一百条」、上传后清筛选并解释列表为什么变了。
 *
 * 这些状态手工点一遍都「看起来正常」——只有刷新、分享链接、上传之后才会暴露。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { t } from "../i18n";
import ExternalResumesPage from "./ExternalResumesPage";

const api = vi.hoisted(() => ({
  listExternalResumes: vi.fn(),
  uploadExternalResume: vi.fn(),
  deleteExternalResume: vi.fn(),
  getExternalResume: vi.fn(),
  getExternalResumeAnalysis: vi.fn(),
  externalResumeFileUrl: (id: number) => `/api/external-resumes/${id}/file`,
}));
const jobs = vi.hoisted(() => ({ listJobs: vi.fn(), getJob: vi.fn() }));
vi.mock("../api/externalResumes", () => api);
vi.mock("../api/jobs", () => jobs);
const JOB = { id: 3, title: "Agent manager", company: "Acme" };
const ITEM = {
  id: 1,
  file_id: 1,
  name: "resume.txt",
  mime: "text/plain",
  text_chars: 100,
  has_text: true,
  job_id: 3,
  job_title: JOB.title,
  warnings: [],
  created_at: "2026-11-13T00:00:00",
  updated_at: "2026-11-13T00:00:00",
};
function Location() {
  return <output data-testid="search">{useLocation().search}</output>;
}
function renderPage(search = "") {
  return render(
    <MemoryRouter initialEntries={[`/resumes/external${search}`]}>
      <AntdApp>
        <ExternalResumesPage />
        <Location />
      </AntdApp>
    </MemoryRouter>,
  );
}
beforeEach(() => {
  api.listExternalResumes.mockReset().mockResolvedValue({ items: [ITEM], total: 1 });
  api.uploadExternalResume.mockReset().mockResolvedValue({ ...ITEM, id: 2, name: "uploaded.txt" });
  jobs.listJobs.mockReset().mockResolvedValue({ items: [JOB], total: 1 });
  jobs.getJob.mockReset().mockResolvedValue(JOB);
});
afterEach(cleanup);

it("restores keyword/job deep links and filters on the server", async () => {
  renderPage("?keyword=Acme&job_id=3");
  expect(screen.getByPlaceholderText(t("resumesPage.external.searchPlaceholder"))).toHaveValue(
    "Acme",
  );
  await screen.findByText(ITEM.name);
  expect(api.listExternalResumes).toHaveBeenCalledWith({
    keyword: "Acme",
    job_id: 3,
    page_size: 100,
  });
  expect(
    screen.getByRole("combobox", { name: t("resumesPage.jobFilter.label") }).closest(".ant-select"),
  ).toHaveTextContent(JOB.title);
  expect(
    screen.getByText(t("resumesPage.external.filteredTotal", { count: 1 })),
  ).toBeInTheDocument();
});

it("changing the keyword refetches while preserving the job and unrelated URL values", async () => {
  renderPage("?job_id=3&keep=yes");
  await screen.findByText(ITEM.name);
  fireEvent.change(screen.getByPlaceholderText(t("resumesPage.external.searchPlaceholder")), {
    target: { value: "Agent" },
  });
  await waitFor(() =>
    expect(api.listExternalResumes).toHaveBeenLastCalledWith({
      keyword: "Agent",
      job_id: 3,
      page_size: 100,
    }),
  );
  expect(screen.getByTestId("search")).toHaveTextContent("keyword=Agent");
  expect(screen.getByTestId("search")).toHaveTextContent("keep=yes");
});

it("filtered zero results show a clear action instead of upload guidance", async () => {
  api.listExternalResumes.mockResolvedValue({ items: [], total: 0 });
  renderPage("?keyword=missing&job_id=3&keep=yes");
  await screen.findByText(t("resumesPage.external.noMatches"));
  expect(screen.queryByText(t("resumesPage.external.emptyHint"))).not.toBeInTheDocument();
  fireEvent.click(
    screen.getAllByRole("button", { name: t("resumesPage.external.clearFilters") })[0],
  );
  await screen.findByText(t("resumesPage.external.empty"));
  expect(screen.getByTestId("search")).toHaveTextContent("?keep=yes");
  expect(api.listExternalResumes).toHaveBeenLastCalledWith({
    keyword: undefined,
    job_id: undefined,
    page_size: 100,
  });
});

it("shows the server total and warns when only the most recent hundred are shown", async () => {
  api.listExternalResumes.mockResolvedValue({
    items: Array.from({ length: 100 }, (_, index) => ({
      ...ITEM,
      id: index + 1,
      name: `resume-${index}.txt`,
    })),
    total: 101,
  });
  renderPage();
  expect(
    await screen.findByText(t("resumesPage.external.total", { count: 101 })),
  ).toBeInTheDocument();
  expect(screen.getByText(t("resumesPage.external.limited", { count: 100 }))).toBeInTheDocument();
});

it("clears filters after upload and tells the user why the list changed", async () => {
  renderPage("?keyword=Acme&job_id=3");
  await screen.findByText(ITEM.name);
  fireEvent.click(
    screen.getByRole("button", { name: new RegExp(t("resumesPage.external.upload")) }),
  );
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", {
    value: [new File(["body"], "uploaded.txt", { type: "text/plain" })],
    configurable: true,
  });
  fireEvent.change(input);
  await screen.findByText("uploaded.txt");
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: t("resumesPage.external.upload"),
    }),
  );
  await waitFor(() => expect(api.uploadExternalResume).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByTestId("search").textContent).toBe(""));
  expect(
    await screen.findByText(t("resumesPage.external.uploadFiltersCleared")),
  ).toBeInTheDocument();
});
