// SPDX-License-Identifier: Apache-2.0
/**
 * 岗位解读弹窗（T1 语义）：**取消 = 真 abort**，**后台继续 = detach 后继续跑**。
 *
 * 旧语义是「停止等待」（不断连接），那条断言已被 T1 明确替换：用户点「取消」时
 * 请求必须真的中断，否则服务端还会把整段生成跑完、继续烧 token。
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App as AntdApp } from "antd";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job, JobAnalysisResult } from "../types";
import { resetJobAnalysisStoreForTests } from "../features/jobs/jobAnalysisStore";
import JobAnalysisModal from "./JobAnalysisModal";

const apiMocks = vi.hoisted(() => ({ generateJobAnalysis: vi.fn(), getJobAnalysis: vi.fn() }));

vi.mock("../api/jobs", () => ({
  generateJobAnalysis: apiMocks.generateJobAnalysis,
  getJobAnalysis: apiMocks.getJobAnalysis,
}));

const noticeMocks = vi.hoisted(() => ({
  announceBackgroundResult: vi.fn(),
  announceBackgroundFailure: vi.fn(),
}));

// 通知出口换成替身：这里只断言"用户走了才通知"，不测通知长什么样。
vi.mock("../utils/backgroundTask", () => noticeMocks);

const JOB: Job = {
  id: 12,
  title: "护士",
  company: "示例医院",
  location: "杭州",
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
  created_at: "2026-08-20T09:00:00",
  updated_at: "2026-08-20T09:00:00",
};

const ANALYSIS: JobAnalysisResult = {
  summary: "岗位重点是病区护理与执业资格。",
  requirements: [
    {
      priority: "high",
      category: "职业资质",
      requirement: "持有护士执业资格证",
      evidence: "持有护士执业资格证。",
    },
  ],
  advice: [
    {
      title: "突出临床能力",
      action: "在简历中说明病区实习和护理操作经验。",
      rationale: "岗位职责直接涉及病区护理。",
    },
  ],
};

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

beforeEach(() => {
  resetJobAnalysisStoreForTests();
  apiMocks.generateJobAnalysis.mockReset().mockResolvedValue(ANALYSIS);
  apiMocks.getJobAnalysis.mockReset().mockResolvedValue({
    cached: false,
    stale: false,
    generated_at: null,
    result: null,
  });
  noticeMocks.announceBackgroundResult.mockReset();
  noticeMocks.announceBackgroundFailure.mockReset();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  resetJobAnalysisStoreForTests();
  vi.useRealTimers();
});

/** R2：打开弹窗不再自动调模型，必须先点「开始生成」。 */
function start() {
  fireEvent.click(screen.getByRole("button", { name: /开始生成/ }));
}

/** antd `App` 提供 message/notification 的上下文；取消提示依赖它。 */
function renderModal(onClose: () => void = vi.fn()) {
  return render(
    <AntdApp>
      <JobAnalysisModal job={JOB} onClose={onClose} />
    </AntdApp>,
  );
}

/** 真实父级的样子：`onClose` 把 job 置空 → Modal 的 open 变 false。 */
function ClosableModal() {
  const [job, setJob] = useState<Job | null>(JOB);
  return (
    <>
      <span>{job ? "岗位解读打开中" : "岗位解读已关闭"}</span>
      <JobAnalysisModal job={job} onClose={() => setJob(null)} />
    </>
  );
}

function renderClosable() {
  return render(
    <AntdApp>
      <ClosableModal />
    </AntdApp>,
  );
}

describe("JobAnalysisModal", () => {
  it("先说明再生成：打开时一次请求都不发，点「开始生成」才调用模型", async () => {
    renderModal();

    expect(screen.getByText(/会把岗位描述交给模型/)).toBeInTheDocument();
    expect(apiMocks.generateJobAnalysis).not.toHaveBeenCalled();

    start();

    // 首次生成**不带** force：后端已有缓存时会直接返回，不必再跑一次模型（R2-a）。
    expect(apiMocks.generateJobAnalysis).toHaveBeenCalledWith(JOB.id, expect.anything(), false);
    expect(await screen.findByText(ANALYSIS.summary)).toBeInTheDocument();
    expect(screen.getByText("核心需求")).toBeInTheDocument();
    expect(screen.getByText("持有护士执业资格证")).toBeInTheDocument();
    expect(screen.getByText("突出临床能力")).toBeInTheDocument();
  });

  it("失败时给出原因，并可以重新生成", async () => {
    apiMocks.generateJobAnalysis
      .mockRejectedValueOnce(new Error("模型暂时不可用"))
      .mockResolvedValueOnce(ANALYSIS);

    renderModal();
    start();

    expect(await screen.findByText("模型暂时不可用")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重新生成解读" }));

    expect(await screen.findByText(ANALYSIS.summary)).toBeInTheDocument();
    expect(apiMocks.generateJobAnalysis).toHaveBeenCalledTimes(2);
  });

  it("「取消」真的中断请求：abort 置真、回到初始态、提示结果不保存", async () => {
    const pending = deferred<JobAnalysisResult>();
    let signal: AbortSignal | undefined;
    apiMocks.generateJobAnalysis.mockImplementation((_id: number, nextSignal?: AbortSignal) => {
      signal = nextSignal;
      return pending.promise;
    });

    renderModal();
    start();

    fireEvent.click(await screen.findByRole("button", { name: "取消生成本次解读" }));

    // 关键：连接真的断了（服务端据此取消生成），而不是只关掉加载动画。
    expect(signal?.aborted).toBe(true);
    expect(await screen.findByText("已取消，本次生成结果不会保存")).toBeInTheDocument();
    // 回到初始态：还能再点「开始生成」，也没有残留的计时文案。
    expect(screen.getByRole("button", { name: /开始生成/ })).toBeInTheDocument();
    expect(screen.queryByText(/已生成 \d+ 秒/)).not.toBeInTheDocument();
    expect(screen.queryByText(/生成失败/)).not.toBeInTheDocument();
  });

  it("「后台继续」关闭弹窗但不断开连接，完成后弹通知而不是回填弹窗", async () => {
    const pending = deferred<JobAnalysisResult>();
    let signal: AbortSignal | undefined;
    apiMocks.generateJobAnalysis.mockImplementation((_id: number, nextSignal?: AbortSignal) => {
      signal = nextSignal;
      return pending.promise;
    });

    renderClosable();
    start();

    fireEvent.click(await screen.findByRole("button", { name: "后台继续" }));

    expect(signal?.aborted).toBe(false);
    expect(await screen.findByText("岗位解读已关闭")).toBeInTheDocument();

    act(() => {
      pending.resolve(ANALYSIS);
    });

    // 结果不往已关闭的弹窗里回填，改走统一通知。
    await waitFor(() => expect(noticeMocks.announceBackgroundResult).toHaveBeenCalledOnce());
    expect(screen.queryByText(ANALYSIS.summary)).not.toBeInTheDocument();
  });

  it("生成中显示「已生成 N 秒」，让用户知道还要等", async () => {
    vi.useFakeTimers();
    const pending = deferred<JobAnalysisResult>();
    apiMocks.generateJobAnalysis.mockReturnValue(pending.promise);

    renderModal();
    start();

    expect(screen.getByText("已生成 0 秒")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByText("已生成 3 秒")).toBeInTheDocument();
  });

  it("生成中的右上角关闭等价于「后台继续」：不 abort，任务留着跑", async () => {
    const pending = deferred<JobAnalysisResult>();
    let signal: AbortSignal | undefined;
    apiMocks.generateJobAnalysis.mockImplementation((_id: number, nextSignal?: AbortSignal) => {
      signal = nextSignal;
      return pending.promise;
    });

    renderClosable();
    start();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(await screen.findByText("岗位解读已关闭")).toBeInTheDocument();
    expect(signal?.aborted).toBe(false);
  });

  it("有缓存时直接显示，不再调用模型（R2）", async () => {
    apiMocks.getJobAnalysis.mockResolvedValue({
      cached: true,
      stale: false,
      generated_at: "2026-10-19T10:00:00+08:00",
      result: ANALYSIS,
    });

    renderModal();

    expect(await screen.findByText(ANALYSIS.summary)).toBeInTheDocument();
    expect(apiMocks.generateJobAnalysis).not.toHaveBeenCalled();
  });

  it("岗位内容改过时显示「可能过期」，但旧结果仍然可读（R2）", async () => {
    apiMocks.getJobAnalysis.mockResolvedValue({
      cached: true,
      stale: true,
      generated_at: "2026-10-19T10:00:00+08:00",
      result: ANALYSIS,
    });

    renderModal();

    expect(await screen.findByText("岗位内容改过，这份解读可能已过期")).toBeInTheDocument();
    expect(screen.getByText(ANALYSIS.summary)).toBeInTheDocument();
  });

  it("重新生成需要二次确认（会覆盖当前结果）", async () => {
    const updated = { ...ANALYSIS, summary: "第二次生成的岗位总结。" };
    apiMocks.generateJobAnalysis.mockResolvedValueOnce(ANALYSIS).mockResolvedValueOnce(updated);

    renderModal();
    start();

    expect(await screen.findByText(ANALYSIS.summary)).toBeInTheDocument();
    expect(apiMocks.generateJobAnalysis).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "重新生成" }));
    // 确认前不发请求。
    expect(apiMocks.generateJobAnalysis).toHaveBeenCalledTimes(1);

    const confirm = await waitFor(() => {
      const button = document.querySelector<HTMLButtonElement>(".ant-popconfirm .ant-btn-primary");
      if (!button) throw new Error("未找到确认按钮");
      return button;
    });
    fireEvent.click(confirm);

    expect(await screen.findByText(updated.summary)).toBeInTheDocument();
    expect(apiMocks.generateJobAnalysis).toHaveBeenCalledTimes(2);
  });

  it("「重新生成」带 force=true，普通生成不带（否则缓存永远用不上 / 永远不更新）", async () => {
    const updated = { ...ANALYSIS, summary: "重新生成后的结论。" };
    apiMocks.generateJobAnalysis.mockResolvedValueOnce(ANALYSIS).mockResolvedValueOnce(updated);

    renderModal();
    start();
    expect(await screen.findByText(ANALYSIS.summary)).toBeInTheDocument();
    // 第一次：普通生成，允许后端直接给缓存。
    expect(apiMocks.generateJobAnalysis).toHaveBeenNthCalledWith(
      1,
      JOB.id,
      expect.anything(),
      false,
    );

    fireEvent.click(screen.getByRole("button", { name: "重新生成" }));
    const confirm = await waitFor(() => {
      const button = document.querySelector<HTMLButtonElement>(".ant-popconfirm .ant-btn-primary");
      if (!button) throw new Error("未找到确认按钮");
      return button;
    });
    fireEvent.click(confirm);

    expect(await screen.findByText(updated.summary)).toBeInTheDocument();
    // 第二次：用户明确要求覆盖当前结论，必须绕过缓存。
    expect(apiMocks.generateJobAnalysis).toHaveBeenNthCalledWith(
      2,
      JOB.id,
      expect.anything(),
      true,
    );
  });

  it("生成失败后重试不带 force：失败说明没有可用的缓存，没必要多烧一次", async () => {
    apiMocks.generateJobAnalysis
      .mockRejectedValueOnce(new Error("模型暂时不可用"))
      .mockResolvedValueOnce(ANALYSIS);

    renderModal();
    start();
    expect(await screen.findByText("模型暂时不可用")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "重新生成解读" }));

    expect(await screen.findByText(ANALYSIS.summary)).toBeInTheDocument();
    expect(apiMocks.generateJobAnalysis).toHaveBeenNthCalledWith(
      2,
      JOB.id,
      expect.anything(),
      false,
    );
  });
});
