import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App as AntdApp } from "antd";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job, JobAnalysisResult } from "../types";
import JobAnalysisModal from "./JobAnalysisModal";

const apiMocks = vi.hoisted(() => ({ generateJobAnalysis: vi.fn(), getJobAnalysis: vi.fn() }));

vi.mock("../api/jobs", () => ({
  generateJobAnalysis: apiMocks.generateJobAnalysis,
  getJobAnalysis: apiMocks.getJobAnalysis,
}));

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

beforeEach(() => {
  apiMocks.generateJobAnalysis.mockReset().mockResolvedValue(ANALYSIS);
  apiMocks.getJobAnalysis.mockReset().mockResolvedValue({
    cached: false,
    stale: false,
    generated_at: null,
    result: null,
  });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

/** R2：打开弹窗不再自动调模型，必须先点「开始生成」。 */
function start() {
  fireEvent.click(screen.getByRole("button", { name: /开始生成/ }));
}

/** antd `App` 提供 message/notification 的上下文；组件里的「停止等待」提示依赖它。 */
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

describe("JobAnalysisModal", () => {
  it("先说明再生成：打开时一次请求都不发，点「开始生成」才调用模型", async () => {
    renderModal();

    expect(screen.getByText(/会把岗位描述交给模型/)).toBeInTheDocument();
    expect(apiMocks.generateJobAnalysis).not.toHaveBeenCalled();

    start();

    // 首次生成**不带** force：后端已有缓存时会直接返回，不必再跑一次模型（R2-a）。
    expect(apiMocks.generateJobAnalysis).toHaveBeenCalledWith(JOB.id, expect.anything(), false);
    expect(await screen.findByText(ANALYSIS.summary)).toBeInTheDocument();
    expect(screen.getByText("核心要求")).toBeInTheDocument();
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

  it("「停止等待」只停界面：不 abort 在途请求，关掉弹窗并提示后台会缓存（R2-b）", async () => {
    let signalCaptured: AbortSignal | undefined;
    // 永不 resolve 的请求：模拟还在等模型。拿到 signal 才能断言"没有被 abort"。
    apiMocks.generateJobAnalysis.mockImplementation((_id: number, signal?: AbortSignal) => {
      signalCaptured = signal;
      return new Promise(() => undefined);
    });

    render(
      <AntdApp>
        <ClosableModal />
      </AntdApp>,
    );
    start();

    fireEvent.click(await screen.findByRole("button", { name: "停止等待" }));

    // 关键：连接没断——服务端才能跑完并写缓存，下次打开秒读。
    expect(signalCaptured).toBeDefined();
    expect(signalCaptured?.aborted).toBe(false);

    // 提示出现，且说明是"后台仍会完成"而不是"已取消"。
    expect(
      await screen.findByText("已停止等待。后台仍会完成本次生成并缓存，下次打开可直接查看。"),
    ).toBeInTheDocument();

    // 弹窗真的关掉了（父级把 job 置空），不是只把加载动画藏起来。
    expect(await screen.findByText("岗位解读已关闭")).toBeInTheDocument();
    expect(screen.queryByText(/生成失败/)).not.toBeInTheDocument();
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
