// SPDX-License-Identifier: Apache-2.0
/**
 * 「让 AI 按我的要求改这一栏」：当前内容区的**折叠**行为。
 *
 * 这一块以前是 `max-height: 72px; overflow-y: auto`，内容一长右边就竖一根滚动条
 * （用户反馈"不太好看"）。现在改成默认折到 4 行 + 「展开全文」。这里钉住三件事：
 * 长内容默认折叠、点了能看到全部、短内容不出现多余的展开按钮。
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App as AntdApp } from "antd";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResumeContent } from "../../types";
import FieldRewritePanel from "./FieldRewritePanel";

vi.mock("../../api/resumeWriting", () => ({ rewriteResumeField: vi.fn() }));
vi.mock("../../api/resumes", () => ({ prepareResumeReview: vi.fn() }));

import { prepareResumeReview } from "../../api/resumes";
import { rewriteResumeField } from "../../api/resumeWriting";

const mockedPrepare = vi.mocked(prepareResumeReview);
const mockedRewrite = vi.mocked(rewriteResumeField);

// 长度贴近真实数据（演示库里的个人总结就是这个量级：超过三行）。
const LONG_SUMMARY =
  "3 年市场与运营经验，主导过从 0 到 1 的会员增长项目，擅长把一次性的活动经验沉淀成可复用的流程。" +
  "面向高级研发工程师画像，具备完整的数据驱动决策习惯，能把模糊的业务目标拆成可验证的实验；" +
  "熟悉私域运营与内容增长的全链路，能独立完成从选题、投放、复盘到沉淀方法论的过程；" +
  "在跨部门协作中负责需求收敛与排期，推动设计与研发按周交付，并把复盘结论写回流程文档。";

function content(overrides: Partial<ResumeContent> = {}): ResumeContent {
  return {
    name: "张三",
    summary: LONG_SUMMARY,
    projects: [
      {
        name: "会员增长系统",
        role: "后端",
        period: "2024",
        description: ["要点一", "要点二", "要点三", "要点四", "要点五"],
        highlights: [],
        tech_stack: [],
      },
    ],
    ...overrides,
  } as unknown as ResumeContent;
}

function renderPanel(path: string, onChange = vi.fn(), overrides: Partial<ResumeContent> = {}) {
  render(
    <AntdApp>
      <MemoryRouter>
        <FieldRewritePanel
          resumeId={7}
          content={content(overrides)}
          path={path}
          onChange={onChange}
        />
      </MemoryRouter>
    </AntdApp>,
  );
  return { onChange };
}

afterEach(cleanup);

describe("当前内容的折叠显示", () => {
  it("长文本（个人总结）默认折叠，并给出展开入口", () => {
    renderPanel("summary");

    expect(screen.getByText(/展开全文/)).toBeInTheDocument();
    // 折叠时那一段仍然渲染（靠 CSS 截断行数），只是多了展开按钮——内容不会丢。
    expect(screen.getByText(/3 年市场与运营经验/)).toBeInTheDocument();
  });

  it("点「展开全文」看得到全部，再点「收起」回到折叠", () => {
    renderPanel("summary");

    fireEvent.click(screen.getByText(/展开全文/));
    expect(screen.getByText("收起")).toBeInTheDocument();

    fireEvent.click(screen.getByText("收起"));
    expect(screen.getByText(/展开全文/)).toBeInTheDocument();
  });

  it("要点很多时也折叠，展开文案带上条数", () => {
    renderPanel("projects.0.description");

    expect(screen.getByText("展开全文（共 5 条）")).toBeInTheDocument();
  });

  it("内容很短时不出现展开按钮", () => {
    render(
      <AntdApp>
        <MemoryRouter>
          <FieldRewritePanel
            resumeId={7}
            content={content({ summary: "两年前端开发经验。" })}
            path="summary"
            onChange={vi.fn()}
          />
        </MemoryRouter>
      </AntdApp>,
    );

    expect(screen.queryByText(/展开全文/)).not.toBeInTheDocument();
  });
});

/**
 * 「审阅后填入」（RF-13）：生成结果不再一键写入表单——先调 /review/prepare
 * 拿预检结论，再打开按条审阅弹窗过目 diff，接受才回填既有表单链。
 */
describe("审阅后填入（diff 审阅）", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  async function runSuggestion(summary = "两年前端开发经验。") {
    mockedRewrite.mockResolvedValue({
      path: "summary",
      label: "个人总结",
      context: "",
      original: summary,
      result: "改写后的总结",
      lines: ["改写后的总结"],
    });
    mockedPrepare.mockResolvedValue([{ path: "summary", verdict: "ok", reasons: [] }]);
    const { onChange } = renderPanel("summary", vi.fn(), { summary });
    fireEvent.change(screen.getByLabelText("对这一栏的改写要求"), {
      target: { value: "更专业一点" },
    });
    fireEvent.click(screen.getByRole("button", { name: "生 成" }));
    await screen.findByText("改写后的总结");
    fireEvent.click(screen.getByRole("button", { name: /审阅后填入/ }));
    await screen.findByText("逐条审阅改动");
    return { onChange, summary };
  }

  it("点「审阅后填入」先打开审阅弹窗并带上预检结论，接受才回填表单", async () => {
    const { onChange } = await runSuggestion();

    // 预检参数：AI 改写来源 + 改写要求 + 主体名（summary 无条目主体 → undefined）。
    await waitFor(() => expect(mockedPrepare).toHaveBeenCalledTimes(1));
    expect(mockedPrepare.mock.calls[0][0]).toBe(7);
    expect(mockedPrepare.mock.calls[0][1][0]).toMatchObject({
      path: "summary",
      before: "两年前端开发经验。",
      after: "改写后的总结",
      origin: "ai_rewrite",
      instruction: "更专业一点",
    });

    fireEvent.click(screen.getByRole("button", { name: "全部接受" }));
    fireEvent.click(screen.getByRole("button", { name: /应用所选（1）/ }));
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const next = onChange.mock.calls[0][0] as ResumeContent;
    expect(next.summary).toBe("改写后的总结");
    // 关闭后确认面板清空改写结果（confirmReview 的 setSuggestion([])）。
    // 注：不断言弹窗从 DOM 卸载——jsdom 不派发 transitionend，antd 退场动画
    // 永远停在 leave-active（实测探针），DOM 卸载在本测试环境不可断言。
    expect(screen.queryByText(/改写结果（还没生效/)).not.toBeInTheDocument();
    expect(screen.getByText(/已填入表单/)).toBeInTheDocument();
  });

  it("预检结论为 fact_check_needed 时弹窗里显示核实提示与台账链接", async () => {
    mockedRewrite.mockResolvedValue({
      path: "summary",
      label: "个人总结",
      context: "",
      original: "两年前端开发经验。",
      result: "提升了 37% 的转化",
      lines: ["提升了 37% 的转化"],
    });
    mockedPrepare.mockResolvedValue([
      {
        path: "summary",
        verdict: "fact_check_needed",
        reasons: ["量化结果 37% 在个人资料中找不到依据，建议先核实"],
      },
    ]);
    const { onChange } = renderPanel("summary");
    fireEvent.change(screen.getByLabelText("对这一栏的改写要求"), {
      target: { value: "补个数字" },
    });
    fireEvent.click(screen.getByRole("button", { name: "生 成" }));
    await screen.findByText("提升了 37% 的转化");
    fireEvent.click(screen.getByRole("button", { name: /审阅后填入/ }));

    await screen.findByText("逐条审阅改动");
    expect(screen.getAllByText(/涉及事实，建议回台账核实/).length).toBeGreaterThan(0);
    // summary 没有条目主体 → 链接不带 keyword。
    expect(screen.getByRole("link", { name: "去事实台账核实" })).toHaveAttribute("href", "/claims");

    // 关闭弹窗后不写入表单（取消路径）：onChange 不被调用、不出现"已填入表单"。
    // 注：不断言弹窗从 DOM 卸载——jsdom 不派发 transitionend，antd 退场动画
    // 永远停在 leave-active（实测探针），DOM 卸载在本测试环境不可断言。
    fireEvent.click(screen.getByRole("button", { name: /取\s*消/ }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByText(/已填入表单/)).not.toBeInTheDocument();
  });
});
