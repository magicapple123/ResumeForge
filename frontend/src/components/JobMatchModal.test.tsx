// SPDX-License-Identifier: Apache-2.0
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job, JobMatchOut } from "../types";
import JobMatchModal from "./JobMatchModal";
import { registerNotifyHost } from "../utils/taskNotify";
import { endMatchAnalysis } from "../utils/jobMatchAnalysisState";
import { resetBackgroundTasks, tickBackgroundTasks } from "../utils/backgroundTasks";
import type { AiTaskSnapshot } from "../types";
import { t } from "../i18n";

/** 失败原因用 ASCII：它只是"后端给的原因原样展示"这条链路的载荷。 */
const FAIL_REASON = "model call timed out";

const apiMocks = vi.hoisted(() => ({
  getJobMatch: vi.fn(),
  deleteJobMatch: vi.fn(),
}));

vi.mock("../api/jobs", () => ({
  getJobMatch: apiMocks.getJobMatch,
  deleteJobMatch: apiMocks.deleteJobMatch,
}));

/**
 * 通用 AI 任务端点。本组件不再直接等模型返回：它**建任务**，然后由统一登记表
 * （`utils/backgroundTasks`）轮询状态。这里替身化端点，用例用 `tickBackgroundTasks()`
 * 手动推进一轮，避免依赖真实 1.5s 定时器。
 */
const aiMocks = vi.hoisted(() => ({
  createAiTask: vi.fn(),
  getAiTask: vi.fn(),
  cancelAiTask: vi.fn(),
  listActiveAiTasks: vi.fn(),
}));

vi.mock("../api/aiTasks", () => ({
  createAiTask: aiMocks.createAiTask,
  getAiTask: aiMocks.getAiTask,
  cancelAiTask: aiMocks.cancelAiTask,
  listActiveAiTasks: aiMocks.listActiveAiTasks,
}));

vi.mock("../utils/notifySound", () => ({
  playDoneSound: vi.fn(),
}));

const notices: { title: string; kind?: string; description?: string; hasActions?: boolean }[] = [];

/** 一座任务快照（后端 `/ai-tasks` 的形状）。 */
function taskSnapshot(overrides: Partial<AiTaskSnapshot> = {}): AiTaskSnapshot {
  return {
    id: 5,
    kind: "job_match",
    status: "running",
    progress: 30,
    label: "适配「后端开发」",
    message: "正在调用模型分析匹配度",
    result_ref: null,
    error: "",
    created_at: "2026-10-28T00:00:00",
    started_at: "2026-10-28T00:00:00",
    finished_at: null,
    ...overrides,
  };
}

const JOB: Job = {
  id: 12,
  title: "后端开发",
  company: "示例科技",
  location: "北京",
  salary: "20-30K",
  job_type: "社招",
  description: "负责后端服务开发。",
  requirements: "熟悉 Python；本科及以上学历。",
  additional_info: "",
  keywords: [],
  source: "BOSS直聘",
  source_url: "https://www.zhipin.com/job/12",
  posted_at: "",
  status: "开放中",
  note: "",
  note_images: [],
  recognition_source: "岗位采集",
  origin_source: "岗位采集",
  favorite: false,
  created_at: "2026-09-17T08:00:00",
  updated_at: "2026-09-17T08:00:00",
};

const ANALYZED: JobMatchOut = {
  id: 5,
  job_id: 12,
  job_title: "后端开发",
  company: "示例科技",
  result: {
    hard_conditions: [
      {
        label: "本科及以上",
        jd_quote: "本科及以上学历",
        status: "matched",
        evidence: "本科",
      },
      {
        label: "硕士及以上",
        jd_quote: "本科及以上学历",
        status: "real_gap",
        evidence: "资料中未提供",
      },
    ],
    core_abilities: [
      {
        label: "熟悉 Python",
        jd_quote: "熟悉 Python",
        status: "expression_gap",
        evidence: "Python 出现在技能表",
      },
    ],
    bonus_items: [
      {
        label: "有开源经历",
        jd_quote: "",
        status: "evidence_insufficient",
        evidence: "资料中未提供",
      },
    ],
    hard_gate: "unmet",
    admission: "block",
    advice: "该岗位存在真实缺口，建议先补足后再投。",
    notes: ["团队成果不计入个人能力。"],
  },
  hard_gate: "unmet",
  requires_confirm: true,
  model: "demo-model",
  created_at: "2026-09-17T08:00:00",
  updated_at: "2026-09-17T08:00:00",
  reference_score: {
    score: 62,
    dimensions: [
      { key: "skills", label: "技能覆盖", score: 75, weight: 0.3, evidence: "命中 3/4 个关键词" },
      { key: "seniority", label: "年限", score: 50, weight: 0.2, evidence: "" },
    ],
    disclaimer:
      "本参考分由本地规则估算，仅供展示与自我评估，不代表真实 ATS 解析结果或投递成功概率；投递准入仍以五类匹配结论为准。",
  },
};

const NOT_ANALYZED: JobMatchOut = {
  id: 0,
  job_id: 12,
  job_title: "后端开发",
  company: "示例科技",
  result: {
    hard_conditions: [],
    core_abilities: [],
    bonus_items: [],
    hard_gate: "unknown",
    admission: "needs_confirm",
    advice: "",
    notes: [],
  },
  hard_gate: "unknown",
  requires_confirm: false,
  model: "",
  created_at: "2026-09-17T08:00:00",
  updated_at: "2026-09-17T08:00:00",
  reference_score: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  resetBackgroundTasks();
  apiMocks.getJobMatch.mockResolvedValue(NOT_ANALYZED);
  aiMocks.listActiveAiTasks.mockResolvedValue([]);
  aiMocks.createAiTask.mockResolvedValue(taskSnapshot());
  aiMocks.getAiTask.mockResolvedValue(taskSnapshot());
  aiMocks.cancelAiTask.mockResolvedValue(taskSnapshot({ status: "canceled" }));
  notices.length = 0;
  registerNotifyHost({
    notification: {
      success: (config) =>
        notices.push({
          title: String(config.title),
          description: String(config.description ?? ""),
          hasActions: config.actions !== undefined,
        }),
      warning: (config) =>
        notices.push({
          title: String(config.title),
          kind: "warning",
          description: String(config.description ?? ""),
        }),
      error: (config) =>
        notices.push({
          title: String(config.title),
          kind: "error",
          description: String(config.description ?? ""),
        }),
      info: (config) => notices.push({ title: String(config.title) }),
    },
    modal: { info: (config) => notices.push({ title: String(config.title), kind: "modal" }) },
  });
});

afterEach(() => {
  registerNotifyHost(null);
  resetBackgroundTasks();
  endMatchAnalysis(JOB.id);
  cleanup();
  document.body.innerHTML = "";
});

describe("JobMatchModal", () => {
  it("offers to start an analysis when the job has none yet", async () => {
    render(
      <AntdApp>
        <JobMatchModal job={JOB} onClose={vi.fn()} />
      </AntdApp>,
    );

    expect(await screen.findByText("这个岗位还没有做过匹配分析")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /开始分析/ })).toBeInTheDocument();
  });

  it("renders the five-way taxonomy, admission and hard gate as plain states", async () => {
    apiMocks.getJobMatch.mockResolvedValue(ANALYZED);

    render(
      <AntdApp>
        <JobMatchModal job={JOB} onClose={vi.fn()} />
      </AntdApp>,
    );

    expect(await screen.findByText("已匹配")).toBeInTheDocument();
    expect(screen.getByText("表达缺口")).toBeInTheDocument();
    expect(screen.getByText("证据不足")).toBeInTheDocument();
    expect(screen.getByText("真实缺口")).toBeInTheDocument();
    expect(screen.getByText("不投")).toBeInTheDocument();
    expect(screen.getByText("硬性条件未满足")).toBeInTheDocument();
    // **五类结论**是不带评分的：整套结论区里不能出现百分比 / 百分号。
    // （「匹配度参考分」是另一个区块、且强制带免责，它的分数是 0–100 的整数、同样不写成 %。）
    expect(document.body.textContent ?? "").not.toContain("%");
  });

  it("渲染匹配度参考分：总分 + 分项 + 后端下发的免责文案", async () => {
    apiMocks.getJobMatch.mockResolvedValue(ANALYZED);

    render(
      <AntdApp>
        <JobMatchModal job={JOB} onClose={vi.fn()} />
      </AntdApp>,
    );

    expect(await screen.findByText("匹配度参考分")).toBeInTheDocument();
    expect(screen.getByText("技能覆盖")).toBeInTheDocument();
    expect(screen.getByText("命中 3/4 个关键词")).toBeInTheDocument();
    // 免责文案来自后端，必须原样展示——这是"参考分不能被当成结论"的唯一保底。
    expect(
      screen.getByText(/仅供展示与自我评估，不代表真实 ATS 解析结果或投递成功概率/),
    ).toBeInTheDocument();
  });

  it("没有参考分时不渲染该区块", async () => {
    apiMocks.getJobMatch.mockResolvedValue({ ...ANALYZED, reference_score: null });

    render(
      <AntdApp>
        <JobMatchModal job={JOB} onClose={vi.fn()} />
      </AntdApp>,
    );

    expect(await screen.findByText("已匹配")).toBeInTheDocument();
    expect(screen.queryByText("匹配度参考分")).toBeNull();
  });

  it("发起分析 = 建任务（不再用一条 HTTP 连接等模型跑完）", async () => {
    apiMocks.getJobMatch.mockResolvedValue(ANALYZED);

    render(
      <AntdApp>
        <JobMatchModal job={JOB} onClose={vi.fn()} />
      </AntdApp>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /重新分析/ }));

    await waitFor(() => expect(aiMocks.createAiTask).toHaveBeenCalled());
    // 已有结论时带 force=true：与后端"不重算已有结论"的语义对齐。
    expect(aiMocks.createAiTask).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "job_match",
        payload: { job_id: JOB.id, force: true },
      }),
    );
  });

  it("shows a friendly error with a retry action", async () => {
    apiMocks.getJobMatch.mockRejectedValue(new Error("资料为空，请先完善个人资料"));

    render(
      <AntdApp>
        <JobMatchModal job={JOB} onClose={vi.fn()} />
      </AntdApp>,
    );

    expect(await screen.findByText("资料为空，请先完善个人资料")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /重试/ })).toBeInTheDocument();
  });

  it("任务完成后走统一出口提醒（带「查看岗位」深链），并刷新结论", async () => {
    render(
      <AntdApp>
        <JobMatchModal job={JOB} onClose={vi.fn()} />
      </AntdApp>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /开始分析/ }));
    await waitFor(() => expect(aiMocks.createAiTask).toHaveBeenCalled());

    // 后端把任务跑到成功：登记表下一秒就会看到（这里手动推进一轮，不等 1.5s）。
    aiMocks.getAiTask.mockResolvedValue(
      taskSnapshot({ status: "succeeded", progress: 100, result_ref: { job_id: JOB.id } }),
    );
    await tickBackgroundTasks();

    await waitFor(() =>
      expect(notices.some((item) => item.title === "岗位适配度分析完成")).toBe(true),
    );
    const notice = notices.find((item) => item.title === "岗位适配度分析完成");
    // 深链被消费成动作按钮：点它就是 /jobs?job_id=<id>（由 taskDeepLinks 生成）。
    expect(notice?.hasActions).toBe(true);
    // 人还在窗口前：完成后重新拉取最新结论（挂载一次 + 完成一次）。
    await waitFor(() => expect(apiMocks.getJobMatch).toHaveBeenCalledTimes(2));
  });

  it("任务失败：错误原因落回弹窗，同时发一条 error 提醒", async () => {
    render(
      <AntdApp>
        <JobMatchModal job={JOB} onClose={vi.fn()} />
      </AntdApp>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /开始分析/ }));
    await waitFor(() => expect(aiMocks.createAiTask).toHaveBeenCalled());

    aiMocks.getAiTask.mockResolvedValue(taskSnapshot({ status: "failed", error: FAIL_REASON }));
    await tickBackgroundTasks();

    await waitFor(() =>
      expect(
        notices.some((item) => item.title === "岗位适配度分析失败" && item.kind === "error"),
      ).toBe(true),
    );
    expect(await screen.findByText(FAIL_REASON)).toBeInTheDocument();
  });

  it("进行中可以取消：调 /ai-tasks 的 cancel，回到可再次分析的状态", async () => {
    render(
      <AntdApp>
        <JobMatchModal job={JOB} onClose={vi.fn()} />
      </AntdApp>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /开始分析/ }));
    await waitFor(() => expect(aiMocks.createAiTask).toHaveBeenCalled());
    // 取消按钮只在任务进行中显示（它是"真取消"，不是"关掉弹窗"）。
    fireEvent.click(await screen.findByRole("button", { name: /取消分析/ }));

    await waitFor(() => expect(aiMocks.cancelAiTask).toHaveBeenCalledWith(5));
    // 用户自己取消的：不弹错误（文案取自语言包，避免把中文写进 ByText 字面量）。
    expect(document.body.textContent ?? "").not.toContain(t("jobMatch.error.cancelFailed"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /开始分析/ })).toBeInTheDocument(),
    );
  });

  it("分析进行中关掉弹窗：任务在后台继续，完成时仍提醒并可跳回岗位", async () => {
    const onClose = vi.fn();
    render(
      <AntdApp>
        <JobMatchModal job={JOB} onClose={onClose} />
      </AntdApp>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /开始分析/ }));
    await waitFor(() => expect(aiMocks.createAiTask).toHaveBeenCalled());
    // 关掉弹窗 ≠ 取消：任务留在登记表里继续被轮询（页头任务面板也能看到它）。
    // 用 antd 关闭按钮的类名定位：进行中提示条里那颗「取消分析」的图标按钮
    // 无障碍名同样含 close，按名字查会命中两个。
    const closeButton = document.querySelector(".ant-modal-close");
    expect(closeButton).not.toBeNull();
    fireEvent.click(closeButton as HTMLElement);
    expect(onClose).toHaveBeenCalled();

    aiMocks.getAiTask.mockResolvedValue(
      taskSnapshot({ status: "succeeded", progress: 100, result_ref: { job_id: JOB.id } }),
    );
    await tickBackgroundTasks();

    await waitFor(() =>
      expect(notices.some((item) => item.title === "岗位适配度分析完成")).toBe(true),
    );
    const notice = notices.find((item) => item.title === "岗位适配度分析完成");
    // 弹窗仍挂在页面上（onClose 只是父组件的开关），"界面在看"的声明还在，故用卡片；
    // 卡片同样挂深链按钮。
    expect(notice?.hasActions).toBe(true);
  });
});
