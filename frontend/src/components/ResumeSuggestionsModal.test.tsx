// SPDX-License-Identifier: Apache-2.0
/**
 * ResumeSuggestionsModal：打开 ≠ 开始生成（先看说明卡）、关窗不 abort、重新生成需确认、
 * resetKey 变化清空旧建议，以及采纳建议的修订链路。
 *
 * 生成状态住在模块级 `suggestionScanStore` 里：同一个文件里的用例会共用那份单例，
 * 所以每个用例前后都要 `resetSuggestionScan()`，否则上一条的 done 结果会让弹窗直接进入结果态。
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App as AntdApp } from "antd";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ResumeSuggestionsModal from "./ResumeSuggestionsModal";
import { generateResumeSuggestions, reviseResume } from "../api/resumes";
import {
  getSuggestionScanState,
  resetSuggestionScan,
} from "../features/resume/suggestionScanStore";
import type { ResumeDetail, ResumeSuggestions } from "../types";

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

/** 第二次生成的结果：用来证明「重新生成」真的换了内容，而不是复用旧数据。 */
function regeneratedPayload(): ResumeSuggestions {
  return {
    job_id: 3,
    job_title: "前端工程师",
    company: "示例公司",
    suggestions: [
      {
        priority: "medium",
        section: "技能",
        issue: "技术栈覆盖不足",
        suggestion: "把 JD 里要求但确实掌握的框架补进技能区",
        evidence: [],
      },
    ],
  };
}

function detail(): ResumeDetail {
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
    parent_revision_id: null,
    coverage_notes: [],
  };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface Overrides {
  open?: boolean;
  recordId?: number | null;
  resetKey?: number;
  onClose?: () => void;
  onApplied?: (next: ResumeDetail) => Promise<void> | void;
}

/** 渲染弹窗，并给出一个「换 props 重渲染」的入口（关窗/改 resetKey 都靠它）。 */
function renderModal(overrides: Overrides = {}) {
  const props = { open: true, recordId: 9, onClose: vi.fn(), ...overrides };
  const view = render(
    <AntdApp>
      <ResumeSuggestionsModal {...props} />
    </AntdApp>,
  );
  const rerenderWith = (next: Overrides = {}) =>
    view.rerender(
      <AntdApp>
        <ResumeSuggestionsModal {...props} {...next} />
      </AntdApp>,
    );
  return { ...view, rerenderWith, props };
}

/** 点「开始生成」：说明卡 → scanning。 */
async function startGeneration(): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: /开始生成/ }));
  await waitFor(() => expect(mockedGenerate).toHaveBeenCalled());
}

beforeEach(() => {
  resetSuggestionScan();
  mockedGenerate.mockReset();
  mockedRevise.mockReset();
});

afterEach(() => {
  cleanup();
  resetSuggestionScan();
  document.body.innerHTML = "";
});

describe("ResumeSuggestionsModal", () => {
  it("打开只显示说明卡，点「开始生成」才调用模型", async () => {
    const pending = deferred<ResumeSuggestions>();
    mockedGenerate.mockReturnValue(pending.promise);
    renderModal();

    expect(await screen.findByText("生成岗位优化建议")).toBeInTheDocument();
    // 打开即调模型是上一版的行为，正是这一版要修掉的：说明卡阶段一次请求都不能发。
    expect(mockedGenerate).not.toHaveBeenCalled();

    await startGeneration();
    expect(mockedGenerate).toHaveBeenCalledTimes(1);
    expect(mockedGenerate.mock.calls[0][0]).toBe(9);

    await act(async () => {
      pending.resolve(suggestionsPayload());
      await pending.promise;
    });

    expect(await screen.findByText("缺少量化结果")).toBeInTheDocument();
    expect(getSuggestionScanState(9).status).toBe("done");
  });

  it("说明卡上的「取消」直接关窗（不发起生成）", async () => {
    const onClose = vi.fn();
    renderModal({ onClose });

    fireEvent.click(await screen.findByRole("button", { name: /取\s*消/ }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockedGenerate).not.toHaveBeenCalled();
  });

  it("生成中显示已用时与「可以关闭」，点「取消生成」回到说明卡", async () => {
    const pending = deferred<ResumeSuggestions>();
    mockedGenerate.mockReturnValue(pending.promise);
    renderModal();

    await startGeneration();

    expect(await screen.findByText(/正在生成建议/)).toBeInTheDocument();
    expect(screen.getByText("可以关闭此窗口，生成会继续")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /取消生成/ }));

    // 取消 = 真 abort，状态退回 idle（不是 error），界面回到说明卡。
    expect(await screen.findByText("生成岗位优化建议")).toBeInTheDocument();
    expect(getSuggestionScanState(9).status).toBe("idle");
    expect(screen.queryByText(/正在生成建议/)).toBeNull();
  });

  it("生成期间关窗不 abort 请求，重新打开直接看到结果且不重复请求", async () => {
    const pending = deferred<ResumeSuggestions>();
    mockedGenerate.mockReturnValue(pending.promise);
    const { rerenderWith } = renderModal();

    await startGeneration();
    await screen.findByText("可以关闭此窗口，生成会继续");
    const signal = mockedGenerate.mock.calls[0][1];
    expect(signal).toBeDefined();

    rerenderWith({ open: false });
    // 关窗只是卸载界面，RequestSignal 必须还活着：否则"后台继续"是假的。
    expect(signal?.aborted).toBe(false);

    await act(async () => {
      pending.resolve(suggestionsPayload());
      await pending.promise;
    });
    await waitFor(() => expect(getSuggestionScanState(9).status).toBe("done"));

    rerenderWith({ open: true });

    expect(await screen.findByText("缺少量化结果")).toBeInTheDocument();
    expect(mockedGenerate).toHaveBeenCalledTimes(1);
  });

  it("「重新生成建议」先弹确认，确认后才发起第二次调用", async () => {
    mockedGenerate
      .mockResolvedValueOnce(suggestionsPayload())
      .mockResolvedValueOnce(regeneratedPayload());
    renderModal();

    await startGeneration();
    expect(await screen.findByText("缺少量化结果")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /重新生成建议/ }));

    expect(await screen.findByText(/重新生成会再次调用模型并覆盖当前建议/)).toBeInTheDocument();
    // 只弹确认，还没真调模型——覆盖已看过的清单必须先问一句。
    expect(mockedGenerate).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "重新生成" }));

    await waitFor(() => expect(mockedGenerate).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("技术栈覆盖不足")).toBeInTheDocument();
    expect(screen.queryByText("缺少量化结果")).toBeNull();
  });

  it("resetKey 变化后清空 store，重新打开回到说明卡且不显示旧建议", async () => {
    mockedGenerate.mockResolvedValue(suggestionsPayload());
    const { rerenderWith } = renderModal({ resetKey: 0 });

    await startGeneration();
    expect(await screen.findByText("缺少量化结果")).toBeInTheDocument();
    expect(getSuggestionScanState(9).status).toBe("done");

    rerenderWith({ resetKey: 1 });

    await waitFor(() => expect(getSuggestionScanState(9).status).toBe("idle"));
    expect(await screen.findByText("生成岗位优化建议")).toBeInTheDocument();
    // 旧建议对应的是旧正文，不能留着让人对着它点「采纳」。
    expect(screen.queryByText("缺少量化结果")).toBeNull();
  });

  it("采纳建议：按建议拼出修订指令并刷新简历", async () => {
    mockedGenerate.mockResolvedValue(suggestionsPayload());
    mockedRevise.mockResolvedValue(detail());
    const onApplied = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    renderModal({ onApplied, onClose });

    await startGeneration();
    await screen.findByText("缺少量化结果");
    fireEvent.click(screen.getByRole("button", { name: /采纳并修改/ }));

    await waitFor(() => {
      expect(mockedRevise).toHaveBeenCalledTimes(1);
    });
    const [recordId, instructions] = mockedRevise.mock.calls[0];
    expect(recordId).toBe(9);
    expect(instructions).toContain("项目经历");
    expect(instructions).toContain("缺少量化结果");
    expect(instructions).toContain("在项目经历里补充可核对的数字");

    await waitFor(() => {
      expect(onApplied).toHaveBeenCalledTimes(1);
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("采纳失败保持弹窗打开并就地报错", async () => {
    mockedGenerate.mockResolvedValue(suggestionsPayload());
    mockedRevise.mockRejectedValue(new Error("修订简历失败"));
    const onClose = vi.fn();
    renderModal({ onClose, onApplied: vi.fn() });

    await startGeneration();
    await screen.findByText("缺少量化结果");
    fireEvent.click(screen.getByRole("button", { name: /采纳并修改/ }));

    expect(await screen.findByText(/修订简历失败/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    // 采纳失败不该把整份建议列表换掉：清单还在，用户可以换一条或稍后重试。
    expect(screen.getByText("缺少量化结果")).toBeInTheDocument();
  });
});
