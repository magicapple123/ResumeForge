// SPDX-License-Identifier: Apache-2.0
/** 我的资料页：通用页面行为（通用简历/分页/未保存防护/折叠/悬浮球卡/输入性能）。 */

import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getProfileEditControl } from "../features/tou-tou/profileSaveBridge";
import { TEMPLATE_CATALOG } from "../test/resumeFixtures";
import {
  cleanupProfilePage,
  DEFAULT_PROFILE,
  openWebFormTab,
  renderProfilePage,
  resetProfileApiMocks,
} from "../test/profilePageHarness";

const apiMocks = vi.hoisted(() => ({
  getProfile: vi.fn(),
  saveProfile: vi.fn(),
  parseProfileText: vi.fn(),
  listResumes: vi.fn(),
  getWebFormExtraProfile: vi.fn(),
  updateWebFormExtraProfile: vi.fn(),
}));

// 「保存全部资料」的第一半走 saveProfile；此前没假它，submit 内部会静默失败——
// 未保存防护的用例要靠它成功来断言"警示解除"，所以一并 mock。
vi.mock("../api/profile", () => ({
  getProfile: apiMocks.getProfile,
  saveProfile: apiMocks.saveProfile,
  parseProfileText: apiMocks.parseProfileText,
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
// 「生成通用简历」弹窗里的版式栏含「简历字体」（项 14），它会读一次已上传字体清单；
// 本文件守的是页面行为，给它一份空清单即可。
vi.mock("../api/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/settings")>()),
  getLLMConfig: vi.fn().mockResolvedValue({}),
  listResumeFonts: vi.fn().mockResolvedValue({ items: [], active: null, max_bytes: 1 }),
}));

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

beforeEach(() => {
  resetProfileApiMocks(apiMocks);
});

afterEach(() => {
  cleanupProfilePage();
});

describe("ProfilePage 通用简历", () => {
  it("renders the general-resume card outside of edit mode, above the profile sections", async () => {
    renderProfilePage();

    // 非编辑状态也要能用：写简历不是改资料
    // 项 11：名称输入已移进编辑器，页面上只剩两个入口按钮。
    expect(await screen.findByRole("button", { name: /AI 生成/ })).toBeEnabled();
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

  it("opens the generate modal without a page-level name box", async () => {
    renderProfilePage();
    await screen.findByText("还没有通用简历");

    expect(screen.queryByLabelText("通用简历名称")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /AI 生成/ }));

    expect(await screen.findByText("生成通用简历")).toBeInTheDocument();
    // 名称在弹窗里填：页面不再预先带一个值过来。
    await waitFor(() => expect(screen.getByLabelText("简历名称")).toHaveValue(""));
  });

  it("lets the manual editor name the resume (项 11)", async () => {
    renderProfilePage();
    await screen.findByText("还没有通用简历");

    fireEvent.click(screen.getByRole("button", { name: /从头手写/ }));

    expect(await screen.findByText("从头编写通用简历")).toBeInTheDocument();
    fireEvent.change(await screen.findByLabelText("简历名称"), {
      target: { value: "管培生版" },
    });
    expect(screen.getByLabelText("简历名称")).toHaveValue("管培生版");
  });
});

describe("ProfilePage 资料分页", () => {
  it("默认显示简历资料，切换后显示独立的网申资料板块", async () => {
    renderProfilePage();

    expect(await screen.findByText("还没有通用简历")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "简历资料" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "网申资料" })).toHaveAttribute("aria-selected", "false");

    fireEvent.click(screen.getByRole("tab", { name: "网申资料" }));
    const webFormPanel = await screen.findByRole("tabpanel");
    expect(
      await within(webFormPanel).findByText("这一区只给「网申填表」用，不会进入简历"),
    ).toBeInTheDocument();
    expect(within(webFormPanel).queryByLabelText("简历名称")).not.toBeInTheDocument();
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
    renderProfilePage();

    const resumePanel = await screen.findByRole("tabpanel");
    expect(within(resumePanel).queryByText("网申专用资料")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "网申资料" }));
    const webFormPanel = await screen.findByRole("tabpanel");
    expect(await within(webFormPanel).findByText("网申资料", { exact: true })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /编辑资料/ }));
    expect(await within(webFormPanel).findByLabelText("证件号码")).toBeEnabled();
  });

  it("切换资料分页不会丢失当前编辑状态", async () => {
    renderProfilePage();
    await screen.findByText("还没有通用简历");
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
    renderProfilePage();
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
    renderProfilePage();
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
  it("非编辑态下条目的日期选择框跟随表单禁用", async () => {
    // 回归（用户实测）：PartialDateSelect 此前恒传 disabled=false，antd Select 的
    // 合并规则（customDisabled ?? contextDisabled）让显式 false 覆盖 Form 级禁用，
    // 查看态的出生/经历日期仍可修改。这里钉住"查看态确实禁用"这条端到端行为。
    apiMocks.getProfile.mockResolvedValue({
      ...DEFAULT_PROFILE,
      educations: [{ school: "示例大学", start_date: "2022-09", end_date: "2026-06" }],
    });
    renderProfilePage();
    await screen.findByText("还没有通用简历");

    const yearCombobox = await screen.findByRole("combobox", { name: "教育经历1开始时间年份" });
    expect(yearCombobox.closest(".ant-select")).toHaveClass("ant-select-disabled");
  });

  it("默认展开每个分区，点标题可收起", async () => {
    renderProfilePage();
    await screen.findByText("还没有通用简历");

    // 默认全展开：这一页是"我的资料"，进来就是要看内容的（用户反馈过"应该默认展开"）。
    const basicToggle = screen.getByRole("button", { name: "收起基本信息" });
    expect(basicToggle).toHaveAttribute("aria-expanded", "true");

    // 点标题收起后，按钮翻转成「展开」。
    fireEvent.click(basicToggle);
    const collapsedToggle = screen.getByRole("button", { name: "展开基本信息" });
    expect(collapsedToggle).toHaveAttribute("aria-expanded", "false");
  });

  it("「全部收起」一键收回，再点「全部展开」一键展开", async () => {
    renderProfilePage();
    await screen.findByText("还没有通用简历");

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

describe("ProfilePage 悬浮球「去改资料」提示卡", () => {
  it("挂载后注册编辑入口，点它等同于点页头的「编辑资料」", async () => {
    renderProfilePage();
    await waitFor(() => expect(getProfileEditControl()).not.toBeNull());

    act(() => getProfileEditControl()?.onEdit());

    // 进入编辑态：页头换成取消 / 保存全部资料。
    expect(await screen.findByRole("button", { name: /保存全部资料/ })).toBeInTheDocument();
  });

  it("资料还没加载完时不注册（那时点了也没反应）", async () => {
    apiMocks.getProfile.mockReturnValue(new Promise(() => {}));
    renderProfilePage();

    // 加载态只有骨架屏；桥上也就不该有东西。
    expect(document.querySelector(".ant-skeleton")).not.toBeNull();
    expect(getProfileEditControl()).toBeNull();
  });

  it("进入编辑态后注销，取消编辑也不再弹回来（点过就算提醒过了）", async () => {
    renderProfilePage();
    await waitFor(() => expect(getProfileEditControl()).not.toBeNull());

    act(() => getProfileEditControl()?.onEdit());
    await waitFor(() => expect(getProfileEditControl()).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: /取消/ }));
    await screen.findByRole("button", { name: /编辑资料/ });
    // 卡片起初就是为了让人知道去哪改资料；取消一次编辑后再催一遍属于打扰。
    expect(getProfileEditControl()).toBeNull();
  });

  it("关掉之后本次进入不再注册", async () => {
    renderProfilePage();
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
    const view = renderProfilePage();
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
      ...DEFAULT_PROFILE,
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
    renderProfilePage();
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
