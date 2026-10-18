/**
 * 事实来源展示（RF-13）：四类 origin 的渲染、无标注不渲染、
 * AI 改写永不显示为"已确认"，以及默认折叠（R8）。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { FactAnnotation, ResumeContent } from "../../types";
import EvidencePanel from "./EvidencePanel";

const CONTENT: ResumeContent = {
  photo: "",
  name: "张三",
  gender: "",
  birth_year: "",
  phone: "",
  email: "",
  city: "",
  personal_website: "",
  github: "",
  job_intent: "",
  summary: "后端开发工程师",
  education: [],
  experience: [
    {
      company: "某科技公司",
      role: "后端实习生",
      start_date: "",
      end_date: "",
      description: [],
    },
  ],
  campus_experience: [],
  projects: [],
  skills: [],
  awards: [],
};

function annotation(overrides: Partial<FactAnnotation>): FactAnnotation {
  return { path: "summary", origin: "grounded", ...overrides };
}

/** 展开折叠面板：默认折叠，条目要点开标题才渲染出来（R8）。 */
function expandPanel() {
  fireEvent.click(screen.getByRole("button", { name: /内容来源说明/ }));
}

afterEach(cleanup);

describe("EvidencePanel", () => {
  it("无标注（或旧记录 undefined）时不渲染任何内容", () => {
    const { container: empty } = render(<EvidencePanel annotations={[]} content={CONTENT} />);
    expect(empty).toBeEmptyDOMElement();
    const { container: legacy } = render(
      <EvidencePanel annotations={undefined} content={CONTENT} />,
    );
    expect(legacy).toBeEmptyDOMElement();
  });

  it("默认折叠：只显示标题与条数，条目和说明文字都还看不到", () => {
    render(
      <EvidencePanel
        content={CONTENT}
        annotations={[
          annotation({ path: "summary", origin: "grounded" }),
          annotation({ path: "experience.0", origin: "restored" }),
        ]}
      />,
    );

    // 条数徽标：标题即"这个面板里有多少条标注"。
    expect(screen.getByText("内容来源说明 · 2 条")).toBeInTheDocument();
    // 折叠状态下 children 不渲染——分区标题、Tag 与说明文字都不在文档里。
    expect(screen.queryByText("资料原文")).not.toBeInTheDocument();
    expect(screen.queryByText("回填原文")).not.toBeInTheDocument();
    expect(screen.queryByText(/建议导出前过目/)).not.toBeInTheDocument();
  });

  it("按分区渲染标注：栏目人话 + 来源 Tag + 依据（展开后）", () => {
    render(
      <EvidencePanel
        content={CONTENT}
        annotations={[
          annotation({
            path: "summary",
            origin: "grounded",
            source_fact: "张三的资料里写着：后端开发工程师",
          }),
          annotation({
            path: "experience.0",
            origin: "restored",
            source_subject: "某科技公司",
            source_fact: "负责 XX 服务开发，性能提升 30%",
          }),
        ]}
      />,
    );

    expect(screen.getByText("内容来源说明 · 2 条")).toBeInTheDocument();
    expandPanel();

    // path 翻译成人话（个人总结 / 实习/工作经历「某科技公司」）；分区标题与
    // summary 标注的栏目标签同名，所以用 getAllByText 断言两处都在。
    expect(screen.getAllByText("个人总结").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/某科技公司/)).toBeInTheDocument();
    expect(screen.getByText("资料原文")).toBeInTheDocument();
    expect(screen.getByText("回填原文")).toBeInTheDocument();
    expect(screen.getByText(/依据：张三的资料里写着/)).toBeInTheDocument();
  });

  it("AI 改写（enhanced_kept）即使带了已确认状态也绝不显示为已确认", () => {
    render(
      <EvidencePanel
        content={CONTENT}
        annotations={[
          annotation({
            origin: "enhanced_kept",
            verification_status: "已确认",
          }),
        ]}
      />,
    );

    expandPanel();
    expect(screen.getByText("AI 改写保留")).toBeInTheDocument();
    expect(screen.queryByText("已确认")).not.toBeInTheDocument();
  });

  it("非 AI 来源的标注可以展示台账核实状态与承担程度", () => {
    render(
      <EvidencePanel
        content={CONTENT}
        annotations={[
          annotation({
            origin: "grounded",
            verification_status: "已确认",
            responsibility: "主导方案或交付",
            boundary: "团队负责容器化，我负责服务端接口",
          }),
        ]}
      />,
    );

    expandPanel();
    expect(screen.getByText("已确认")).toBeInTheDocument();
    expect(screen.getByText("主导方案或交付")).toBeInTheDocument();
    expect(screen.getByText(/个人边界：团队负责容器化/)).toBeInTheDocument();
  });
});
