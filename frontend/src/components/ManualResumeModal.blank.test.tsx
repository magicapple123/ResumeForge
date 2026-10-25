// SPDX-License-Identifier: Apache-2.0
/**
 * 新建简历与「我的资料」**当前组**的同步（F9 / R1）。
 *
 * 文件名沿用 `blank`（上一轮它钉的是"通用简历从空白起步"）；本轮用户口径反转了：
 * 新建简历的初始内容 = **当前组投影内容**，岗位模式也一样（只额外覆盖求职意向）。
 *
 * 这里钉四件事：
 * 1. 两种模式的初始内容都来自投影（不再空白/只填基本信息）；
 * 2. 编辑器页签按当前组参与清单过滤——当前组有的分区即使没内容也出现，没有且无内容的不出现，
 *    已有内容的分区永远保留；
 * 3. 打开期间投影刷新（别的窗口改资料/切组）且**未编辑** → 表单自动重同步；
 * 4. 已编辑时有未保存改动 → 不静默覆盖，出现内联提示，「用最新资料覆盖 / 保留当前编辑」两个动作。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n";
import type { Job, Profile, ResumeEducation } from "../types";
import { legacyProfileToProjection, projectionOf } from "../test/profileProjectionFixture";
import ManualResumeModal from "./ManualResumeModal";

const apiMocks = vi.hoisted(() => ({
  createManualResume: vi.fn(),
  projection: null as unknown,
}));

vi.mock("../api/resumes", () => ({ createManualResume: apiMocks.createManualResume }));
vi.mock("../features/profile-library/useCurrentProjection", () => ({
  useCurrentProjection: () => ({
    data: apiMocks.projection,
    loading: false,
    error: null,
    reload: vi.fn(),
  }),
}));
vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));

const JOB = { id: 9, title: "机械设计工程师" } as Job;

/** 投影 content 里的教育条目（编辑器/后端 ResumeEducation 形状：courses 是数组）。 */
const RESUME_EDUCATION: ResumeEducation = {
  school: "示例大学",
  department: "",
  major: "软件工程",
  degree: "本科",
  study_form: "",
  degree_type: "",
  start_date: "2023.09",
  end_date: "2027.06",
  gpa: "3.8",
  courses: ["数据结构"],
  achievements: [],
};

/** 旧 `Profile` 夹具形状（`legacyProfileToProjection` 的输入），不是编辑器里的 ResumeEducation。 */
const EDUCATION: Profile["educations"][number] = {
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

/** 六个列表模块都有内容的资料：这样"预填了"与"没读到"才区分得开。 */
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
  educations: [EDUCATION],
  experiences: [
    {
      company: "示例科技",
      role: "前端实习生",
      start_date: "2025.03",
      end_date: "2025.08",
      description: "负责组件库开发",
    },
  ],
  campus_experiences: [],
  projects: [],
  skills: [{ name: "TypeScript", level: "熟练" }],
  awards: [],
};

function renderModal(job: Job | null = null) {
  return render(
    <AntdApp>
      <ManualResumeModal job={job} open onClose={vi.fn()} />
    </AntdApp>,
  );
}

function rerenderModal(view: ReturnType<typeof renderModal>, job: Job | null = null) {
  view.rerender(
    <AntdApp>
      <ManualResumeModal job={job} open onClose={vi.fn()} />
    </AntdApp>,
  );
}

/** 通用模式标题（渲染来自 t()；断言参数里不含 CJK，不进中文棘轮）。 */
const GENERAL_TITLE = () => t("resume.manual.title.general");
const JOB_TITLE = () => t("resume.manual.title.job", { title: JOB.title });
const REFRESH_TITLE = () => t("editor.profile-refresh.title");

beforeEach(() => {
  apiMocks.createManualResume.mockReset();
  apiMocks.createManualResume.mockResolvedValue({ id: 1 });
  apiMocks.projection = legacyProfileToProjection(FULL_PROFILE);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("新建简历的初始内容 = 当前组投影内容（F9/R1）", () => {
  it("通用模式：基本信息与六个模块都预填，不再是空白起步", async () => {
    renderModal();
    await screen.findByText(GENERAL_TITLE());

    expect(screen.getByLabelText("姓名")).toHaveValue("张三");
    expect(screen.getByLabelText("个人总结")).toHaveValue("资料里的个人总结");
    expect(screen.getByLabelText("求职意向")).toHaveValue("前端开发");

    fireEvent.click(await screen.findByRole("tab", { name: t("editor.tab.education") }));
    expect(await screen.findByLabelText("学校")).toHaveValue("示例大学");
    fireEvent.click(screen.getByRole("tab", { name: t("editor.tab.experience") }));
    expect(await screen.findByLabelText("公司")).toHaveValue("示例科技");
  });

  it("岗位模式同样预填当前组内容，只把求职意向覆盖成岗位名", async () => {
    renderModal(JOB);
    await screen.findByText(JOB_TITLE());

    expect(screen.getByLabelText("姓名")).toHaveValue("张三");
    expect(screen.getByLabelText("个人总结")).toHaveValue("资料里的个人总结");
    expect(screen.getByLabelText("求职意向")).toHaveValue(JOB.title);

    fireEvent.click(await screen.findByRole("tab", { name: t("editor.tab.education") }));
    expect(await screen.findByLabelText("学校")).toHaveValue("示例大学");
  });
});

describe("编辑器页签按当前组参与清单过滤（R1）", () => {
  it("当前组有的分区出现（即使没内容），没有且无内容的分区不出现", async () => {
    apiMocks.projection = projectionOf({
      keys: ["basic_info", "educations", "skills"],
      content: { name: "张三", education: [RESUME_EDUCATION] },
    });
    renderModal();
    await screen.findByText(GENERAL_TITLE());

    // 当前组有、但内容为空的分区也要有页签（可录入）。
    expect(await screen.findByRole("tab", { name: t("editor.tab.skills") })).toBeInTheDocument();
    // 当前组没有、内容也为空 → 页签不出现。
    expect(screen.queryByRole("tab", { name: t("editor.tab.experience") })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: t("editor.tab.awards") })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: t("editor.tab.projects") })).not.toBeInTheDocument();
    // 当前组有且内容非空 → 在。
    expect(screen.getByRole("tab", { name: t("editor.tab.education") })).toBeInTheDocument();
  });

  it("当前组没有的分区，只要正文里有内容就保留页签（R-34 不丢已保存正文）", async () => {
    apiMocks.projection = projectionOf({
      keys: ["basic_info"],
      content: { name: "张三", education: [RESUME_EDUCATION] },
    });
    renderModal();
    await screen.findByText(GENERAL_TITLE());
    expect(await screen.findByRole("tab", { name: t("editor.tab.education") })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: t("editor.tab.projects") })).not.toBeInTheDocument();
  });

  it("切组后页签跟着变，但已有内容的分区仍在（编辑器打开且未编辑）", async () => {
    apiMocks.projection = projectionOf({
      keys: ["basic_info", "educations", "projects"],
      content: { name: "张三", education: [RESUME_EDUCATION] },
    });
    const view = renderModal();
    await screen.findByText(GENERAL_TITLE());
    expect(await screen.findByRole("tab", { name: t("editor.tab.projects") })).toBeInTheDocument();

    // 别的窗口切到"只有基本信息"的组：内容仍按新投影重取（教育只剩已保存的那条）。
    apiMocks.projection = projectionOf({
      keys: ["basic_info"],
      content: { name: "张三", education: [RESUME_EDUCATION] },
    });
    rerenderModal(view);
    await waitFor(() =>
      expect(screen.queryByRole("tab", { name: t("editor.tab.projects") })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("tab", { name: t("editor.tab.education") })).toBeInTheDocument();
  });
});

describe("打开期间资料刷新：未编辑自动重同步（R1）", () => {
  it("投影刷新后表单内容跟着更新，且不出现刷新提示", async () => {
    apiMocks.projection = projectionOf({
      keys: ["basic_info", "summary"],
      content: { name: "张三", summary: "第一版总结" },
    });
    const view = renderModal();
    await screen.findByText(GENERAL_TITLE());
    await waitFor(() => expect(screen.getByLabelText("姓名")).toHaveValue("张三"));

    apiMocks.projection = projectionOf({
      keys: ["basic_info", "summary"],
      content: { name: "李四", summary: "第二版总结" },
    });
    rerenderModal(view);

    await waitFor(() => expect(screen.getByLabelText("姓名")).toHaveValue("李四"));
    expect(screen.getByLabelText("个人总结")).toHaveValue("第二版总结");
    expect(screen.queryByText(REFRESH_TITLE())).not.toBeInTheDocument();
  });
});

describe("打开期间资料刷新：已编辑时不静默覆盖（R1）", () => {
  async function renderEdited() {
    apiMocks.projection = projectionOf({
      keys: ["basic_info", "summary"],
      content: { name: "张三", summary: "第一版总结" },
    });
    const view = renderModal();
    await screen.findByText(GENERAL_TITLE());
    const nameInput = await waitFor(() => screen.getByLabelText("姓名"));
    fireEvent.change(nameInput, { target: { value: "我改的名字" } });
    expect(screen.getByLabelText("姓名")).toHaveValue("我改的名字");
    return view;
  }

  it("出现内联提示；选「保留当前编辑」不覆盖，下一次资料再变会重新提示", async () => {
    const view = await renderEdited();

    apiMocks.projection = projectionOf({
      keys: ["basic_info", "summary"],
      content: { name: "李四", summary: "第二版总结" },
    });
    rerenderModal(view);
    expect(await screen.findByText(REFRESH_TITLE())).toBeInTheDocument();
    // 没有静默覆盖。
    expect(screen.getByLabelText("姓名")).toHaveValue("我改的名字");

    fireEvent.click(screen.getByRole("button", { name: t("editor.profile-refresh.keep") }));
    await waitFor(() => expect(screen.queryByText(REFRESH_TITLE())).not.toBeInTheDocument());
    expect(screen.getByLabelText("姓名")).toHaveValue("我改的名字");

    // 资料又变了一次：重新提示（"保留"只对当次这一版生效）。
    apiMocks.projection = projectionOf({
      keys: ["basic_info", "summary"],
      content: { name: "王五", summary: "第三版总结" },
    });
    rerenderModal(view);
    expect(await screen.findByText(REFRESH_TITLE())).toBeInTheDocument();
  });

  it("选「用最新资料覆盖」后写回最新内容，之后的资料刷新恢复自动同步", async () => {
    const view = await renderEdited();

    apiMocks.projection = projectionOf({
      keys: ["basic_info", "summary"],
      content: { name: "李四", summary: "第二版总结" },
    });
    rerenderModal(view);
    await screen.findByText(REFRESH_TITLE());

    fireEvent.click(screen.getByRole("button", { name: t("editor.profile-refresh.apply") }));
    await waitFor(() => expect(screen.getByLabelText("姓名")).toHaveValue("李四"));
    expect(screen.getByLabelText("个人总结")).toHaveValue("第二版总结");
    await waitFor(() => expect(screen.queryByText(REFRESH_TITLE())).not.toBeInTheDocument());

    // 覆盖后表单与资料一致（不再脏）：下一次资料刷新直接自动同步。
    apiMocks.projection = projectionOf({
      keys: ["basic_info", "summary"],
      content: { name: "赵六", summary: "第四版总结" },
    });
    rerenderModal(view);
    await waitFor(() => expect(screen.getByLabelText("姓名")).toHaveValue("赵六"));
    expect(screen.queryByText(REFRESH_TITLE())).not.toBeInTheDocument();
  });
});
