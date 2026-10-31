// SPDX-License-Identifier: Apache-2.0
/** 简历风险扫描面板：挂载不请求、点开始才扫、取消、关闭再开保留结果、签名变化提示。 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { resetRiskScanStore } from "../features/resume/riskScanStore";
import ResumeRiskPanel from "./ResumeRiskPanel";

const apiMocks = vi.hoisted(() => ({ scanResumeRisks: vi.fn() }));

vi.mock("../api/resumeRisk", () => apiMocks);

/**
 * 任务地基的替身（见 `src/test/aiTaskEntryBridge.ts`）：面板验的是界面语义，
 * 轮询与通知出口由 `utils/backgroundTasks*.test.ts` 负责。
 */
vi.mock("../utils/aiTaskEntry", async () => {
  const { createAiTaskEntryBridge } = await import("../test/aiTaskEntryBridge");
  return createAiTaskEntryBridge({
    run: async (payload, signal) => {
      const resumeId = Number(payload.resume_id);
      const risk = await apiMocks.scanResumeRisks(resumeId, Boolean(payload.enhance), signal);
      // 扫描报告不入库，只随 result_ref 回来——这正是本入口与岗位解读的实质差别。
      return { resume_id: resumeId, risk_scan: risk };
    },
  });
});

const RESULT = {
  resume_id: 7,
  points: [
    {
      category: "deep_dive",
      severity: "high",
      text: "主导交易系统从0到1建设",
      location: "事实台账「主导交易系统」",
      suggestion: "这条强主张会被追问，建议准备边界与依据",
      claim_id: 42,
      follow_up: ["个人边界：团队负责整体架构，我负责撮合引擎"],
    },
    {
      category: "compliance",
      severity: "high",
      text: "保密协议",
      location: "正文",
      suggestion: "可能涉及保密信息，投递前请确认",
      claim_id: null,
      follow_up: [],
    },
  ],
  summary: { deep_dive: 1, compliance: 1 },
  remote_enhancement_available: true,
  llm_used: false,
  notes: [],
};

beforeEach(() => {
  resetRiskScanStore();
  apiMocks.scanResumeRisks.mockReset();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  resetRiskScanStore();
  document.body.innerHTML = "";
});

describe("ResumeRiskPanel", () => {
  it("opens the native list without a deprecated List console error", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      render(<ResumeRiskPanel resumeId={7} contentSignature="sig-list" />);
      expect(errors.mock.calls.flat().join(" ")).not.toContain("[antd: List]");
      expect(screen.getByRole("button", { name: "开始扫描" })).toBeInTheDocument();
    } finally {
      errors.mockRestore();
    }
  });

  it("挂载时不发请求，只显示说明卡", () => {
    render(<ResumeRiskPanel resumeId={7} contentSignature="sig-1" />);

    expect(apiMocks.scanResumeRisks).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "开始扫描" })).toBeInTheDocument();
    // 五类检查都写在说明卡里（用户点之前就该知道要查什么）。
    expect(screen.getByText("查重")).toBeInTheDocument();
    expect(screen.getByText("敏感词")).toBeInTheDocument();
    expect(screen.getByText("夸大")).toBeInTheDocument();
    expect(screen.getByText("深挖风险点")).toBeInTheDocument();
    expect(screen.getByText("合规校验")).toBeInTheDocument();
    // AI 增强开关在卡上，默认沿用本机偏好（此处为空 → 开）。
    expect(screen.getByRole("switch", { name: "AI 增强" })).toBeInTheDocument();
  });

  it("点「开始扫描」才发请求，完成后显示结果与扫描元信息", async () => {
    apiMocks.scanResumeRisks.mockResolvedValue(RESULT);
    render(<ResumeRiskPanel resumeId={7} contentSignature="sig-1" />);

    fireEvent.click(screen.getByRole("button", { name: "开始扫描" }));

    expect(await screen.findByText("共 2 条风险点")).toBeInTheDocument();
    expect(apiMocks.scanResumeRisks).toHaveBeenCalledTimes(1);
    expect(apiMocks.scanResumeRisks.mock.calls[0][0]).toBe(7);
    expect(apiMocks.scanResumeRisks.mock.calls[0][1]).toBe(true);
    // 结果与台账联动仍然照旧。
    expect(screen.getByText("主导交易系统从0到1建设")).toBeInTheDocument();
    expect(screen.getByText("事实台账 #42")).toBeInTheDocument();
    // 顶部一行「扫描于 HH:mm · 用时 Xs · 不含模型增强」。
    expect(screen.getByText(/扫描于 \d{2}:\d{2}/)).toBeInTheDocument();
    expect(screen.getByText(/用时 \d+\.\d+s/)).toBeInTheDocument();
    expect(screen.getByText(/不含模型增强/)).toBeInTheDocument();
  });

  it("扫描中可以取消，取消后回到说明卡且不显示错误", async () => {
    apiMocks.scanResumeRisks.mockImplementation(
      (_id: number, _enhance: boolean, signal?: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () =>
            reject(new ApiError("已取消", undefined, { code: "cancelled" })),
          );
        }),
    );
    render(<ResumeRiskPanel resumeId={7} />);

    fireEvent.click(screen.getByRole("button", { name: "开始扫描" }));
    expect(await screen.findByText(/正在扫描/)).toBeInTheDocument();
    expect(screen.getByText("可以关闭此窗口，扫描会继续")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /取\s*消/ }));

    expect(await screen.findByRole("button", { name: "开始扫描" })).toBeInTheDocument();
    expect(screen.queryByText("风险扫描失败")).toBeNull();
  });

  it("关闭面板再打开时直接显示上次结果（不重新请求）", async () => {
    apiMocks.scanResumeRisks.mockResolvedValue(RESULT);
    const first = render(<ResumeRiskPanel resumeId={7} contentSignature="sig-1" />);
    fireEvent.click(screen.getByRole("button", { name: "开始扫描" }));
    expect(await screen.findByText("共 2 条风险点")).toBeInTheDocument();
    first.unmount();

    render(<ResumeRiskPanel resumeId={7} contentSignature="sig-1" />);
    expect(await screen.findByText("共 2 条风险点")).toBeInTheDocument();
    // 结果来自 store：全程只请求过一次。
    expect(apiMocks.scanResumeRisks).toHaveBeenCalledTimes(1);
  });

  it("签名变化时提示「简历内容已修改，建议重新扫描」", async () => {
    apiMocks.scanResumeRisks.mockResolvedValue(RESULT);
    const view = render(<ResumeRiskPanel resumeId={7} contentSignature="sig-1" />);
    fireEvent.click(screen.getByRole("button", { name: "开始扫描" }));
    expect(await screen.findByText("共 2 条风险点")).toBeInTheDocument();
    expect(screen.queryByText("简历内容已修改，建议重新扫描")).toBeNull();

    view.rerender(<ResumeRiskPanel resumeId={7} contentSignature="sig-2" />);
    expect(await screen.findByText("简历内容已修改，建议重新扫描")).toBeInTheDocument();
  });

  it("接口报错时在说明卡上显示错误并可重试", async () => {
    apiMocks.scanResumeRisks.mockRejectedValueOnce(new ApiError("模型服务不可用", 500));
    render(<ResumeRiskPanel resumeId={7} />);

    fireEvent.click(screen.getByRole("button", { name: "开始扫描" }));

    expect(await screen.findByText("模型服务不可用")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /重\s*试/ })).toBeInTheDocument();
  });

  it("关掉 AI 增强后按 enhance=false 扫描，并记住偏好", async () => {
    apiMocks.scanResumeRisks.mockResolvedValue(RESULT);
    render(<ResumeRiskPanel resumeId={7} />);

    fireEvent.click(screen.getByRole("switch", { name: "AI 增强" }));
    expect(window.localStorage.getItem("resumeRisk.remoteEnhancement")).toBe("off");

    fireEvent.click(screen.getByRole("button", { name: "开始扫描" }));
    await waitFor(() => expect(apiMocks.scanResumeRisks).toHaveBeenCalled());
    expect(apiMocks.scanResumeRisks.mock.calls[0][1]).toBe(false);
  });
});
