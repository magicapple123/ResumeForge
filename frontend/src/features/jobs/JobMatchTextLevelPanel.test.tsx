// SPDX-License-Identifier: Apache-2.0
/**
 * 文本级匹配面板（T34）：外部简历正文对 JD。
 *
 * 钉四件事（对应验收的三条 + 一条"不许静默失败"）：
 *
 * 1. **只列外部简历**，且没有正文的那份**选不到**（不是选了再报错）；
 * 2. **UI 明确标「文本级」**：标题与徽标都在，用户不会把它当成结构化匹配的结论；
 * 3. **结果只来自正文口径**：计数、词表、正文摘录都按后端返回原样渲染；
 * 4. **后端说不行时如实展示**：400 的 detail 原样上屏，不能退化成"没有结果"。
 *
 * 断言文案一律走 `t()`：本仓库的中文棘轮对测试里的 `ByText("中文")` 同样计数。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import type { ExternalResumeItem } from "../../api/externalResumes";
import type { TextLevelMatch } from "./jobMatchTextLevelApi";
import JobMatchTextLevelPanel from "./JobMatchTextLevelPanel";

const listMocks = vi.hoisted(() => ({ listExternalResumes: vi.fn() }));
const matchMocks = vi.hoisted(() => ({ matchJobTextLevel: vi.fn() }));

vi.mock("../../api/externalResumes", () => ({
  listExternalResumes: listMocks.listExternalResumes,
}));
vi.mock("./jobMatchTextLevelApi", () => ({ matchJobTextLevel: matchMocks.matchJobTextLevel }));

/** 一份外部简历列表项（只写本面板读到的字段）。 */
function resumeItem(overrides: Partial<ExternalResumeItem> = {}): ExternalResumeItem {
  return {
    id: 7,
    file_id: 70,
    name: "cv-alpha.pdf",
    mime: "application/pdf",
    text_chars: 1200,
    has_text: true,
    job_id: null,
    job_title: "",
    created_at: "2026-01-01T00:00:00",
    updated_at: "2026-01-01T00:00:00",
    warnings: [],
    ...overrides,
  };
}

/** 一次文本级结果（形状与后端 schema 逐字一致）。 */
function matchResult(overrides: Partial<TextLevelMatch> = {}): TextLevelMatch {
  return {
    method: "text_level",
    job_id: 3,
    job_title: "Backend Engineer",
    company: "Example",
    external_resume_id: 7,
    resume_name: "cv-alpha.pdf",
    text_chars: 1200,
    target_words: ["Python", "Redis", "Kubernetes"],
    matched_words: ["Python", "Redis"],
    missing_words: ["Kubernetes"],
    core_target: ["Python", "Redis"],
    core_matched: ["Python", "Redis"],
    supplementary_target: ["Kubernetes"],
    supplementary_matched: [],
    target_count: 3,
    matched_count: 2,
    highlights: [
      { text: "Built services in Python with Redis caching.", words: ["Python", "Redis"] },
    ],
    notes: ["caliber note from the server"],
    generated_at: "2026-01-02T00:00:00",
    ...overrides,
  };
}

function renderPanel() {
  return render(
    <AntdApp>
      <JobMatchTextLevelPanel jobId={3} />
    </AntdApp>,
  );
}

/** 打开下拉（antd 用 mouseDown 触发，click 在 jsdom 里不展开）。 */
function openDropdown() {
  fireEvent.mouseDown(screen.getByRole("combobox"));
}

/** 点中一份外部简历（按文件名找，文案可能带「（无正文）」后缀）。 */
async function pickResume(name: string) {
  fireEvent.click(await screen.findByText(new RegExp(name.replace(/\W/g, "\\$&"))));
}

beforeEach(() => {
  listMocks.listExternalResumes.mockReset();
  matchMocks.matchJobTextLevel.mockReset();
  listMocks.listExternalResumes.mockResolvedValue({
    items: [resumeItem(), resumeItem({ id: 4, name: "scan.pdf", has_text: false, text_chars: 0 })],
    total: 2,
    page: 1,
    page_size: 100,
  });
});

afterEach(cleanup);

describe("JobMatchTextLevelPanel：文本级口径", () => {
  it("标出「文本级」并说明口径，与结构化匹配区分开", async () => {
    renderPanel();
    await waitFor(() => expect(listMocks.listExternalResumes).toHaveBeenCalled());
    expect(screen.getByText(t("jobMatch.textLevel.title"))).toBeInTheDocument();
    expect(screen.getByText(t("jobMatch.textLevel.badge"))).toBeInTheDocument();
    expect(screen.getByText(t("jobMatch.textLevel.intro"))).toBeInTheDocument();
  });

  it("没有正文的外部简历在下拉里就禁用，选了也不会发请求", async () => {
    renderPanel();
    await waitFor(() => expect(listMocks.listExternalResumes).toHaveBeenCalled());
    openDropdown();
    const option = await screen.findByText(/scan\.pdf/);
    const row = option.closest(".ant-select-item-option");
    expect(row).not.toBeNull();
    expect(row?.className).toContain("ant-select-item-option-disabled");
    fireEvent.click(option);
    expect(matchMocks.matchJobTextLevel).not.toHaveBeenCalled();
  });

  it("灰掉的那几份在面板上常驻说明原因与怎么办，不是只藏在悬停里", async () => {
    renderPanel();
    expect(
      await screen.findByText(t("jobMatch.textLevel.resume.someNoText")),
    ).toBeInTheDocument();
  });

  it("选中一份后按后端返回渲染计数、词表与正文摘录", async () => {
    matchMocks.matchJobTextLevel.mockResolvedValue(matchResult());
    renderPanel();
    await waitFor(() => expect(listMocks.listExternalResumes).toHaveBeenCalled());
    openDropdown();
    await pickResume("cv-alpha.pdf");

    await waitFor(() => expect(matchMocks.matchJobTextLevel).toHaveBeenCalledWith(3, 7));
    expect(
      await screen.findByText(t("jobMatch.textLevel.coverageValue", { matched: 2, target: 3 })),
    ).toBeInTheDocument();
    expect(screen.getByText("Python")).toBeInTheDocument();
    expect(screen.getByText("Kubernetes")).toBeInTheDocument();
    expect(screen.getByText(/Built services in Python/)).toBeInTheDocument();
    // 后端写好的口径说明原样展示（不是前端自己编的一句话）。
    expect(screen.getByText("caliber note from the server")).toBeInTheDocument();
  });

  it("后端说这份没有正文时如实展示原因，而不是显示空结果", async () => {
    matchMocks.matchJobTextLevel.mockRejectedValue(new Error("no text layer"));
    renderPanel();
    await waitFor(() => expect(listMocks.listExternalResumes).toHaveBeenCalled());
    openDropdown();
    await pickResume("cv-alpha.pdf");

    expect(await screen.findByText(/no text layer/)).toBeInTheDocument();
    expect(screen.queryByText(t("jobMatch.textLevel.coverage"))).toBeNull();
  });

  it("一份有正文的外部简历都没有时给出可照做的提示", async () => {
    listMocks.listExternalResumes.mockResolvedValue({
      items: [resumeItem({ id: 4, name: "scan.pdf", has_text: false, text_chars: 0 })],
      total: 1,
      page: 1,
      page_size: 100,
    });
    renderPanel();
    expect(await screen.findByText(t("jobMatch.textLevel.resume.empty"))).toBeInTheDocument();
  });
});
