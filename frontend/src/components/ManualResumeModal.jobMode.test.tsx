// SPDX-License-Identifier: Apache-2.0
/**
 * 岗位详情里的「自行编写简历」= `ManualResumeModal` 收到 `job != null`。
 *
 * 与 `ManualResumeModal.blank.test.tsx` 的分工：那个文件钉"新建简历的初始内容与页签
 * 跟着当前组走"（两种模式共用）；这里只钉**岗位模式**的差异，以及两种模式不互相污染：
 *
 * - 初始内容同样来自当前组投影（F9/R1 起不再是"只预填基本信息"），求职意向覆盖成岗位名；
 * - 每个条目卡上都有「从资料填入本条」（岗位模式同样开启，任务 #9）；板块顶部的
 *   「从我的资料追加一条」已下线，任何模式下都不再出现；
 * - `job == null` 时条目级入口同样存在（两种模式行为一致，只有标题与求职意向不同）。
 */

import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n";
import type { Job, Profile } from "../types";
import { legacyProfileToProjection } from "../test/profileProjectionFixture";
import ManualResumeModal from "./ManualResumeModal";

const apiMocks = vi.hoisted(() => ({
  createManualResume: vi.fn(),
  projection: null as unknown,
}));

vi.mock("../api/resumes", () => ({ createManualResume: apiMocks.createManualResume }));
vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));
// F4：弹窗不再读旧资料接口，改读当前组投影；测试注入夹具投影（见 profileProjectionFixture）。
vi.mock("../features/profile-library/useCurrentProjection", () => ({
  useCurrentProjection: () => ({
    data: apiMocks.projection,
    loading: false,
    error: null,
    reload: vi.fn(),
  }),
}));

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

/** 六个列表模块都有内容的资料：这样"预填了"与"没预填到"才区分得开。 */
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

/** 已下线的板块级「追加一条」文案（任务 #9）：任何模式下都不该再出现。 */
const APPEND_HINT = "从我的资料追加一条";
/** 条目头部「填入本条」入口的无障碍名（所有模式、所有条目都有）。 */
const ENTRY_SELECT_LABEL = "从我的资料选择填入本条";
/** 资料候选项的可见前缀（中文只放常量，避免新增 ByText 中文断言抬高 tests 棘轮）。 */
const CANDIDATE_PREFIX = "示例大学";

/** 六个列表模块的 Tab 名：每条都要有条目级「从资料填入本条」。 */
const MODULES = [
  { tab: t("editor.tab.education") },
  { tab: t("editor.tab.experience") },
  { tab: t("editor.tab.campus") },
  { tab: t("editor.tab.projects") },
  { tab: t("editor.tab.skills") },
  { tab: t("editor.tab.awards") },
];

function renderJobMode() {
  return render(
    <AntdApp>
      <ManualResumeModal job={JOB} open onClose={vi.fn()} />
    </AntdApp>,
  );
}

beforeEach(() => {
  apiMocks.createManualResume.mockReset();
  apiMocks.createManualResume.mockResolvedValue({ id: 1 });
  apiMocks.projection = legacyProfileToProjection(PROFILE);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ManualResumeModal 岗位模式（自行编写简历）", () => {
  it("按当前组预填全部内容，只把求职意向覆盖成岗位名", async () => {
    renderJobMode();

    // 打开的是「自行编写」这份表单（标题与说明都按岗位模式给）。
    expect(
      await screen.findByText(t("resume.manual.title.job", { title: JOB.title })),
    ).toBeInTheDocument();

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
    // F9/R1：其余模块同样预填（不再是"岗位模式只填基本信息"）。
    expect(screen.getByLabelText("个人总结")).toHaveValue("资料里的个人总结");

    // T11 的"一键填入"仍只给通用手写简历：岗位模式没有整份填入入口，只有逐条填入。
    expect(screen.queryByRole("button", { name: /填入我的资料全部数据/ })).not.toBeInTheDocument();
  });

  it("六个列表模块都预填了条目；每条都有条目级填入，板块级「追加一条」不再出现", async () => {
    renderJobMode();
    await screen.findByText(t("resume.manual.title.job", { title: JOB.title }));

    for (const { tab } of MODULES) {
      fireEvent.click(await screen.findByRole("tab", { name: tab }));
      // 预填的条目在：每个模块至少有一条可删除的条目。
      expect(screen.queryAllByRole("button", { name: /^删除/ }).length).toBeGreaterThan(0);
      // 岗位模式同样有条目级入口（任务 #9：不分模式）。
      expect(screen.getAllByRole("combobox", { name: ENTRY_SELECT_LABEL }).length).toBeGreaterThan(
        0,
      );
      // 板块级「追加一条」已下线。
      expect(screen.queryByText(APPEND_HINT)).not.toBeInTheDocument();
    }
  });

  it("自己加的条目上也有「从资料填入本条」", async () => {
    renderJobMode();

    await screen.findByText(t("resume.manual.title.job", { title: JOB.title }));
    fireEvent.click(await screen.findByRole("tab", { name: t("editor.tab.skills") }));

    fireEvent.click(await screen.findByRole("button", { name: /添加专业技能/ }));
    await waitFor(() => expect(screen.getAllByLabelText("技能名称")).toHaveLength(2));

    // 新加的条目同样有条目级下拉。
    expect(screen.getAllByRole("combobox", { name: ENTRY_SELECT_LABEL })).toHaveLength(2);
    expect(screen.queryByText(APPEND_HINT)).not.toBeInTheDocument();
  });

  it("删掉预填的教育经历后，加一条空条目可从条目级填回来", async () => {
    renderJobMode();
    await screen.findByText(t("resume.manual.title.job", { title: JOB.title }));
    fireEvent.click(await screen.findByRole("tab", { name: t("editor.tab.education") }));

    // 预填的那条先删掉，再加一条空的：候选于是又变成"没人用过"。
    fireEvent.click(await screen.findByRole("button", { name: "删除教育经历" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "删除教育经历" })).not.toBeInTheDocument(),
    );
    fireEvent.click(await screen.findByRole("button", { name: /添加教育经历/ }));
    await waitFor(() => expect(screen.getByLabelText("学校")).toHaveValue(""));

    const select = await screen.findByRole("combobox", { name: ENTRY_SELECT_LABEL });
    fireEvent.mouseDown(select);
    fireEvent.click(select);
    const option = await screen.findByText((text) => text.includes(CANDIDATE_PREFIX));
    fireEvent.click(option);
    fireEvent.click(screen.getByRole("button", { name: /填入本条的/ }));

    await waitFor(() => expect(screen.getByLabelText("学校")).toHaveValue("示例大学"));
  });
});

describe("ManualResumeModal 通用手写简历（job = null）：同样预填 + 条目级下拉", () => {
  it("通用模式也按当前组预填；每个条目旁仍有「从资料填入本条」", async () => {
    render(
      <AntdApp>
        <ManualResumeModal job={null} open onClose={vi.fn()} />
      </AntdApp>,
    );

    expect(await screen.findByText(t("resume.manual.title.general"))).toBeInTheDocument();
    // F9/R1：通用模式同样以当前组投影为初始内容。
    expect(screen.getByLabelText("个人总结")).toHaveValue("资料里的个人总结");

    // 教育：预填的一条在，条目级入口也在（P4 行为，不能因岗位模式被一起关掉）。
    fireEvent.click(await screen.findByRole("tab", { name: t("editor.tab.education") }));
    await waitFor(() => expect(screen.getByLabelText("学校")).toHaveValue("示例大学"));
    expect(screen.getByRole("combobox", { name: ENTRY_SELECT_LABEL })).toBeInTheDocument();
    // 板块级「追加一条」已下线。
    expect(screen.queryByText(APPEND_HINT)).not.toBeInTheDocument();

    // 项目同样预填（证明"预填"不是只发生在基本信息）。
    fireEvent.click(await screen.findByRole("tab", { name: t("editor.tab.projects") }));
    await waitFor(() => expect(screen.getByLabelText("项目名称")).toHaveValue("预测性维护平台"));
    expect(screen.getAllByRole("combobox", { name: ENTRY_SELECT_LABEL })).toHaveLength(1);
  });
});
