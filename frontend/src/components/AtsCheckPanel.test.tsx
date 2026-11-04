// SPDX-License-Identifier: Apache-2.0
/** ATS 本地检测面板：不自动检测、空态、免责声明、三类结论、JD 关键词覆盖、分项分数、
 * 建议与关联岗位 JD 自动载入、操作行布局（开始检测与重新载入同一行）。 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App as AntdApp } from "antd";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n";
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

/** 没有 JD 的结果形状：没有关键词分项、没有覆盖率、没有参考分。 */
const RESULT_WITHOUT_JD = {
  ...RESULT,
  issues: RESULT.issues.filter((issue) => issue.category !== "keyword"),
  matched_keywords: [],
  missing_keywords: [],
  score: null,
  summary: { format: 1, position: 1, keyword: 0 },
  subscores: { format: 88, position: 64 },
  coverage_ratio: null,
  keyword_hits: [],
};

/** getJob 的返回：面板只用 description + requirements 拼 JD 文本。 */
function jobPayload(
  description = "负责后端服务开发与性能优化",
  requirements = "熟悉 Python 与 MySQL",
) {
  return { id: 5, title: "后端开发工程师", description, requirements };
}

const JOB_JD = "负责后端服务开发与性能优化\n熟悉 Python 与 MySQL";

function renderPanel(props: { resumeId: number; jobId?: number }) {
  return render(
    <AntdApp>
      <AtsCheckPanel {...props} />
    </AntdApp>,
  );
}

const runButton = () => screen.getByRole("button", { name: t("atsCheck.action.run") });

beforeEach(() => {
  apiMocks.runAtsCheck.mockReset();
  apiMocks.getJob.mockReset();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("AtsCheckPanel", () => {
  it("挂载后一次都不请求检测：JD 还没到、用户也还没点", () => {
    renderPanel({ resumeId: 7 });
    expect(apiMocks.runAtsCheck).not.toHaveBeenCalled();
  });

  it("首屏只有一行空态提示：没有分数环、没有关键词清单", () => {
    renderPanel({ resumeId: 7 });

    expect(screen.getByText(t("atsCheck.emptyHint.withoutJd"))).toBeInTheDocument();
    expect(screen.queryAllByRole("progressbar")).toEqual([]);
    expect(screen.queryByText(t("atsCheck.keywords.missing"))).toBeNull();
    expect(screen.queryByText(t("atsCheck.score.label"))).toBeNull();
  });

  it("点「开始检测」才发起请求，并携带输入框里的 JD", async () => {
    apiMocks.runAtsCheck.mockResolvedValue(RESULT);
    renderPanel({ resumeId: 7 });

    fireEvent.change(screen.getByLabelText(t("atsCheck.jd.label")), {
      target: { value: "要求熟悉 Python" },
    });
    expect(screen.getByText(t("atsCheck.emptyHint.withJd"))).toBeInTheDocument();

    fireEvent.click(runButton());

    expect(await screen.findByText(RESULT.disclaimer)).toBeInTheDocument();
    expect(apiMocks.runAtsCheck).toHaveBeenCalledTimes(1);
    expect(apiMocks.runAtsCheck).toHaveBeenCalledWith(7, "要求熟悉 Python");
  });

  it("渲染免责声明与三类结论", async () => {
    apiMocks.runAtsCheck.mockResolvedValue(RESULT);
    renderPanel({ resumeId: 7 });
    fireEvent.click(runButton());

    expect(await screen.findByText(RESULT.disclaimer)).toBeInTheDocument();
    expect(screen.getByText("缺少姓名")).toBeInTheDocument();
    expect(screen.getByText("缺少求职意向")).toBeInTheDocument();
    expect(screen.getByText("关键词覆盖不足")).toBeInTheDocument();
    expect(screen.getByText("MySQL ×3")).toBeInTheDocument();
    expect(apiMocks.runAtsCheck).toHaveBeenCalledWith(7, "");
  });

  it("分数旁显示三个分项与关键词覆盖率", async () => {
    apiMocks.runAtsCheck.mockResolvedValue(RESULT);
    renderPanel({ resumeId: 7 });
    fireEvent.click(runButton());

    expect(await screen.findByText(RESULT.disclaimer)).toBeInTheDocument();
    expect(screen.getByText(t("atsCheck.coverage", { percent: 50 }))).toBeInTheDocument();
    // 三个分项各自一条 Progress：格式 88 / 关键词 70 / 位置 64（加上总分的圆环共 4 条）。
    const values = screen
      .getAllByRole("progressbar")
      .map((node) => Number(node.getAttribute("aria-valuenow")));
    expect(values).toContain(88);
    expect(values).toContain(70);
    expect(values).toContain(64);
    expect(values).toContain(76);
  });

  it("没有 JD 的结果：总分显示「—」、关键词分项显示「需要 JD」，不给任何数字分", async () => {
    apiMocks.runAtsCheck.mockResolvedValue(RESULT_WITHOUT_JD);
    renderPanel({ resumeId: 7 });
    fireEvent.click(runButton());

    expect(await screen.findByText(RESULT.disclaimer)).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText(t("atsCheck.score.noJd"))).toBeInTheDocument();
    expect(screen.getByText(t("atsCheck.subscore.needsJd"))).toBeInTheDocument();
    // 只剩格式与位置两条 Progress：关键词那一项不是 0 分，而是不出进度条。
    const values = screen
      .getAllByRole("progressbar")
      .map((node) => Number(node.getAttribute("aria-valuenow")));
    expect(values.sort()).toEqual([64, 88]);
  });

  it("每条问题都展示改进建议", async () => {
    apiMocks.runAtsCheck.mockResolvedValue(RESULT);
    renderPanel({ resumeId: 7 });
    fireEvent.click(runButton());

    expect(await screen.findByText("在简历顶部补上真实姓名")).toBeInTheDocument();
    expect(screen.getByText("把真正掌握的缺失词写进技能区")).toBeInTheDocument();
  });

  it("JD 输入有 50000 字硬上限，顶到上限时出现提示（不使用 showCount 计数器）", async () => {
    renderPanel({ resumeId: 7 });

    const jd = screen.getByLabelText(t("atsCheck.jd.label")) as HTMLTextAreaElement;
    // 上限与后端 AtsCheckRequest.jd_text 的 max_length（50_000）对齐。
    expect(jd.maxLength).toBe(50000);

    fireEvent.change(jd, { target: { value: "好".repeat(50000) } });
    expect(await screen.findByText("已达 50000 字上限")).toBeInTheDocument();
    // 常驻计数器（antd showCount 的「N/50000」）在全仓禁用。
    expect(screen.queryByText(/\d+\s*\/\s*50000/)).not.toBeInTheDocument();
  });

  it("没有关联岗位时不读取岗位、也不显示载入按钮，但「开始检测」仍在操作行里", async () => {
    apiMocks.runAtsCheck.mockResolvedValue(RESULT);
    renderPanel({ resumeId: 7 });

    expect(apiMocks.getJob).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: new RegExp(t("atsCheck.action.reloadJd")) }),
    ).toBeNull();
    expect(screen.queryByText(t("atsCheck.jd.autoLoaded"))).toBeNull();
    expect(screen.queryByText(t("atsCheck.jd.autoFailed"))).toBeNull();
    expect(runButton()).toBeInTheDocument();
  });

  it("有 jobId 时挂载即自动填入 JD，但一次检测都不跑", async () => {
    apiMocks.getJob.mockResolvedValue(jobPayload());
    renderPanel({ resumeId: 7, jobId: 5 });

    const jd = screen.getByLabelText(t("atsCheck.jd.label")) as HTMLTextAreaElement;
    await waitFor(() => expect(jd.value).toBe(JOB_JD));
    expect(apiMocks.getJob).toHaveBeenCalledWith(5);
    expect(await screen.findByText(t("atsCheck.jd.autoLoaded"))).toBeInTheDocument();

    // 「自动载入」只填不跑：用户没点之前不该有任何检测（更不该拿空 JD 打一次分）。
    expect(apiMocks.runAtsCheck).not.toHaveBeenCalled();
  });

  it("「重新载入关联岗位 JD」与「开始检测」在同一行的同一容器里", async () => {
    apiMocks.getJob.mockResolvedValue(jobPayload());
    renderPanel({ resumeId: 7, jobId: 5 });

    const reload = await screen.findByRole("button", {
      name: new RegExp(t("atsCheck.action.reloadJd")),
    });
    const actions = reload.closest("[data-ats-actions]");
    expect(actions).not.toBeNull();
    // DOM 顺序 = 视觉顺序：输入框 → 重新载入 → 开始检测（Tab 不跳序）。
    expect(actions?.contains(runButton())).toBe(true);
    const jdInput = screen.getByLabelText(t("atsCheck.jd.label"));
    expect(jdInput.compareDocumentPosition(reload)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("「重新载入关联岗位 JD」会再次读取岗位并刷新输入框", async () => {
    apiMocks.getJob.mockResolvedValue(jobPayload());
    renderPanel({ resumeId: 7, jobId: 5 });

    const jd = screen.getByLabelText(t("atsCheck.jd.label")) as HTMLTextAreaElement;
    await waitFor(() => expect(jd.value).toBe(JOB_JD));

    apiMocks.getJob.mockResolvedValue(jobPayload("后端服务开发", "熟悉 Go 与 PostgreSQL"));
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(t("atsCheck.action.reloadJd")) }),
    );

    await waitFor(() => expect(jd.value).toBe("后端服务开发\n熟悉 Go 与 PostgreSQL"));
    expect(apiMocks.getJob).toHaveBeenCalledTimes(2);
    // 手动刷新后不再挂「已自动载入」那句提示：JD 现在是用户主动要的。
    expect(screen.queryByText(t("atsCheck.jd.autoLoaded"))).toBeNull();
    // 载入/刷新同样不触发检测。
    expect(apiMocks.runAtsCheck).not.toHaveBeenCalled();
  });

  it("点击「开始检测」只提交一次（loading 期间按钮禁用）", async () => {
    apiMocks.runAtsCheck.mockResolvedValue(RESULT);
    renderPanel({ resumeId: 7 });

    const run = runButton();
    fireEvent.click(run);
    fireEvent.click(run);

    expect(await screen.findByText(RESULT.disclaimer)).toBeInTheDocument();
    expect(apiMocks.runAtsCheck).toHaveBeenCalledTimes(1);
  });

  it("自动载入失败只提示一行次要文案，不弹阻塞错误，手动按钮仍可用", async () => {
    apiMocks.getJob.mockRejectedValueOnce(new Error("岗位不存在"));
    renderPanel({ resumeId: 7, jobId: 5 });

    expect(await screen.findByText(t("atsCheck.jd.autoFailed"))).toBeInTheDocument();
    // 自动路径是静默失败：不出现手动载入那套「岗位信息读取失败」错误。
    expect(screen.queryByText(t("atsCheck.jd.loadFailed"))).toBeNull();
    expect(screen.getByLabelText(t("atsCheck.jd.label"))).toHaveValue("");

    apiMocks.getJob.mockResolvedValue(jobPayload());
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(t("atsCheck.action.reloadJd")) }),
    );

    await waitFor(() => expect(screen.getByLabelText(t("atsCheck.jd.label"))).toHaveValue(JOB_JD));
    expect(screen.queryByText(t("atsCheck.jd.autoFailed"))).toBeNull();
  });

  it("用户手动清空 JD 后不会被自动填回，自动载入提示也随之消失", async () => {
    apiMocks.getJob.mockResolvedValue(jobPayload());
    renderPanel({ resumeId: 7, jobId: 5 });

    const jd = screen.getByLabelText(t("atsCheck.jd.label")) as HTMLTextAreaElement;
    await waitFor(() => expect(jd.value).toBe(JOB_JD));
    expect(screen.getByText(t("atsCheck.jd.autoLoaded"))).toBeInTheDocument();

    fireEvent.change(jd, { target: { value: "" } });
    // 等一轮宏任务：若实现会「补填」，它就在这一轮里发生。
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(jd).toHaveValue("");
    // 输入框都空了，还挂着「可直接开始检测」就是自相矛盾的提示。
    expect(screen.queryByText(t("atsCheck.jd.autoLoaded"))).toBeNull();
    // 同一个岗位只自动载入一次，清空不会触发第二次读取。
    expect(apiMocks.getJob).toHaveBeenCalledTimes(1);
    // 也不会退化成「自动读取失败」那一行。
    expect(screen.queryByText(t("atsCheck.jd.autoFailed"))).toBeNull();
  });

  it("复制改进清单：把标题与建议拼成文本写进剪贴板", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    apiMocks.runAtsCheck.mockResolvedValue(RESULT);
    renderPanel({ resumeId: 7 });

    fireEvent.click(runButton());
    await screen.findByText(RESULT.disclaimer);
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(t("atsCheck.action.copyImprovements")) }),
    );

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const text = writeText.mock.calls[0][0] as string;
    expect(text).toContain("缺少姓名");
    expect(text).toContain(
      t("atsCheck.improvement.suggestion", {
        suggestion: "在简历顶部补上真实姓名",
      }),
    );
    expect(await screen.findByText(t("atsCheck.improvement.copied"))).toBeInTheDocument();
  });
});
