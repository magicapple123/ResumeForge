/** 简历风险扫描面板：风险点渲染、台账联动、错误透出。 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ResumeRiskPanel from "./ResumeRiskPanel";

const apiMocks = vi.hoisted(() => ({ scanResumeRisks: vi.fn() }));

vi.mock("../api/resumeRisk", () => apiMocks);

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
  remote_enhancement_available: false,
  llm_used: false,
  notes: [],
};

beforeEach(() => {
  apiMocks.scanResumeRisks.mockReset();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ResumeRiskPanel", () => {
  it("渲染风险点、五类分组与台账联动", async () => {
    apiMocks.scanResumeRisks.mockResolvedValue(RESULT);
    render(<ResumeRiskPanel resumeId={7} />);

    expect(await screen.findByText("共 2 条风险点")).toBeInTheDocument();
    expect(screen.getByText("深挖风险点")).toBeInTheDocument();
    expect(screen.getByText("合规校验")).toBeInTheDocument();
    expect(screen.getByText("主导交易系统从0到1建设")).toBeInTheDocument();
    expect(screen.getByText("事实台账 #42")).toBeInTheDocument();
    expect(screen.getByText(/这条强主张会被追问/)).toBeInTheDocument();
    // 默认开启 AI 增强（与历史行为一致）：请求显式带上 enhance=true。
    expect(apiMocks.scanResumeRisks).toHaveBeenCalledWith(7, true);
    // 没配置模型时不显示开关（显示一个按不动的开关只会让人困惑）。
    expect(screen.queryByRole("switch", { name: "AI 增强" })).toBeNull();
  });

  // ===== RR-01：远端增强由用户显式控制 =====

  it("配置了模型时给出「AI 增强」开关，关掉后只跑本地规则", async () => {
    apiMocks.scanResumeRisks.mockResolvedValue({
      ...RESULT,
      remote_enhancement_available: true,
      llm_used: true,
    });
    render(<ResumeRiskPanel resumeId={7} />);

    expect(await screen.findByText("含模型增强")).toBeInTheDocument();
    const toggle = screen.getByRole("switch", { name: "AI 增强" });
    expect(toggle).toBeInTheDocument();
    expect(apiMocks.scanResumeRisks).toHaveBeenLastCalledWith(7, true);

    // 关掉：立刻按"只跑本地规则"重扫，并把偏好记下来（下次打开还关着）。
    apiMocks.scanResumeRisks.mockResolvedValue({ ...RESULT, remote_enhancement_available: true });
    fireEvent.click(toggle);
    await waitFor(() => expect(apiMocks.scanResumeRisks).toHaveBeenLastCalledWith(7, false));
    expect(window.localStorage.getItem("resumeRisk.remoteEnhancement")).toBe("off");
  });

  it("关掉偏好会跨会话保留（localStorage）", async () => {
    window.localStorage.setItem("resumeRisk.remoteEnhancement", "off");
    apiMocks.scanResumeRisks.mockResolvedValue({ ...RESULT, remote_enhancement_available: true });
    render(<ResumeRiskPanel resumeId={7} />);

    expect(await screen.findByText("共 2 条风险点")).toBeInTheDocument();
    expect(apiMocks.scanResumeRisks).toHaveBeenLastCalledWith(7, false);
  });

  it("接口报错时透出中文错误", async () => {
    apiMocks.scanResumeRisks.mockRejectedValue(new Error("风险扫描失败"));
    render(<ResumeRiskPanel resumeId={7} />);

    expect(await screen.findByText("风险扫描失败")).toBeInTheDocument();
  });
});
