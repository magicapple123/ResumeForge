/** 我的资料页：通用简历入口 + 分区折叠的接线（这个页面此前没有任何测试）。 */

import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SECTION_ORDER } from "../components/profile/ProfileSectionConfig";
import { TEMPLATE_CATALOG } from "../test/resumeFixtures";
import type { Profile } from "../types";
import ProfilePage from "./ProfilePage";

const apiMocks = vi.hoisted(() => ({
  getProfile: vi.fn(),
  listResumes: vi.fn(),
  getWebFormExtraProfile: vi.fn(),
  updateWebFormExtraProfile: vi.fn(),
}));

vi.mock("../api/profile", () => ({ getProfile: apiMocks.getProfile }));
// 「网申资料」走自己的接口（独立的表），这里一并假掉——不假的话这一页会去真发请求。
vi.mock("../api/webform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/webform")>()),
  getWebFormExtraProfile: apiMocks.getWebFormExtraProfile,
  updateWebFormExtraProfile: apiMocks.updateWebFormExtraProfile,
}));
// 展开真实模块再覆盖：显式列导出时，生产代码新增一个导出就会让调用方直接抛
// "export is not defined"，看起来像组件崩了。
vi.mock("../api/resumes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/resumes")>()),
  listResumes: apiMocks.listResumes,
  deleteResume: vi.fn(),
  renameResume: vi.fn(),
  getResume: vi.fn(),
  fetchResumeHtml: vi.fn(),
  renderResume: vi.fn(),
  updateResume: vi.fn(),
  generateResume: vi.fn(),
  createManualResume: vi.fn(),
  fetchResumeTemplates: vi.fn().mockResolvedValue(TEMPLATE_CATALOG),
}));
vi.mock("../api/settings", () => ({ getLLMConfig: vi.fn().mockResolvedValue({}) }));

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
  job_intent: "后端开发",
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

function renderPage() {
  render(
    <MemoryRouter>
      <AntdApp>
        <ProfilePage />
      </AntdApp>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  apiMocks.getProfile.mockReset().mockResolvedValue(PROFILE);
  apiMocks.listResumes.mockReset().mockResolvedValue({ items: [], total: 0 });
  apiMocks.getWebFormExtraProfile.mockReset().mockResolvedValue({
    fields: [
      {
        key: "cet6_score",
        label: "英语六级分数",
        group: "语言与证书",
        kind: "text",
        sensitive: false,
      },
      { key: "height", label: "身高(cm)", group: "身体情况", kind: "text", sensitive: true },
    ],
    groups: ["语言与证书", "身体情况"],
    values: {},
  });
  apiMocks.updateWebFormExtraProfile.mockReset().mockResolvedValue({
    fields: [],
    groups: [],
    values: {},
  });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ProfilePage 通用简历", () => {
  it("renders the general-resume card outside of edit mode, above the profile sections", async () => {
    renderPage();

    // 非编辑状态也要能用：写简历不是改资料
    expect(await screen.findByLabelText("通用简历名称")).toBeEnabled();
    expect(screen.getByRole("button", { name: /AI 生成/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /从头手写/ })).toBeEnabled();
    expect(await screen.findByText("还没有通用简历")).toBeInTheDocument();

    // 「通用简历」不再沉在资料最底部：它要出现在资料分区（基本信息）之前。
    const general = document.getElementById("general-resume-section");
    const basicSectionToggle = screen.getByRole("button", { name: "收起基本信息" });
    expect(general).not.toBeNull();
    expect(
      (general as HTMLElement).compareDocumentPosition(basicSectionToggle) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("carries the typed name into the generate modal", async () => {
    renderPage();
    await screen.findByText("还没有通用简历");

    fireEvent.change(screen.getByLabelText("通用简历名称"), {
      target: { value: "研发通用版" },
    });
    fireEvent.click(screen.getByRole("button", { name: /AI 生成/ }));

    expect(await screen.findByText("生成通用简历")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("简历名称")).toHaveValue("研发通用版"));
  });

  it("carries the typed name into the manual editor", async () => {
    renderPage();
    await screen.findByText("还没有通用简历");

    fireEvent.change(screen.getByLabelText("通用简历名称"), {
      target: { value: "管培生版" },
    });
    fireEvent.click(screen.getByRole("button", { name: /从头手写/ }));

    expect(await screen.findByText("从头编写通用简历")).toBeInTheDocument();
  });
});

describe("ProfilePage 资料分页", () => {
  it("默认显示简历资料，切换后显示独立的网申资料板块", async () => {
    renderPage();

    expect(await screen.findByLabelText("通用简历名称")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "简历资料" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "网申资料" })).toHaveAttribute("aria-selected", "false");

    fireEvent.click(screen.getByRole("tab", { name: "网申资料" }));
    const webFormPanel = await screen.findByRole("tabpanel");
    expect(
      within(webFormPanel).getByText("这一区只给「网申填表」用，不会进入简历"),
    ).toBeInTheDocument();
    expect(within(webFormPanel).queryByLabelText("通用简历名称")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /全部收起/ })).not.toBeInTheDocument();
  });

  it("原有网申字段并入统一的网申资料板块", async () => {
    apiMocks.getWebFormExtraProfile.mockResolvedValue({
      fields: [
        {
          key: "id_number",
          label: "证件号码",
          group: "身份信息",
          kind: "text",
          sensitive: true,
        },
      ],
      groups: ["身份信息"],
      values: {},
      repeated_groups: [],
    });
    renderPage();

    const resumePanel = await screen.findByRole("tabpanel");
    expect(within(resumePanel).queryByText("网申专用资料")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "网申资料" }));
    const webFormPanel = await screen.findByRole("tabpanel");
    expect(within(webFormPanel).getByText("网申资料", { exact: true })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /编辑资料/ }));
    expect(within(webFormPanel).getByLabelText("证件号码")).toBeEnabled();
  });

  it("切换资料分页不会丢失当前编辑状态", async () => {
    renderPage();
    await screen.findByLabelText("通用简历名称");
    fireEvent.click(screen.getByRole("button", { name: /编辑资料/ }));

    fireEvent.click(screen.getByRole("tab", { name: "网申资料" }));
    expect(await screen.findByLabelText("英语六级分数")).toBeEnabled();
    fireEvent.change(screen.getByLabelText("英语六级分数"), { target: { value: "512" } });

    fireEvent.click(screen.getByRole("tab", { name: "简历资料" }));
    fireEvent.click(screen.getByRole("tab", { name: "网申资料" }));
    expect(screen.getByLabelText("英语六级分数")).toHaveValue("512");
  });
});

describe("ProfilePage 分区折叠", () => {
  it("默认展开每个分区，点标题可收起", async () => {
    renderPage();
    await screen.findByLabelText("通用简历名称");

    // 默认全展开：这一页是"我的资料"，进来就是要看内容的（用户反馈过"应该默认展开"）。
    const basicToggle = screen.getByRole("button", { name: "收起基本信息" });
    expect(basicToggle).toHaveAttribute("aria-expanded", "true");

    // 点标题收起后，按钮翻转成「展开」。
    fireEvent.click(basicToggle);
    const collapsedToggle = screen.getByRole("button", { name: "展开基本信息" });
    expect(collapsedToggle).toHaveAttribute("aria-expanded", "false");
  });

  it("「全部收起」一键收回，再点「全部展开」一键展开", async () => {
    renderPage();
    await screen.findByLabelText("通用简历名称");

    // 页头按钮带图标，可访问名是「图标名 + 文字」，用正则匹配文字部分即可。
    const collapseAll = screen.getByRole("button", { name: /全部收起/ });
    fireEvent.click(collapseAll);

    // 全部收起后：每个分区标题都变成「展开」，页头按钮变成「全部展开」。
    expect(screen.getByRole("button", { name: "展开基本信息" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "展开教育经历" })).toBeInTheDocument();
    const expandAll = screen.getByRole("button", { name: /全部展开/ });

    fireEvent.click(expandAll);
    expect(screen.getByRole("button", { name: "收起基本信息" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /全部收起/ })).toBeInTheDocument();
  });
});

/**
 * 「网申资料」：给网申填表用的补充资料，与简历资料分开存。
 *
 * 这里守两件事：它能在这儿编辑保存；以及它**不进**可拖拽排序的分区栈——后端按
 * `PROFILE_SECTION_KEYS` 归一化 `section_order`，不认识的键会被**静默丢弃**，
 * 混进去会让分区顺序看起来莫名其妙地变了（`ProfileSectionConfig` 里有同款说明）。
 */
describe("ProfilePage 「网申资料」", () => {
  async function openWebFormTab() {
    const tab = await screen.findByRole("tab", { name: "网申资料" });
    fireEvent.click(tab);
    await waitFor(() => {
      const panel = screen.getByRole("tabpanel");
      expect(within(panel).getByText("这一区只给「网申填表」用，不会进入简历")).toBeInTheDocument();
    });
  }

  it("渲染出「网申资料」区块，并说明它不进简历", async () => {
    renderPage();

    await openWebFormTab();
    expect(screen.getByText("这一区只给「网申填表」用，不会进入简历")).toBeInTheDocument();
  });

  it("查看态只显示已填的项，不铺一屏空标签", async () => {
    apiMocks.getWebFormExtraProfile.mockResolvedValue({
      fields: [
        {
          key: "cet6_score",
          label: "英语六级分数",
          group: "语言与证书",
          kind: "text",
          sensitive: false,
        },
        { key: "student_id", label: "学号", group: "学籍与档案", kind: "text", sensitive: false },
      ],
      groups: ["语言与证书", "学籍与档案"],
      values: { cet6_score: "512" },
    });
    renderPage();
    await openWebFormTab();

    // 填过的那条显示出来。
    expect(await screen.findByText("512")).toBeInTheDocument();
    // 整组都空的分区不渲染（否则一屏空标题，用户找不到自己填过什么）。
    expect(screen.queryByText("学籍与档案")).not.toBeInTheDocument();
    expect(screen.queryByText("学号")).not.toBeInTheDocument();
  });

  it("敏感项不显示「只存本机」标签", async () => {
    apiMocks.getWebFormExtraProfile.mockResolvedValue({
      fields: [
        { key: "height", label: "身高(cm)", group: "身体情况", kind: "text", sensitive: true },
      ],
      groups: ["身体情况"],
      values: { height: "178" },
    });
    renderPage();
    await openWebFormTab();

    expect(await screen.findByText("身高(cm)")).toBeInTheDocument();
    expect(screen.queryByText("只存本机", { exact: true })).not.toBeInTheDocument();
  });

  it("编辑态所有字段都可输入（含空的那些）", async () => {
    renderPage();
    await openWebFormTab();

    fireEvent.click(screen.getByRole("button", { name: /编辑资料/ }));

    // 编辑态才铺出全部输入框——查看态看不到空字段。
    expect(await screen.findByLabelText("英语六级分数")).toBeInTheDocument();
    expect(screen.getByLabelText("身高(cm)")).toBeInTheDocument();
  });

  it("保存全部资料时，网申资料也跟着存一次", async () => {
    renderPage();
    await openWebFormTab();
    fireEvent.click(screen.getByRole("button", { name: /编辑资料/ }));

    const input = await screen.findByLabelText("英语六级分数");
    fireEvent.change(input, { target: { value: "512" } });
    fireEvent.click(screen.getByRole("button", { name: /保存全部资料/ }));

    await waitFor(() =>
      // 第二个参数是每条的来源与档位——保存时一起提交，用户在界面上改的档位才会生效。
      expect(apiMocks.updateWebFormExtraProfile).toHaveBeenCalledWith(
        { cet6_score: "512" },
        {},
        {},
      ),
    );
  });

  it("编辑态可以新增自定义网申字段并随资料一起保存", async () => {
    renderPage();
    await openWebFormTab();
    fireEvent.click(screen.getByRole("button", { name: /编辑资料/ }));

    fireEvent.change(screen.getByLabelText("英语六级分数"), { target: { value: "512" } });

    fireEvent.change(screen.getByLabelText("新增自定义网申字段名称"), {
      target: { value: "实验室" },
    });
    const customFieldControls = screen
      .getByLabelText("新增自定义网申字段名称")
      .closest(".ant-space-compact");
    expect(customFieldControls).not.toBeNull();
    fireEvent.click(
      within(customFieldControls as HTMLElement).getByRole("button", { name: /添加/ }),
    );

    const customValue = await screen.findByLabelText("实验室");
    fireEvent.change(customValue, { target: { value: "智能计算实验室" } });
    fireEvent.click(screen.getByRole("button", { name: /保存全部资料/ }));

    await waitFor(() =>
      expect(apiMocks.updateWebFormExtraProfile).toHaveBeenCalledWith(
        { cet6_score: "512", CUSTOM_实验室: "智能计算实验室" },
        {
          CUSTOM_实验室: {
            value: "",
            source: "manual",
            reuse: "general",
            label: "实验室",
          },
        },
        {},
      ),
    );
  });

  it("编辑态可以修改自定义字段名并保留原值", async () => {
    apiMocks.getWebFormExtraProfile.mockResolvedValue({
      fields: [
        {
          key: "CUSTOM_实验室",
          label: "实验室",
          group: "自定义",
          kind: "text",
          sensitive: false,
          matchable: false,
        },
      ],
      groups: ["自定义"],
      values: { CUSTOM_实验室: "智能计算实验室" },
      details: {
        CUSTOM_实验室: {
          value: "智能计算实验室",
          source: "manual",
          reuse: "general",
          label: "实验室",
        },
      },
    });
    renderPage();
    await openWebFormTab();
    await screen.findByText("实验室");
    fireEvent.click(screen.getByRole("button", { name: /编辑资料/ }));

    fireEvent.click(screen.getByRole("button", { name: "修改字段名：实验室" }));
    const renameInput = screen.getByRole("textbox", { name: "编辑字段名：实验室" });
    fireEvent.change(renameInput, { target: { value: "导师姓名" } });
    fireEvent.click(screen.getByRole("button", { name: "保存字段名" }));
    fireEvent.click(screen.getByRole("button", { name: /保存全部资料/ }));

    await waitFor(() =>
      expect(apiMocks.updateWebFormExtraProfile).toHaveBeenCalledWith(
        { CUSTOM_实验室: "智能计算实验室" },
        {
          CUSTOM_实验室: {
            value: "智能计算实验室",
            source: "manual",
            reuse: "general",
            label: "导师姓名",
          },
        },
        {},
      ),
    );
  });

  it("删除自定义字段后不会再提交它", async () => {
    apiMocks.getWebFormExtraProfile.mockResolvedValue({
      fields: [
        {
          key: "CUSTOM_实验室",
          label: "实验室",
          group: "自定义",
          kind: "text",
          sensitive: false,
          matchable: false,
        },
      ],
      groups: ["自定义"],
      values: { CUSTOM_实验室: "智能计算实验室" },
      details: {
        CUSTOM_实验室: {
          value: "智能计算实验室",
          source: "manual",
          reuse: "general",
          label: "实验室",
        },
      },
    });
    renderPage();
    await openWebFormTab();
    await screen.findByText("实验室");
    fireEvent.click(screen.getByRole("button", { name: /编辑资料/ }));
    fireEvent.click(screen.getByRole("button", { name: "删除自定义字段：实验室" }));
    fireEvent.click(screen.getByRole("button", { name: /确\s*定/ }));
    fireEvent.click(screen.getByRole("button", { name: /保存全部资料/ }));

    await waitFor(() =>
      expect(apiMocks.updateWebFormExtraProfile).toHaveBeenCalledWith({}, {}, {}),
    );
  });

  it("可新增多条教育补充记录，删除后按剩余顺序保存", async () => {
    apiMocks.getWebFormExtraProfile.mockResolvedValue({
      fields: [],
      groups: [],
      values: {},
      repeated_groups: [
        {
          key: "education",
          label: "教育经历补充",
          family: "education",
          fields: [
            {
              key: "education_class_rank",
              label: "班级排名",
              kind: "text",
              sensitive: false,
            },
          ],
          records: [],
        },
      ],
    });
    apiMocks.updateWebFormExtraProfile.mockResolvedValue({
      fields: [],
      groups: [],
      values: {},
      repeated_groups: [],
    });
    renderPage();
    await openWebFormTab();
    fireEvent.click(screen.getByRole("button", { name: /编辑资料/ }));

    fireEvent.click(screen.getByRole("button", { name: "新增教育经历补充" }));
    fireEvent.change(await screen.findByLabelText("教育经历补充第1条班级排名"), {
      target: { value: "3" },
    });
    fireEvent.click(screen.getByRole("button", { name: "新增教育经历补充" }));
    fireEvent.change(screen.getByLabelText("教育经历补充第2条班级排名"), {
      target: { value: "1" },
    });

    fireEvent.click(screen.getByRole("button", { name: "删除教育经历补充第1条" }));
    expect(screen.getByLabelText("教育经历补充第1条班级排名")).toHaveValue("1");

    fireEvent.click(screen.getByRole("button", { name: /保存全部资料/ }));

    await waitFor(() =>
      expect(apiMocks.updateWebFormExtraProfile).toHaveBeenCalledWith(
        {},
        {},
        {
          education: [
            {
              id: undefined,
              values: { education_class_rank: "1" },
            },
          ],
        },
      ),
    );
  });

  it("「网申资料」不进可拖拽排序的分区栈", () => {
    // 后端会丢掉它不认识的 section_order 键，混进排序栈会让分区顺序莫名其妙地变。
    // 所以它必须留在 DEFAULT_SECTION_ORDER 与 ProfileSectionKey 的排序白名单之外。
    expect(DEFAULT_SECTION_ORDER).not.toContain("web_form_profile");
  });
});
