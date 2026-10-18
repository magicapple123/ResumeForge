import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job, Profile } from "../types";
import ManualResumeModal from "./ManualResumeModal";

const apiMocks = vi.hoisted(() => ({
  createManualResume: vi.fn(),
  getProfile: vi.fn(),
}));

vi.mock("../api/resumes", () => ({ createManualResume: apiMocks.createManualResume }));
vi.mock("../api/profile", () => ({ getProfile: apiMocks.getProfile }));

const PROFILE: Profile = {
  id: 1,
  photo: "",
  name: "张三",
  gender: "",
  birth_year: "",
  phone: "",
  email: "",
  city: "",
  target_city: "",
  job_intent: "",
  personal_website: "",
  github: "",
  summary: "",
  wechat: "",
  birth_date: "",
  id_type: "",
  id_number: "",
  country_region: "",
  native_place: "",
  political_status: "",
  phone_country_code: "+86",
  family_info: "",
  expected_salary: "",
  qq: "",
  advisor: "",
  research_direction: "",
  preferred_industry: "",
  section_order: [],
  educations: [],
  experiences: [],
  campus_experiences: [],
  projects: [],
  skills: [],
  awards: [],
};

const JOB: Job = {
  id: 9,
  title: "机械设计工程师",
  company: "示例制造企业",
  location: "苏州",
  salary: "",
  job_type: "校招",
  description: "负责机械结构方案设计与样机验证。",
  requirements: "熟悉机械原理和工程制图。",
  additional_info: "提供生产基地轮岗机会。",
  keywords: [{ name: "工程制图", category: "通用能力" }],
  source: "手动添加",
  source_url: "",
  posted_at: "",
  status: "开放中",
  note: "",
  note_images: [],
  recognition_source: "",
  origin_source: "",
  favorite: false,
  created_at: "2026-08-20T09:00:00",
  updated_at: "2026-08-20T09:00:00",
};

beforeEach(() => {
  apiMocks.createManualResume.mockReset();
  apiMocks.getProfile.mockReset();
  apiMocks.getProfile.mockResolvedValue(PROFILE);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ManualResumeModal", () => {
  it("passes the selected job into the resume editor as a reference", async () => {
    render(
      <AntdApp>
        <ManualResumeModal job={JOB} open onClose={vi.fn()} />
      </AntdApp>,
    );

    await waitFor(() => expect(apiMocks.getProfile).toHaveBeenCalledOnce());
    const referenceToggle = await screen.findByRole("button", { name: /查看岗位要求/ });
    fireEvent.click(referenceToggle);

    expect(screen.getByText(JOB.description)).toBeInTheDocument();
    expect(screen.getByText(JOB.requirements)).toBeInTheDocument();
    expect(screen.getByText(JOB.additional_info)).toBeInTheDocument();
    expect(screen.getByText("工程制图")).toBeInTheDocument();
    expect(screen.getByLabelText("求职意向")).toHaveValue(JOB.title);
  });

  it("opens the editor for a job-less general resume", async () => {
    // 以前这里会因为 !job 提前返回：资料不加载、编辑器永远打不开。
    render(
      <AntdApp>
        <ManualResumeModal job={null} open initialTitle="研发通用版" onClose={vi.fn()} />
      </AntdApp>,
    );

    await waitFor(() => expect(apiMocks.getProfile).toHaveBeenCalledOnce());
    expect(await screen.findByText("从头编写通用简历")).toBeInTheDocument();
    // 没有岗位就不该出现岗位要求面板
    expect(screen.queryByRole("button", { name: /查看岗位要求/ })).not.toBeInTheDocument();

    apiMocks.createManualResume.mockResolvedValue({ id: 1 });
    fireEvent.click(screen.getByRole("button", { name: /保存手写简历/ }));

    await waitFor(() => expect(apiMocks.createManualResume).toHaveBeenCalledOnce());
    expect(apiMocks.createManualResume.mock.calls[0][0]).toMatchObject({
      job_id: null,
      title: "研发通用版",
    });
  });
});

/**
 * R16：手写简历的每个模块都能从「我的资料」下拉填入。
 *
 * 真实场景：预填之后用户又在资料里补了一段实习/一个项目，或者在这个弹窗里误删了一条，
 * 想加回来——不必回资料页复制粘贴（那样最容易漏时间、技术栈这些字段）。
 */
describe("ManualResumeModal 从我的资料填入（R16）", () => {
  const EDUCATION = {
    school: "示例大学",
    department: "",
    major: "软件工程",
    degree: "本科",
    study_mode: "",
    degree_type: "",
    start_date: "2023.09",
    end_date: "2027.06",
    gpa: "3.8",
    cet4_score: "",
    cet6_score: "",
    courses: "数据结构",
    achievements: "",
  };

  beforeEach(() => {
    apiMocks.getProfile.mockResolvedValue({
      ...PROFILE,
      summary: "资料里的个人总结",
      educations: [EDUCATION],
    });
  });

  /** 打开「教育」标签页，并让「从我的资料填入」的下拉展开。 */
  async function openEducationFill() {
    await screen.findByText(/自行编写|从头编写/);
    fireEvent.click(await screen.findByRole("tab", { name: "教育" }));

    const select = await screen.findByRole("combobox", { name: "从我的资料选择教育经历" });
    fireEvent.mouseDown(select);
    fireEvent.click(select);
    return select;
  }

  it("打开后教育页有候选，且已经在简历里的那条标成「已加入」", async () => {
    render(
      <AntdApp>
        <ManualResumeModal job={null} open onClose={vi.fn()} />
      </AntdApp>,
    );

    await openEducationFill();

    // 预填已经把资料里的教育经历带进来了，所以候选存在但不可选。
    const option = await screen.findByText(/示例大学.*已加入/);
    expect(option).toBeInTheDocument();
    expect(option.closest(".ant-select-item-option")).toHaveClass(
      "ant-select-item-option-disabled",
    );
  });

  it("删掉一条后可以把它填回来：列表 +1，且填完又变成「已加入」", async () => {
    render(
      <AntdApp>
        <ManualResumeModal job={null} open onClose={vi.fn()} />
      </AntdApp>,
    );

    // 先删掉预填的那条，模拟"误删了想加回来"。
    await screen.findByText(/自行编写|从头编写/);
    fireEvent.click(await screen.findByRole("tab", { name: "教育" }));
    fireEvent.click(await screen.findByRole("button", { name: "删除教育经历" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "删除教育经历" })).not.toBeInTheDocument(),
    );

    await openEducationFill();
    const option = await screen.findByText("示例大学（软件工程 · 本科 · 2023.09 ~ 2027.06）");
    fireEvent.click(option);
    fireEvent.click(screen.getByRole("button", { name: "填入选中的教育经历" }));

    // 列表 +1：又出现了一条可删除的教育经历。
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "删除教育经历" })).toBeInTheDocument(),
    );
    // 填进来的字段与表单形状一致：学校名进了输入框。
    expect(await screen.findByLabelText("学校")).toHaveValue("示例大学");

    // 再展开一次：同一条已经标成「已加入」、不可重复填。
    const select = screen.getByRole("combobox", { name: "从我的资料选择教育经历" });
    fireEvent.mouseDown(select);
    const again = await screen.findByText(/示例大学.*已加入/);
    expect(again.closest(".ant-select-item-option")).toHaveClass("ant-select-item-option-disabled");
  });

  it("填入只做加法：用户改过的条目原样保留", async () => {
    render(
      <AntdApp>
        <ManualResumeModal job={null} open onClose={vi.fn()} />
      </AntdApp>,
    );

    await screen.findByText(/自行编写|从头编写/);
    fireEvent.click(await screen.findByRole("tab", { name: "教育" }));

    // 用户把学校名改掉了：这条与资料里的不再是"同一条"，候选因此重新可选。
    const schoolInput = await screen.findByLabelText("学校");
    fireEvent.change(schoolInput, { target: { value: "我自己改过的大学" } });

    await openEducationFill();
    const option = await screen.findByText("示例大学（软件工程 · 本科 · 2023.09 ~ 2027.06）");
    fireEvent.click(option);
    fireEvent.click(screen.getByRole("button", { name: "填入选中的教育经历" }));

    // 两条：改过的那条（在前）原样保留，资料里的那条追加在后面。
    await waitFor(() => expect(screen.getAllByLabelText("学校")).toHaveLength(2));
    const schools = screen.getAllByLabelText("学校") as HTMLInputElement[];
    expect(schools[0]).toHaveValue("我自己改过的大学");
    expect(schools[1]).toHaveValue("示例大学");
  });

  it("基本信息页只提供「个人总结」，点了写进 summary", async () => {
    render(
      <AntdApp>
        <ManualResumeModal job={null} open onClose={vi.fn()} />
      </AntdApp>,
    );

    await screen.findByText(/自行编写|从头编写/);
    // 姓名这类身份信息不该有"从资料填入"的入口。
    expect(screen.queryByRole("button", { name: /填入姓名/ })).not.toBeInTheDocument();

    // 用正则匹配：按钮里带一个图标，无障碍名里会混进图标的 aria-label。
    fireEvent.click(await screen.findByRole("button", { name: /从我的资料填入个人总结/ }));
    await waitFor(() => expect(screen.getByLabelText("个人总结")).toHaveValue("资料里的个人总结"));
  });
});
