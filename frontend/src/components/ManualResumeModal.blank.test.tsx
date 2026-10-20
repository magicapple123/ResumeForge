/**
 * 通用手写简历（`job == null`）的 T11 语义：**默认空白** + 头部「填入我的资料全部数据」。
 *
 * 从 `ManualResumeModal.integration.test.tsx` 拆出来（那边贴住 500 行预算）。两份文件的
 * mock 脚手架刻意各自完整——`vi.mock` 的工厂会被提升到文件顶部，跨文件共享 hoisted
 * 对象会 TDZ 报错；为了两个文件都能独立跑，重复这几十行声明是必要成本。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Profile } from "../types";
import ManualResumeModal from "./ManualResumeModal";

const apiMocks = vi.hoisted(() => ({
  createManualResume: vi.fn(),
  getProfile: vi.fn(),
}));

vi.mock("../api/resumes", () => ({ createManualResume: apiMocks.createManualResume }));
vi.mock("../api/profile", () => ({ getProfile: apiMocks.getProfile }));

/** 六个列表模块都有内容的资料：这样"空白起步"与"没读到资料"才区分得开。 */
const FULL_PROFILE: Profile = {
  id: 1,
  photo: "",
  name: "张三",
  gender: "男",
  birth_year: "2003",
  phone: "13800000000",
  email: "zhangsan@example.com",
  city: "苏州",
  target_city: "",
  job_intent: "前端开发",
  personal_website: "",
  github: "",
  summary: "资料里的个人总结",
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
  educations: [
    {
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
    },
  ],
  experiences: [
    {
      company: "示例科技",
      role: "前端实习生",
      start_date: "2025.03",
      end_date: "2025.08",
      description: "负责组件库开发",
    },
  ],
  campus_experiences: [
    {
      organization: "学生会",
      role: "技术部干事",
      start_date: "2024.09",
      end_date: "2025.06",
      description: "组织技术分享",
    },
  ],
  projects: [
    {
      name: "预测性维护平台",
      role: "负责人",
      start_date: "2026.01",
      end_date: "2026.06",
      tech_stack: "Python, Vue",
      description: "采集设备数据",
      highlights: "降低停机时间",
    },
  ],
  skills: [{ name: "TypeScript", level: "熟练" }],
  awards: [{ name: "校级一等奖学金", date: "2025.10", description: "" }],
};

beforeEach(() => {
  apiMocks.createManualResume.mockReset();
  apiMocks.getProfile.mockReset();
  apiMocks.getProfile.mockResolvedValue(FULL_PROFILE);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

/**
 * T11：通用手写简历从**空白**开始，头部给一条"一次带入全部资料"的捷径。
 *
 * 旧行为是全量预填——那份简历不针对任何岗位，资料里所有经历都是候选，用户得先删掉
 * 一大半才写得下去。现在的取舍是：空白起步（自己写这一份需要的），或一键全部带入。
 */
describe("ManualResumeModal 通用模式：空白起步 + 一键填入（T11）", () => {
  function renderGeneral() {
    render(
      <AntdApp>
        <ManualResumeModal job={null} open initialTitle="研发通用版" onClose={vi.fn()} />
      </AntdApp>,
    );
  }

  it("默认从空白开始：不预填资料里的任何内容", async () => {
    renderGeneral();

    expect(await screen.findByText("从头编写通用简历")).toBeInTheDocument();
    expect(screen.getByText(/从空白开始/)).toBeInTheDocument();
    // 基本信息是空的（资料里明明有姓名/手机/总结）。
    expect(screen.getByLabelText("姓名")).toHaveValue("");
    expect(screen.getByLabelText("个人总结")).toHaveValue("");

    // 教育页也没有条目。
    fireEvent.click(await screen.findByRole("tab", { name: "教育" }));
    expect(screen.queryByLabelText("学校")).not.toBeInTheDocument();
  });

  it("点「填入我的资料全部数据」：基本信息 + 六个模块一次带入", async () => {
    renderGeneral();
    await screen.findByText("从头编写通用简历");

    fireEvent.click(screen.getByRole("button", { name: /填入我的资料全部数据/ }));

    await waitFor(() => expect(screen.getByLabelText("姓名")).toHaveValue("张三"));
    expect(screen.getByLabelText("个人总结")).toHaveValue("资料里的个人总结");
    expect(screen.getByLabelText("求职意向")).toHaveValue("前端开发");

    // 六个列表模块逐个确认（切到对应标签页看第一条）。
    fireEvent.click(screen.getByRole("tab", { name: "教育" }));
    expect(await screen.findByLabelText("学校")).toHaveValue("示例大学");
    fireEvent.click(screen.getByRole("tab", { name: "实习/工作" }));
    expect(await screen.findByLabelText("公司")).toHaveValue("示例科技");
    fireEvent.click(screen.getByRole("tab", { name: "校园经历" }));
    expect(await screen.findByLabelText("组织/部门")).toHaveValue("学生会");
    fireEvent.click(screen.getByRole("tab", { name: "项目" }));
    expect(await screen.findByLabelText("项目名称")).toHaveValue("预测性维护平台");
    fireEvent.click(screen.getByRole("tab", { name: "技能" }));
    expect(await screen.findByLabelText("技能名称")).toHaveValue("TypeScript");
    fireEvent.click(screen.getByRole("tab", { name: "荣誉" }));
    expect(await screen.findByLabelText("奖项名称")).toHaveValue("校级一等奖学金");
  });

  it("已有内容时再点：先确认，取消不动、确认才覆盖", async () => {
    renderGeneral();
    await screen.findByText("从头编写通用简历");

    // 第一次点：表单还是空的，直接填，不打扰用户。
    fireEvent.click(screen.getByRole("button", { name: /填入我的资料全部数据/ }));
    await waitFor(() => expect(screen.getByLabelText("姓名")).toHaveValue("张三"));

    // 用户改成自己的写法，再点一次 → 必须问一句。
    fireEvent.change(screen.getByLabelText("姓名"), { target: { value: "我自己写的名字" } });
    fireEvent.click(screen.getByRole("button", { name: /填入我的资料全部数据/ }));

    // 覆盖确认框（antd 会把标题同时渲染进 aria 节点，按文本查会命中多个，
    // 所以直接看确认框本体，与确认按钮的定位方式一致）。
    await waitFor(() => expect(document.querySelector(".ant-modal-confirm")).not.toBeNull());

    // 取消：一个字符都不动。
    const confirmBox = document.querySelector(".ant-modal-confirm") as HTMLElement;
    // antd 会在两个汉字的按钮文案里插一个空格，按正则匹配。
    fireEvent.click(within(confirmBox).getByRole("button", { name: /取\s*消/ }));
    expect(screen.getByLabelText("姓名")).toHaveValue("我自己写的名字");

    // 再来一次，这次确认覆盖。
    fireEvent.click(screen.getByRole("button", { name: /填入我的资料全部数据/ }));
    const ok = await waitFor(() => {
      const box = document.querySelector(".ant-modal-confirm") as HTMLElement | null;
      const button = box?.querySelector<HTMLButtonElement>(".ant-btn-primary");
      if (!button) throw new Error("未找到确认按钮");
      return button;
    });
    fireEvent.click(ok);
    await waitFor(() => expect(screen.getByLabelText("姓名")).toHaveValue("张三"));
  });
});
