// SPDX-License-Identifier: Apache-2.0
/** 从链接导入弹窗：预览四态/勾选/编辑 → 分批补详情（进度与失败）→ 导入与仅补空字段。 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import type { FromUrlDetailsResult, FromUrlPreview, FromUrlRow } from "./importFromUrlApi";
import { ImportFromUrlModal } from "./ImportFromUrlModal";

const previewFromUrl = vi.fn();
const fetchRowDetails = vi.fn();
const commitFromUrl = vi.fn();

vi.mock("./importFromUrlApi", () => ({
  previewFromUrl: (...args: unknown[]) => previewFromUrl(...args),
  fetchRowDetails: (...args: unknown[]) => fetchRowDetails(...args),
  commitFromUrl: (...args: unknown[]) => commitFromUrl(...args),
}));

const URL = "https://jobs.example.com/campus/position";
// 后端返回的告警/错误是服务端文案，测试里作为**数据**（不是断言的界面文案）保存。
const WARNING = "这一页共 3 条，本次最多导入 2 条";
const FETCH_ERROR = "抓取超时（5 秒），页面可能太慢或需要登录";
const TITLE_A = "后端开发工程师";
const TITLE_B = "前端开发工程师";

function row(overrides: Partial<FromUrlRow> = {}): FromUrlRow {
  const detail = "https://jobs.example.com/campus/position/1";
  return {
    data: {
      title: TITLE_A,
      company: "示例科技",
      location: "北京",
      salary: "25-40K",
      job_type: "校招",
      status: "开放中",
      posted_at: "2026-10-30",
      source_url: detail,
    },
    detail_url: detail,
    summary: "后端开发工程师 示例科技 北京 25-40K",
    evidence: {},
    field_states: {
      title: "filled",
      company: "filled",
      location: "filled",
      salary: "filled",
      job_type: "filled",
      status: "filled",
      posted_at: "filled",
      source_url: "filled",
      description: "not_fetched",
      requirements: "not_fetched",
      additional_info: "not_fetched",
    },
    detail_error: "",
    posted_at_raw: "",
    posted_at_inferred: false,
    job_type_inferred: true,
    jd_split: false,
    existing_job_id: null,
    ...overrides,
  };
}

function buildPreview(): FromUrlPreview {
  return {
    url: URL,
    engine: "http",
    method: "rules",
    fetched_on: "2026-11-11",
    total: 2,
    pages_requested: 1,
    pages_fetched: 1,
    truncated: false,
    stop_reason: "no_next",
    rows: [
      row(),
      row({
        data: {
          ...row().data,
          title: TITLE_B,
          company: "示例网络",
          location: "上海",
          salary: "20-35K",
        },
        detail_url: "https://jobs.example.com/campus/position/2",
        summary: "前端开发工程师 示例网络 上海 20-35K",
        existing_job_id: 7,
      }),
    ],
    warnings: [WARNING],
  };
}

function Harness({ onImported = vi.fn() }: { onImported?: () => void }) {
  return (
    <AntdApp>
      <ImportFromUrlModal open onClose={vi.fn()} onImported={onImported} />
    </AntdApp>
  );
}

function fillUrl(value = URL) {
  fireEvent.change(screen.getByPlaceholderText("粘贴招聘页面或岗位详情的链接（http/https）"), {
    target: { value },
  });
}

async function fetchPreview() {
  render(<Harness />);
  fillUrl();
  fireEvent.click(screen.getByRole("button", { name: "抓取并预览" }));
  // 岗位名是表格里的 Input（可编辑），不是纯文本。
  await screen.findByDisplayValue(TITLE_A);
}

beforeEach(() => {
  previewFromUrl.mockReset();
  fetchRowDetails.mockReset();
  commitFromUrl.mockReset();
  previewFromUrl.mockResolvedValue(buildPreview());
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ImportFromUrlModal 预览", () => {
  it("抓取后显示来源 URL、原文摘要、四态与已在库标记", async () => {
    await fetchPreview();
    expect(previewFromUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        url: URL,
        engine: "auto",
        limit: 0,
        intent: "job_list",
        pages: 1,
      }),
    );
    // 原文摘要（防幻觉）与来源链接都在行里。
    expect(screen.getByText(row().summary)).toBeInTheDocument();
    expect(screen.getAllByText(/jobs\.example\.com\/campus\/position/).length).toBeGreaterThan(0);
    // 详情没抓：显示「待补详情」，不是「页面未提供」。
    expect(screen.getAllByText(t("jobsImport.tag.detailPending")).length).toBeGreaterThan(0);
    expect(screen.getByText(t("jobsImport.tag.existing"))).toBeInTheDocument();
    expect(screen.getByText(WARNING)).toBeInTheDocument();
    expect(screen.getByText(t("jobsImport.preview.total", { count: 2 }))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导入 2 条" })).toBeEnabled();
  });

  it("编辑行内容后导入：提交的是编辑后的值", async () => {
    commitFromUrl.mockResolvedValue({ imported: 2, updated: 0, skipped: [], failed: [] });
    const onImported = vi.fn();
    render(<Harness onImported={onImported} />);
    fillUrl();
    fireEvent.click(screen.getByRole("button", { name: "抓取并预览" }));
    const titleInput = await screen.findByDisplayValue(TITLE_A);
    fireEvent.change(titleInput, { target: { value: "后端开发工程师（已改）" } });
    fireEvent.click(screen.getByRole("button", { name: "导入 2 条" }));
    await waitFor(() => expect(commitFromUrl).toHaveBeenCalled());
    const [rowsArg, fillEmptyOnly] = commitFromUrl.mock.calls[0] as [FromUrlRow[], boolean];
    expect(rowsArg).toHaveLength(2);
    expect(rowsArg[0].data.title).toBe("后端开发工程师（已改）");
    expect(fillEmptyOnly).toBe(false);
    await waitFor(() => expect(onImported).toHaveBeenCalled());
  });

  it("取消勾选的行不会被导入", async () => {
    commitFromUrl.mockResolvedValue({ imported: 1, updated: 0, skipped: [], failed: [] });
    await fetchPreview();
    const checkboxes = screen.getAllByRole("checkbox");
    // 第 0 个是表头全选；取消第二行。
    fireEvent.click(checkboxes[2]);
    fireEvent.click(screen.getByRole("button", { name: "导入 1 条" }));
    await waitFor(() => expect(commitFromUrl).toHaveBeenCalled());
    const [rowsArg] = commitFromUrl.mock.calls[0] as [FromUrlRow[]];
    expect(rowsArg).toHaveLength(1);
    expect(rowsArg[0].data.title).toBe(TITLE_A);
  });

  it("有已在库的行时可选「仅补空字段」并传给后端", async () => {
    commitFromUrl.mockResolvedValue({ imported: 0, updated: 1, skipped: [], failed: [] });
    await fetchPreview();
    fireEvent.click(screen.getByRole("radio", { name: "仅补空字段" }));
    fireEvent.click(screen.getByRole("button", { name: "导入 2 条" }));
    await waitFor(() => expect(commitFromUrl).toHaveBeenCalled());
    expect(commitFromUrl.mock.calls[0][1]).toBe(true);
  });
});

describe("ImportFromUrlModal 补详情", () => {
  it("分批补齐详情：成功行显示已区分职责/要求，失败行显示原因", async () => {
    commitFromUrl.mockResolvedValue({ imported: 2, updated: 0, skipped: [], failed: [] });
    const failedStates = {
      ...row().field_states,
      description: "fetch_failed" as const,
      requirements: "fetch_failed" as const,
      additional_info: "fetch_failed" as const,
    };
    const updated: FromUrlDetailsResult = {
      rows: [
        row({
          field_states: {
            ...row().field_states,
            description: "filled",
            requirements: "filled",
            additional_info: "not_on_page",
          },
          jd_split: true,
        }),
        row({
          detail_url: "https://jobs.example.com/campus/position/2",
          field_states: failedStates,
          detail_error: "这个详情页打不开",
        }),
      ],
      warnings: [],
    };
    fetchRowDetails.mockResolvedValue(updated);
    await fetchPreview();
    fireEvent.click(screen.getByRole("button", { name: "补齐详情（2 条）" }));
    await waitFor(() => expect(fetchRowDetails).toHaveBeenCalled());
    // 一批 ≤5 条：2 条一次请求。
    expect((fetchRowDetails.mock.calls[0][0] as FromUrlRow[]).length).toBe(2);
    expect(await screen.findByText(t("jobsImport.tag.jdSplit"))).toBeInTheDocument();
    expect(await screen.findByText(t("jobsImport.tag.detailFailed"))).toBeInTheDocument();
    expect(
      await screen.findByText(t("jobsImport.toast.detailFailed", { count: 1 })),
    ).toBeInTheDocument();
  });

  it("没有待补详情的行时按钮不可点", async () => {
    previewFromUrl.mockResolvedValue({
      ...buildPreview(),
      rows: [
        row({
          field_states: {
            ...row().field_states,
            description: "filled",
            requirements: "filled",
            additional_info: "not_on_page",
          },
        }),
      ],
      total: 1,
    });
    await fetchPreview();
    expect(screen.getByRole("button", { name: "补齐详情（0 条）" })).toBeDisabled();
  });
});

describe("ImportFromUrlModal 错误与条数", () => {
  it("抓取失败时显示后端给的原因", async () => {
    previewFromUrl.mockRejectedValue(new Error(FETCH_ERROR));
    render(<Harness />);
    fillUrl();
    fireEvent.click(screen.getByRole("button", { name: "抓取并预览" }));
    expect(await screen.findByText(FETCH_ERROR)).toBeInTheDocument();
  });

  it("填了条数就把它传给后端（不预设条数）", async () => {
    render(<Harness />);
    fillUrl();
    fireEvent.change(screen.getAllByRole("spinbutton")[0], { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "抓取并预览" }));
    await waitFor(() => expect(previewFromUrl).toHaveBeenCalledTimes(1));
    expect(previewFromUrl.mock.calls[0][0].limit).toBe(10);
  });

  it("未填写链接时不发请求并给出提示", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "抓取并预览" }));
    expect(await screen.findByText(t("jobsImport.error.urlRequired"))).toBeInTheDocument();
    expect(previewFromUrl).not.toHaveBeenCalled();
  });
});
describe("ImportFromUrlModal 分页（#16 收尾）", () => {
  it("抓取页数默认 1，改成 3 后传给后端", async () => {
    render(<Harness />);
    fillUrl();
    const spinbuttons = screen.getAllByRole("spinbutton");
    // 第 0 个是导入条数，第 1 个是抓取页数。
    fireEvent.change(spinbuttons[1], { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "抓取并预览" }));
    await waitFor(() => expect(previewFromUrl).toHaveBeenCalledTimes(1));
    expect(previewFromUrl.mock.calls[0][0].pages).toBe(3);
  });

  it("多页结果如实显示「共抓取 N/M 页」，达到页数上限时给出截断提示", async () => {
    previewFromUrl.mockResolvedValue({
      ...buildPreview(),
      pages_requested: 2,
      pages_fetched: 2,
      truncated: true,
      stop_reason: "limit",
    });
    await fetchPreview();
    expect(
      screen.getByText(t("jobsImport.preview.pages", { fetched: 2, requested: 2 })),
    ).toBeInTheDocument();
    expect(
      screen.getByText(t("jobsImport.notice.truncatedLimit", { fetched: 2, requested: 2 })),
    ).toBeInTheDocument();
  });

  it("第 2 页抓取失败时说明已保留前 1 页", async () => {
    previewFromUrl.mockResolvedValue({
      ...buildPreview(),
      pages_requested: 2,
      pages_fetched: 1,
      truncated: true,
      stop_reason: "http_error",
      warnings: ["抓取第 2 页失败，已保留前 1 页：页面返回 HTTP 500，抓不到内容"],
    });
    await fetchPreview();
    expect(
      screen.getByText(t("jobsImport.notice.truncatedHttpError", { fetched: 1 })),
    ).toBeInTheDocument();
    // 第一页的行仍然在（不整体回滚）。
    expect(screen.getByDisplayValue(TITLE_A)).toBeInTheDocument();
  });
});
