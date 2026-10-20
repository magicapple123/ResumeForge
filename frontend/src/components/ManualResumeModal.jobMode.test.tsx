/**
 * 岗位详情里的「自行编写简历」= `ManualResumeModal` 收到 `job != null`。
 *
 * 与 `ManualResumeModal.integration.test.tsx` 的分工：那个文件钉的是"通用手写简历"
 * （`job == null`：全量预填 + 每个条目旁都有「从资料填入本条」）；这里钉的是**岗位模式**
 * 的差异，以及两种模式**不能互相污染**：
 *
 * - 只预填基本信息（照片/姓名/性别/出生年份/手机/邮箱/城市/主页/GitHub/求职意向），
 *   `summary` 与六个列表模块留空——用这个岗位的人要照着岗位要求亲手写，不该先删半屏
 *   与岗位无关的经历；
 * - 每个条目卡上不出现「从资料填入本条」，但每个模块顶部的「从我的资料追加一条」还在
 *   （需要哪条加哪条）；
 * - `job == null` 时条目级入口必须仍然存在（P4 行为不能因为岗位模式一起被关掉）。
 */

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

/* ------------------------------------------------------------------ 夹具 */

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

const EXPERIENCE = {
  company: "示例科技",
  role: "前端实习生",
  start_date: "2025.03",
  end_date: "2025.08",
  description: "负责组件库开发",
};

const CAMPUS = {
  organization: "学生会",
  role: "技术部干事",
  start_date: "2024.09",
  end_date: "2025.06",
  description: "组织技术分享",
};

const PROJECT = {
  name: "预测性维护平台",
  role: "负责人",
  start_date: "2026.01",
  end_date: "2026.06",
  tech_stack: "Python, Vue",
  description: "采集设备数据",
  highlights: "降低停机时间",
};

const SKILL = { name: "TypeScript", level: "熟练" };
const AWARD = { name: "校级一等奖学金", date: "2025.10", description: "" };

/** 六个列表模块都有内容的资料：这样"留空"与"没预填到"才区分得开。 */
const PROFILE: Profile = {
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
  personal_website: "https://zhangsan.example.com",
  github: "https://github.com/zhangsan",
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
  educations: [EDUCATION],
  experiences: [EXPERIENCE],
  campus_experiences: [CAMPUS],
  projects: [PROJECT],
  skills: [SKILL],
  awards: [AWARD],
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
  additional_info: "",
  keywords: [],
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

/* ------------------------------------------------------------------ 文案锚点 */

/** 模块顶部「追加一条」入口：文案 + 每个模块各自的下拉无障碍名。 */
const APPEND_HINT = "从我的资料追加一条";
/** 条目头部「填入本条」入口的文案与无障碍名（岗位模式里必须一个都不出现）。 */
const ENTRY_HINT = "从资料填入本条";
const ENTRY_SELECT_LABEL = "从我的资料选择填入本条";

/** 六个列表模块：Tab 名 → 顶部追加入口的无障碍名（`从我的资料选择{模块 title}`）。 */
const MODULES = [
  { tab: "教育", select: "从我的资料选择教育经历" },
  { tab: "实习/工作", select: "从我的资料选择实习/工作经历" },
  { tab: "校园经历", select: "从我的资料选择校园经历" },
  { tab: "项目", select: "从我的资料选择项目经历" },
  { tab: "技能", select: "从我的资料选择专业技能" },
  { tab: "荣誉", select: "从我的资料选择荣誉奖项" },
];

/* ------------------------------------------------------------------ 交互小工具 */

/**
 * 展开下拉并返回浮层。
 *
 * 每个用例最多展开一个下拉（不同下拉的浮层都挂在 body 上，多开就分不清归属），拿
 * "最后一个未隐藏的浮层"即可；`ant-select-dropdown-hidden` 是关闭态的类名。
 */
async function openDropdown(select: HTMLElement): Promise<HTMLElement> {
  fireEvent.mouseDown(select);
  fireEvent.click(select);
  return waitFor(() => {
    const dropdowns = Array.from(
      document.querySelectorAll<HTMLElement>(".ant-select-dropdown"),
    ).filter((node) => !node.classList.contains("ant-select-dropdown-hidden"));
    expect(dropdowns.length).toBeGreaterThan(0);
    return dropdowns[dropdowns.length - 1];
  });
}

/**
 * 浮层里按可见文案点一条选项（文案由 `ProfileFillBar` 拼成「标题（次要说明）」）。
 *
 * 只比 `.ant-select-item-option-content`（可见那一行）的文本：rc-select 另外渲染了一份
 * 无障碍用的 `role="option"` 节点，它的 textContent 是**原始去重键**（`学校|专业|…`），
 * 用裸文本查会同时命中两者而报 "Found multiple elements"。
 */
function optionElement(dropdown: HTMLElement, text: string): HTMLElement {
  const options = Array.from(dropdown.querySelectorAll<HTMLElement>(".ant-select-item-option"));
  const option = options.find((node) =>
    (node.querySelector(".ant-select-item-option-content")?.textContent ?? "").includes(text),
  );
  if (!option) throw new Error(`「${text}」不是一条下拉选项`);
  return option;
}

/* ------------------------------------------------------------------ 用例 */

beforeEach(() => {
  apiMocks.createManualResume.mockReset();
  apiMocks.getProfile.mockReset();
  apiMocks.getProfile.mockResolvedValue(PROFILE);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ManualResumeModal 岗位模式（自行编写简历）", () => {
  it("只预填基本信息：姓名/手机/求职意向有值，个人总结与六个列表都为空", async () => {
    render(
      <AntdApp>
        <ManualResumeModal job={JOB} open onClose={vi.fn()} />
      </AntdApp>,
    );

    // 打开的是「自行编写」这份表单（标题与说明都按岗位模式给）。
    expect(await screen.findByText(`自行编写「${JOB.title}」简历`)).toBeInTheDocument();
    expect(screen.getByText(/已预填基本信息；其他模块留空/)).toBeInTheDocument();

    // 基本信息逐项带过来了。
    expect(screen.getByLabelText("姓名")).toHaveValue("张三");
    expect(screen.getByLabelText("性别")).toHaveValue("男");
    expect(screen.getByLabelText("出生年份")).toHaveValue("2003");
    expect(screen.getByLabelText("手机")).toHaveValue("13800000000");
    expect(screen.getByLabelText("邮箱")).toHaveValue("zhangsan@example.com");
    expect(screen.getByLabelText("所在城市")).toHaveValue("苏州");
    expect(screen.getByLabelText("个人主页")).toHaveValue("https://zhangsan.example.com");
    expect(screen.getByLabelText("GitHub 主页")).toHaveValue("https://github.com/zhangsan");
    // 求职意向跟着岗位走（资料里的"前端开发"不该盖掉它）。
    expect(screen.getByLabelText("求职意向")).toHaveValue(JOB.title);
    // 个人总结留空：这份简历是要照着岗位现写的。
    expect(screen.getByLabelText("个人总结")).toHaveValue("");

    // T11：一键填入只给「通用手写简历」。岗位模式的经历是照岗位写的，
    // 把资料全倒进去等于替用户做决定，所以这里连按钮都不出现。
    expect(screen.queryByRole("button", { name: /填入我的资料全部数据/ })).not.toBeInTheDocument();
  });

  it("六个列表模块都没有预填条目，但每个模块顶部都有「从我的资料追加一条」", async () => {
    render(
      <AntdApp>
        <ManualResumeModal job={JOB} open onClose={vi.fn()} />
      </AntdApp>,
    );

    await screen.findByText(`自行编写「${JOB.title}」简历`);

    for (const { tab, select } of MODULES) {
      fireEvent.click(await screen.findByRole("tab", { name: tab }));
      // 顶部追加还在（候选来自资料，与"列表留空"并不矛盾）。
      expect(await screen.findByRole("combobox", { name: select })).toBeInTheDocument();
      // 「添加{模块}」按钮也在——空列表得能自己加。
      expect(screen.getAllByText(APPEND_HINT).length).toBeGreaterThan(0);
      // 条目级入口一个都没有（此时列表为空，本来也没有条目可挂）。
      expect(screen.queryByRole("combobox", { name: ENTRY_SELECT_LABEL })).not.toBeInTheDocument();
      // 也没有任何已存在的条目（没有删除按钮 = 列表确实空着）。
      expect(screen.queryAllByRole("button", { name: /^删除/ })).toHaveLength(0);
    }
  });

  it("自己加的条目上也不出现「从资料填入本条」", async () => {
    render(
      <AntdApp>
        <ManualResumeModal job={JOB} open onClose={vi.fn()} />
      </AntdApp>,
    );

    await screen.findByText(`自行编写「${JOB.title}」简历`);
    fireEvent.click(await screen.findByRole("tab", { name: "教育" }));

    fireEvent.click(await screen.findByRole("button", { name: /添加教育经历/ }));
    await waitFor(() => expect(screen.getByLabelText("学校")).toBeInTheDocument());

    // 条目出现了，但它头上没有条目级下拉（这是岗位模式与通用简历的唯一差别）。
    expect(screen.queryByText(ENTRY_HINT)).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: ENTRY_SELECT_LABEL })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "填入本条的教育经历" })).not.toBeInTheDocument();
    // 顶部追加照旧：一条入口，且仍然可用。
    expect(screen.getByText(APPEND_HINT)).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "从我的资料选择教育经历" })).toBeInTheDocument();
  });

  it("点顶部「从我的资料追加一条」能把资料里的经历加进空列表", async () => {
    render(
      <AntdApp>
        <ManualResumeModal job={JOB} open onClose={vi.fn()} />
      </AntdApp>,
    );

    await screen.findByText(`自行编写「${JOB.title}」简历`);
    fireEvent.click(await screen.findByRole("tab", { name: "教育" }));

    const select = await screen.findByRole("combobox", { name: "从我的资料选择教育经历" });
    const dropdown = await openDropdown(select);
    fireEvent.click(optionElement(dropdown, "示例大学"));
    fireEvent.click(screen.getByRole("button", { name: "填入选中的教育经历" }));

    await waitFor(() => expect(screen.getByLabelText("学校")).toHaveValue("示例大学"));
    // 追加 = 整条加进来：其余字段一并带到，且没有多出第二条。
    expect(screen.getAllByLabelText("学校")).toHaveLength(1);
    expect(screen.getByLabelText("专业")).toHaveValue("软件工程");
    expect(screen.getByLabelText("学历")).toHaveValue("本科");
    expect(screen.getByLabelText("开始时间")).toHaveValue("2023.09");
    // 加进来的这一条同样没有条目级入口（岗位模式统一关闭）。
    expect(screen.queryByRole("combobox", { name: ENTRY_SELECT_LABEL })).not.toBeInTheDocument();
  });
});

describe("ManualResumeModal 通用手写简历（job = null）：空白起步 + 一键填入 + 条目级下拉", () => {
  it("默认空白；一键填入后每个条目旁仍有「从资料填入本条」", async () => {
    render(
      <AntdApp>
        <ManualResumeModal job={null} open onClose={vi.fn()} />
      </AntdApp>,
    );

    expect(await screen.findByText("从头编写通用简历")).toBeInTheDocument();
    // T11：通用简历从空白开始，不再全量预填。
    expect(screen.getByText(/从空白开始/)).toBeInTheDocument();
    expect(screen.getByLabelText("个人总结")).toHaveValue("");

    // 一键把资料带进来（这正是替掉"默认全量预填"的那条路）。
    fireEvent.click(screen.getByRole("button", { name: /填入我的资料全部数据/ }));
    await waitFor(() => expect(screen.getByLabelText("个人总结")).toHaveValue("资料里的个人总结"));

    // 教育：预填的一条在，条目级入口也在（P4 行为，不能因岗位模式被一起关掉）。
    fireEvent.click(await screen.findByRole("tab", { name: "教育" }));
    await waitFor(() => expect(screen.getByLabelText("学校")).toHaveValue("示例大学"));
    expect(screen.getByText(ENTRY_HINT)).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: ENTRY_SELECT_LABEL })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "填入本条的教育经历" })).toBeInTheDocument();
    // 顶部追加与条目级入口并存。
    expect(screen.getByText(APPEND_HINT)).toBeInTheDocument();

    // 项目同样预填（证明"留空"是岗位模式独有的行为，不是资料没被读到）。
    fireEvent.click(await screen.findByRole("tab", { name: "项目" }));
    await waitFor(() => expect(screen.getByLabelText("项目名称")).toHaveValue("预测性维护平台"));
    expect(screen.getAllByRole("combobox", { name: ENTRY_SELECT_LABEL })).toHaveLength(1);
  });
});
