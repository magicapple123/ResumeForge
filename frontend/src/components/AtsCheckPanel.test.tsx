/** ATS 本地检测面板：免责声明、三类结论、JD 关键词覆盖、分项分数、建议与载入 JD。 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App as AntdApp } from "antd";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AtsCheckPanel from "./AtsCheckPanel";

const apiMocks = vi.hoisted(() => ({ runAtsCheck: vi.fn(), getJob: vi.fn() }));

vi.mock("../api/ats", () => ({ runAtsCheck: apiMocks.runAtsCheck }));
vi.mock("../api/jobs", () => ({ getJob: apiMocks.getJob }));

const RESULT = {
  resume_id: 7,
  issues: [
    {
      category: "format",
      severity: "high",
      title: "缺少姓名",
      detail: "姓名缺失会被 ATS 判为不合格",
      evidence: [],
      suggestion: "在简历顶部补上真实姓名",
    },
    {
      category: "position",
      severity: "medium",
      title: "缺少求职意向",
      detail: "求职意向应放在顶部",
      evidence: [],
      suggestion: "加一行「求职意向：后端开发工程师」",
    },
    {
      category: "keyword",
      severity: "medium",
      title: "关键词覆盖不足",
      detail: "有 1 个常见关键词未命中",
      evidence: ["Python"],
      suggestion: "把真正掌握的缺失词写进技能区",
    },
  ],
  matched_keywords: ["MySQL"],
  missing_keywords: ["Python"],
  score: 76,
  disclaimer: "本地规则估计，不代表真实 ATS 解析结果",
  summary: { format: 1, position: 1, keyword: 1 },
  subscores: { format: 88, keyword: 70, position: 64 },
  coverage_ratio: 0.5,
  keyword_hits: [
    { keyword: "MySQL", matched: true, count: 3, sections: ["skills"] },
    { keyword: "Python", matched: false, count: 0, sections: [] },
  ],
};

function renderPanel(props: { resumeId: number; jobId?: number }) {
  return render(
    <AntdApp>
      <AtsCheckPanel {...props} />
    </AntdApp>,
  );
}

beforeEach(() => {
  apiMocks.runAtsCheck.mockReset();
  apiMocks.getJob.mockReset();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("AtsCheckPanel", () => {
  it("渲染免责声明与三类结论", async () => {
    apiMocks.runAtsCheck.mockResolvedValue(RESULT);
    renderPanel({ resumeId: 7 });

    expect(await screen.findByText("本地规则估计，不代表真实 ATS 解析结果")).toBeInTheDocument();
    expect(screen.getByText("缺少姓名")).toBeInTheDocument();
    expect(screen.getByText("缺少求职意向")).toBeInTheDocument();
    expect(screen.getByText("关键词覆盖不足")).toBeInTheDocument();
    expect(screen.getByText("MySQL ×3")).toBeInTheDocument();
    expect(screen.getAllByText("Python").length).toBeGreaterThan(0);
    expect(apiMocks.runAtsCheck).toHaveBeenCalledWith(7, "");
  });

  it("分数旁显示三个分项与关键词覆盖率", async () => {
    apiMocks.runAtsCheck.mockResolvedValue(RESULT);
    renderPanel({ resumeId: 7 });

    expect(await screen.findByText("本地规则估计，不代表真实 ATS 解析结果")).toBeInTheDocument();
    expect(screen.getByText("关键词覆盖率 50%")).toBeInTheDocument();
    // 三个分项各自一条 Progress：格式 88 / 关键词 70 / 位置 64（加上总分的圆环共 4 条）。
    const values = screen
      .getAllByRole("progressbar")
      .map((node) => Number(node.getAttribute("aria-valuenow")));
    expect(values).toContain(88);
    expect(values).toContain(70);
    expect(values).toContain(64);
    expect(values).toContain(76);
  });

  it("每条问题都展示改进建议", async () => {
    apiMocks.runAtsCheck.mockResolvedValue(RESULT);
    renderPanel({ resumeId: 7 });

    expect(await screen.findByText("在简历顶部补上真实姓名")).toBeInTheDocument();
    expect(screen.getByText("把真正掌握的缺失词写进技能区")).toBeInTheDocument();
  });

  it("填写 JD 后点击检测按 JD 重新检测", async () => {
    apiMocks.runAtsCheck.mockResolvedValue(RESULT);
    renderPanel({ resumeId: 7 });
    await screen.findByText("本地规则估计，不代表真实 ATS 解析结果");

    fireEvent.change(screen.getByLabelText("JD 文本"), {
      target: { value: "要求熟悉 Python" },
    });
    fireEvent.click(screen.getByRole("button", { name: /开始检测/ }));

    expect(await screen.findByText("本地规则估计，不代表真实 ATS 解析结果")).toBeInTheDocument();
    expect(apiMocks.runAtsCheck).toHaveBeenCalledWith(7, "要求熟悉 Python");
  });

  it("JD 输入有 50000 字硬上限，顶到上限时出现提示（不使用 showCount 计数器）", async () => {
    apiMocks.runAtsCheck.mockResolvedValue(RESULT);
    renderPanel({ resumeId: 7 });

    const jd = screen.getByLabelText("JD 文本") as HTMLTextAreaElement;
    // 上限与后端 AtsCheckRequest.jd_text 的 max_length（50_000）对齐。
    expect(jd.maxLength).toBe(50000);

    fireEvent.change(jd, { target: { value: "好".repeat(50000) } });
    expect(await screen.findByText("已达 50000 字上限")).toBeInTheDocument();
    // 常驻计数器（antd showCount 的「N/50000」）在全仓禁用。
    expect(screen.queryByText(/\d+\s*\/\s*50000/)).not.toBeInTheDocument();
  });

  it("没有关联岗位时不显示「从关联岗位载入 JD」", async () => {
    apiMocks.runAtsCheck.mockResolvedValue(RESULT);
    renderPanel({ resumeId: 7 });

    await screen.findByText("本地规则估计，不代表真实 ATS 解析结果");
    expect(screen.queryByRole("button", { name: /从关联岗位载入 JD/ })).toBeNull();
  });

  it("从关联岗位载入 JD：填入输入框但不自动检测", async () => {
    apiMocks.runAtsCheck.mockResolvedValue(RESULT);
    apiMocks.getJob.mockResolvedValue({
      id: 5,
      title: "后端开发工程师",
      description: "负责后端服务开发与性能优化",
      requirements: "熟悉 Python 与 MySQL",
    });
    renderPanel({ resumeId: 7, jobId: 5 });

    await screen.findByText("本地规则估计，不代表真实 ATS 解析结果");
    fireEvent.click(screen.getByRole("button", { name: /从关联岗位载入 JD/ }));

    await waitFor(() => expect(apiMocks.getJob).toHaveBeenCalledWith(5));
    const jd = screen.getByLabelText("JD 文本") as HTMLTextAreaElement;
    await waitFor(() => expect(jd.value).toBe("负责后端服务开发与性能优化\n熟悉 Python 与 MySQL"));
    // 「载入」只填不跑：整个过程仍然只有挂载时那一次检测。
    expect(apiMocks.runAtsCheck).toHaveBeenCalledTimes(1);
  });

  it("复制改进清单：把标题与建议拼成文本写进剪贴板", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    apiMocks.runAtsCheck.mockResolvedValue(RESULT);
    renderPanel({ resumeId: 7 });

    await screen.findByText("本地规则估计，不代表真实 ATS 解析结果");
    fireEvent.click(screen.getByRole("button", { name: /复制改进清单/ }));

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const text = writeText.mock.calls[0][0] as string;
    expect(text).toContain("缺少姓名");
    expect(text).toContain("建议：在简历顶部补上真实姓名");
    expect(await screen.findByText("改进清单已复制")).toBeInTheDocument();
  });
});
