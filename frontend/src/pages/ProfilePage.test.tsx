/** 我的资料页：通用简历入口 + 分区折叠的接线（这个页面此前没有任何测试）。 */

import { App as AntdApp } from "antd";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SECTION_ORDER } from "../components/profile/ProfileSectionConfig";
import {
  getProfileEditControl,
  getProfileSaveControl,
  setProfileEditControl,
  setProfileSaveControl,
} from "../features/tou-tou/profileSaveBridge";
import { TEMPLATE_CATALOG } from "../test/resumeFixtures";
import type { Profile } from "../types";
import ProfilePage from "./ProfilePage";

const apiMocks = vi.hoisted(() => ({
  getProfile: vi.fn(),
  saveProfile: vi.fn(),
  listResumes: vi.fn(),
  getWebFormExtraProfile: vi.fn(),
  updateWebFormExtraProfile: vi.fn(),
}));

// 「保存全部资料」的第一半走 saveProfile；此前没假它，submit 内部会静默失败——
// 未保存防护的用例要靠它成功来断言"警示解除"，所以一并 mock。
vi.mock("../api/profile", () => ({
  getProfile: apiMocks.getProfile,
  saveProfile: apiMocks.saveProfile,
}));
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

// 渲染次数探针（透传真实组件，只多记一次数）：
// - `ProfilePageHeader` 在页面顶层、`Form` 之外——它重渲即"整页重渲"。
// - `PartialDateSelect` 在「简历资料」的 `Form.Item` 里——整页重渲时，包住两个 tab 的
//   `Form` 会重渲、context 换新引用，它就被带着一起重渲（实测每次击键 12 次）。
// 两者合起来钉住「网申资料打字不再惊动整页与简历资料子树」这条性质。
const renderProbes = vi.hoisted(() => ({ header: 0, dateSelect: 0 }));

vi.mock("../components/profile/ProfilePageHeader", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../components/profile/ProfilePageHeader")>();
  const React = await import("react");
  return {
    ...actual,
    default: (props: React.ComponentProps<typeof actual.default>) => {
      renderProbes.header += 1;
      // createElement 而不是直接调用：组件可能被 memo 包裹（可调用对象 vs 函数）。
      return React.createElement(actual.default, props);
    },
  };
});

vi.mock("../components/profile/PartialDateSelect", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../components/profile/PartialDateSelect")>();
  const React = await import("react");
  return {
    ...actual,
    default: (props: React.ComponentProps<typeof actual.default>) => {
      renderProbes.dateSelect += 1;
      // PartialDateSelect 已 memo 化：bail 的渲染不会走到这里，探针数的就是真实重渲。
      return React.createElement(actual.default, props);
    },
  };
});

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
  return render(
    <MemoryRouter>
      <AntdApp>
        <ProfilePage />
      </AntdApp>
    </MemoryRouter>,
  );
}

async function openWebFormTab() {
  const tab = await screen.findByRole("tab", { name: "网申资料" });
  fireEvent.click(tab);
  await waitFor(() => {
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByText("这一区只给「网申填表」用，不会进入简历")).toBeInTheDocument();
  });
}

beforeEach(() => {
  apiMocks.getProfile.mockReset().mockResolvedValue(PROFILE);
  apiMocks.saveProfile.mockReset().mockResolvedValue(PROFILE);
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
  // 桥的两个槽都是模块级单例：正常路径下卸载即置 null，这里再兜一道，避免脏态串进下一条用例。
  setProfileSaveControl(null);
  setProfileEditControl(null);
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

/**
 * 未保存防护：这一页是整页表单、只有「保存全部资料」一个提交口，中途刷新/关闭
 * 浏览器会静默丢掉全部未保存编辑。这里钉住 beforeunload 的挂载/解除时机——
 * 有更改就挂上（浏览器出原生的"未保存的更改将丢失"），两次提交都成功才解除。
 */
describe("ProfilePage 未保存防护", () => {
  function spyBeforeUnload() {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");
    return { addSpy, removeSpy };
  }

  it("表单有更改后挂上 beforeunload 监听，刷新/关闭不再静默丢稿", async () => {
    const { addSpy, removeSpy } = spyBeforeUnload();
    renderPage();
    await screen.findByText("还没有通用简历");

    fireEvent.click(screen.getByRole("tab", { name: "网申资料" }));
    fireEvent.click(screen.getByRole("button", { name: /编辑资料/ }));
    fireEvent.change(await screen.findByLabelText("英语六级分数"), { target: { value: "512" } });

    await waitFor(() => expect(addSpy).toHaveBeenCalledWith("beforeunload", expect.any(Function)));
    // 未保存期间不能提前拆掉警示。
    expect(removeSpy).not.toHaveBeenCalledWith("beforeunload", expect.any(Function));
  });

  it("保存全部成功后移除 beforeunload 监听", async () => {
    const { addSpy, removeSpy } = spyBeforeUnload();
    renderPage();
    await screen.findByText("还没有通用简历");

    fireEvent.click(screen.getByRole("tab", { name: "网申资料" }));
    fireEvent.click(screen.getByRole("button", { name: /编辑资料/ }));
    fireEvent.change(await screen.findByLabelText("英语六级分数"), { target: { value: "512" } });
    await waitFor(() => expect(addSpy).toHaveBeenCalledWith("beforeunload", expect.any(Function)));

    fireEvent.click(screen.getByRole("button", { name: /保存全部资料/ }));

    // 两次提交都成功（saveProfile 与 updateWebFormExtraProfile 均已 mock 成功）→ 解除警示。
    await waitFor(() =>
      expect(removeSpy).toHaveBeenCalledWith("beforeunload", expect.any(Function)),
    );
    expect(apiMocks.saveProfile).toHaveBeenCalled();
    expect(apiMocks.updateWebFormExtraProfile).toHaveBeenCalledWith({ cet6_score: "512" }, {}, {});
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
          matchable: true,
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
          matchable: true,
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

  it("新增自定义字段不会冲掉还没保存的多条记录", async () => {
    // 新增自定义字段会让 WebFormProfileSection 再走一次 onLoaded，而那次带回的
    // repeated_groups 是进入页面时的旧值。照它回填会把用户刚编辑、还没保存的多条记录
    // 改回去（那段代码自己的注释说的是"必须保留用户刚输入、尚未保存的值"）。
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
            { key: "education_class_rank", label: "班级排名", kind: "text", sensitive: false },
          ],
          records: [{ id: 1, values: { education_class_rank: "旧排名" } }],
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

    fireEvent.change(await screen.findByLabelText("教育经历补充第1条班级排名"), {
      target: { value: "新排名" },
    });
    fireEvent.change(screen.getByLabelText("新增自定义网申字段名称"), {
      target: { value: "实验室" },
    });
    fireEvent.click(screen.getByRole("button", { name: /添加/ }));
    fireEvent.click(screen.getByRole("button", { name: /保存全部资料/ }));

    await waitFor(() =>
      expect(apiMocks.updateWebFormExtraProfile).toHaveBeenCalledWith(
        { CUSTOM_实验室: "" },
        {
          CUSTOM_实验室: { value: "", source: "manual", reuse: "general", label: "实验室" },
        },
        { education: [{ id: 1, values: { education_class_rank: "新排名" } }] },
      ),
    );
  });

  it("先点编辑资料、之后才打开网申资料，取消一次后仍能正常提交", async () => {
    // 目录是懒加载的：在「简历资料」tab 点「编辑资料」时页面还没有目录。若照"进入编辑时"的
    // 快照回滚目录，就会把已经加载好的目录清成 null——之后再点「保存全部资料」，整份网申资料
    // 都不会提交（界面上却毫无提示）。
    renderPage();
    // 加载态只有骨架屏，页头按钮要等资料取回来才出现。
    fireEvent.click(await screen.findByRole("button", { name: /编辑资料/ }));
    await openWebFormTab();
    fireEvent.click(screen.getByRole("button", { name: /取消/ }));
    fireEvent.click(screen.getByRole("button", { name: /编辑资料/ }));

    const input = await within(screen.getByRole("tabpanel")).findByLabelText("英语六级分数");
    fireEvent.change(input, { target: { value: "512" } });
    fireEvent.click(screen.getByRole("button", { name: /保存全部资料/ }));

    await waitFor(() =>
      expect(apiMocks.updateWebFormExtraProfile).toHaveBeenCalledWith(
        { cet6_score: "512" },
        {},
        {},
      ),
    );
  });

  it("「网申资料」不进可拖拽排序的分区栈", () => {
    // 后端会丢掉它不认识的 section_order 键，混进排序栈会让分区顺序莫名其妙地变。
    // 所以它必须留在 DEFAULT_SECTION_ORDER 与 ProfileSectionKey 的排序白名单之外。
    expect(DEFAULT_SECTION_ORDER).not.toContain("web_form_profile");
  });

  it("编辑置脏时挂上悬浮球保存桥，保存成功后收起", async () => {
    // 桥（features/tou-tou/profileSaveBridge）是投投悬浮球「保存资料/取消」的页面侧接线：
    // 页面表单脏时挂上控制块（onSave/onCancel 复用顶部保存条的同一套逻辑），
    // 两次保存都成功、dirty 翻回 false 后自动收起。
    renderPage();
    await openWebFormTab();
    fireEvent.click(screen.getByRole("button", { name: /编辑资料/ }));
    fireEvent.change(await screen.findByLabelText("英语六级分数"), { target: { value: "512" } });

    await waitFor(() => expect(getProfileSaveControl()).not.toBeNull());

    fireEvent.click(screen.getByRole("button", { name: /保存全部资料/ }));
    await waitFor(() => expect(getProfileSaveControl()).toBeNull());
    expect(apiMocks.updateWebFormExtraProfile).toHaveBeenCalled();
  });
});

describe("ProfilePage 悬浮球「去改资料」提示卡", () => {
  it("挂载后注册编辑入口，点它等同于点页头的「编辑资料」", async () => {
    renderPage();
    await waitFor(() => expect(getProfileEditControl()).not.toBeNull());

    act(() => getProfileEditControl()?.onEdit());

    // 进入编辑态：页头换成取消 / 保存全部资料。
    expect(await screen.findByRole("button", { name: /保存全部资料/ })).toBeInTheDocument();
  });

  it("资料还没加载完时不注册（那时点了也没反应）", async () => {
    apiMocks.getProfile.mockReturnValue(new Promise(() => {}));
    renderPage();

    // 加载态只有骨架屏；桥上也就不该有东西。
    expect(document.querySelector(".ant-skeleton")).not.toBeNull();
    expect(getProfileEditControl()).toBeNull();
  });

  it("进入编辑态后注销，取消编辑也不再弹回来（点过就算提醒过了）", async () => {
    renderPage();
    await waitFor(() => expect(getProfileEditControl()).not.toBeNull());

    act(() => getProfileEditControl()?.onEdit());
    await waitFor(() => expect(getProfileEditControl()).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: /取消/ }));
    await screen.findByRole("button", { name: /编辑资料/ });
    // 卡片起初就是为了让人知道去哪改资料；取消一次编辑后再催一遍属于打扰。
    expect(getProfileEditControl()).toBeNull();
  });

  it("关掉之后本次进入不再注册", async () => {
    renderPage();
    await waitFor(() => expect(getProfileEditControl()).not.toBeNull());

    act(() => getProfileEditControl()?.onDismiss());
    await waitFor(() => expect(getProfileEditControl()).toBeNull());

    // 之后页面再重渲（例如切分页）也不该把它加回来。
    fireEvent.click(await screen.findByRole("tab", { name: "网申资料" }));
    await waitFor(() =>
      expect(screen.getByText("这一区只给「网申填表」用，不会进入简历")).toBeInTheDocument(),
    );
    expect(getProfileEditControl()).toBeNull();
  });

  it("离开这一页（卸载）时注销，回来才会重新提醒", async () => {
    const view = renderPage();
    await waitFor(() => expect(getProfileEditControl()).not.toBeNull());

    view.unmount();

    expect(getProfileEditControl()).toBeNull();
  });
});

describe("ProfilePage 「网申资料」输入性能", () => {
  it("打字不再重渲整页，也不再重渲简历资料的日期字段", async () => {
    // 草稿原先由本页持有（因为「保存全部资料」要一次提交两份数据），于是每敲一个字符都重渲
    // 整页：包住两个 tab 的 `Form` 跟着重渲、context 换新引用，「简历资料」那 67 个
    // `Form.Item`（含日期三连选）全部被带着重渲。实测一次击键「输入 → 两帧」要 76～178ms
    // （开发构建）、35～48ms（生产构建）。草稿下移到 `WebFormProfileWorkspace` 之后，
    // 击键只该重渲那一棵子树。
    renderProbes.header = 0;
    renderProbes.dateSelect = 0;
    // 「简历资料」要有日期字段，才测得到"它没被带着一起重渲"。
    apiMocks.getProfile.mockResolvedValue({
      ...PROFILE,
      educations: [
        {
          school: "天津工业大学",
          department: "计算机科学与技术学院",
          major: "软件工程",
          degree: "本科",
          study_mode: "全日制",
          degree_type: "学士",
          start_date: "2023-09",
          end_date: "2027-06",
          gpa: "",
          cet4_score: "",
          cet6_score: "",
          courses: "",
          achievements: "",
        },
      ],
    });
    renderPage();
    await openWebFormTab();
    fireEvent.click(screen.getByRole("button", { name: /编辑资料/ }));

    // 简历资料的「教育经历」里也有一个「英语六级分数」，所以要限定在网申资料面板内取。
    const input = await within(screen.getByRole("tabpanel")).findByLabelText("英语六级分数");
    // 前提：简历资料的日期字段确实渲染出来了，否则下面那条断言不成立。
    expect(renderProbes.dateSelect).toBeGreaterThan(0);
    const dateRenders = renderProbes.dateSelect;
    const headerRenders = renderProbes.header;

    // 第一次改动会让 dirty 由假翻真（未保存防护与悬浮球保存桥要用它），页面至多重渲一次；
    // 之后的每一次击键都不该再惊动页面。
    fireEvent.change(input, { target: { value: "5" } });
    const headerAfterFirst = renderProbes.header;
    expect(headerAfterFirst).toBeLessThanOrEqual(headerRenders + 1);

    fireEvent.change(input, { target: { value: "51" } });
    fireEvent.change(input, { target: { value: "512" } });

    expect(renderProbes.header).toBe(headerAfterFirst);
    // 含第一次在内：网申资料打字一次都不该把简历资料的日期字段带着重渲。
    expect(renderProbes.dateSelect).toBe(dateRenders);
  });
});
