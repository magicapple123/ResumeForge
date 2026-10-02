/** ResumeSuggestionsModal：建议列表的采纳链路（调修订接口 → 刷新回调 → 关闭）。 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App as AntdApp } from "antd";
import { afterEach, describe, expect, it, vi } from "vitest";
import ResumeSuggestionsModal from "./ResumeSuggestionsModal";
import { generateResumeSuggestions, reviseResume } from "../api/resumes";
import type { ResumeSuggestions } from "../types";

vi.mock("../api/resumes", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  generateResumeSuggestions: vi.fn(),
  reviseResume: vi.fn(),
}));

const mockedGenerate = vi.mocked(generateResumeSuggestions);
const mockedRevise = vi.mocked(reviseResume);

function suggestionsPayload(): ResumeSuggestions {
  return {
    job_id: 3,
    job_title: "前端工程师",
    company: "示例公司",
    suggestions: [
      {
        priority: "high",
        section: "项目经历",
        issue: "缺少量化结果",
        suggestion: "在项目经历里补充可核对的数字",
        evidence: ["JD 要求具备数据驱动经验"],
      },
    ],
  };
}

function detail(): Parameters<
  NonNullable<Parameters<typeof ResumeSuggestionsModal>[0]["onApplied"]>
>[0] {
  return {
    id: 9,
    title: "示例简历",
    job_id: 3,
    job_title: "前端工程师",
    company: "示例公司",
    source: "ai",
    favorite: false,
    model: "",
    enhancement_enabled: false,
    enhancement_level: "balanced",
    note: "",
    template: "classic",
    format_name: "",
    format_config: {},
    page_limit: 1,
    font_scale: "standard",
    created_at: "2026-10-01T10:00:00",
    content: {} as never,
    warnings: [],
    parse_error: "",
    rationale: "",
    coverage_notes: [],
  };
}

describe("ResumeSuggestionsModal", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("adopts a suggestion by revising the resume with its formatted instruction", async () => {
    mockedGenerate.mockResolvedValue(suggestionsPayload());
    mockedRevise.mockResolvedValue(detail());
    const onApplied = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(
      <AntdApp>
        <ResumeSuggestionsModal open recordId={9} onClose={onClose} onApplied={onApplied} />
      </AntdApp>,
    );

    await screen.findByText("缺少量化结果");
    fireEvent.click(screen.getByRole("button", { name: /采纳并修改/ }));

    await waitFor(() => {
      expect(mockedRevise).toHaveBeenCalledTimes(1);
    });
    const [recordId, instructions] = vi.mocked(mockedRevise).mock.calls[0];
    expect(recordId).toBe(9);
    expect(instructions).toContain("项目经历");
    expect(instructions).toContain("缺少量化结果");
    expect(instructions).toContain("在项目经历里补充可核对的数字");
    await waitFor(() => {
      expect(onApplied).toHaveBeenCalledTimes(1);
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps the modal open and shows the error when the revision fails", async () => {
    mockedGenerate.mockResolvedValue(suggestionsPayload());
    mockedRevise.mockRejectedValue(new Error("修订简历失败"));
    const onClose = vi.fn();
    render(
      <AntdApp>
        <ResumeSuggestionsModal open recordId={9} onClose={onClose} onApplied={vi.fn()} />
      </AntdApp>,
    );

    await screen.findByText("缺少量化结果");
    fireEvent.click(screen.getByRole("button", { name: /采纳并修改/ }));

    expect(await screen.findByText(/修订简历失败/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
