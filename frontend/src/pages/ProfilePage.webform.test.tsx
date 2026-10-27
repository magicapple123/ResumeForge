// SPDX-License-Identifier: Apache-2.0
/**
 * 「网申资料」域（基础语义）：给网申填表用的补充资料，与简历资料分开存。
 *
 * 2026-10-26：按 500 行测试预算从原文件拆出——本文件守「渲染/查看态/敏感项/编辑态/
 * 校验失败/保存成功/保存载荷」这些基础语义；自定义字段增删改、多条补充记录、懒加载
 * 时序与悬浮球保存桥在 ProfilePage.webform.customFields.test.tsx。
 *
 * 这里守两件事：它能在这儿编辑保存；以及它**不进**可拖拽排序的分区栈——后端按
 * PROFILE_SECTION_KEYS 归一化 section_order，不认识的键会被**静默丢弃**。
 */
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  makeAllSections,
  makeEntry,
  makeField,
  makeWorkspace,
} from "../test/profileWorkspaceFixture";
import {
  cleanupProfilePage,
  openWebFormTab,
  renderProfilePage,
  resetProfileApiMocks,
} from "../test/profilePageHarness";
import { t } from "../i18n";

const apiMocks = vi.hoisted(() => ({
  getProfile: vi.fn(),
  saveProfile: vi.fn(),
  listResumes: vi.fn(),
  getWebFormExtraProfile: vi.fn(),
  updateWebFormExtraProfile: vi.fn(),
}));

vi.mock("../api/profile", () => ({
  getProfile: apiMocks.getProfile,
  saveProfile: apiMocks.saveProfile,
}));

// F6 页面数据源是 workspace（GET /api/profile/workspace）；按真实接口名造 mock 工厂，
// vi.mock 工厂只认具名导出，用表驱动一次性生成，避免 20+ 行手工重复。
const workspaceMocks = vi.hoisted(() => {
  const names = [
    "getWorkspace",
    "saveEntries",
    "setSectionOrder",
    "patchFieldPreference",
    "deleteEntry",
    "reorderEntries",
    "createSection",
    "renameSection",
    "deleteSection",
    "getSectionDeletionImpact",
    "createField",
    "updateField",
    "deleteField",
    "getFieldDeletionImpact",
    "getCurrentProjection",
    "listGroups",
    "createGroup",
    "renameGroup",
    "deleteGroup",
    "setGroupMembers",
    "switchCurrentGroup",
    "acknowledgeNotice",
    "listProfilePhotos",
  ] as const;
  return Object.fromEntries(names.map((name) => [name, vi.fn()])) as Record<
    (typeof names)[number],
    ReturnType<typeof vi.fn>
  >;
});
vi.mock("../features/profile-library/api", () => ({ ...workspaceMocks }));
vi.mock("../features/profile-groups/api", () => ({ ...workspaceMocks }));
vi.mock("../api/photo", () => ({ ...workspaceMocks }));

vi.mock("../api/webform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/webform")>()),
  getWebFormExtraProfile: apiMocks.getWebFormExtraProfile,
  updateWebFormExtraProfile: apiMocks.updateWebFormExtraProfile,
}));

/** F6 页面按服务端 namespace 渲染：测试用中文名；姓名是唯一必填项。 */
const SECTION_NAMES: Record<string, string> = {
  basic_info: "基本信息",
  educations: "教育经历",
  experiences: "实习/工作经历",
  projects: "项目经历",
  skills: "专业技能",
  campus_experiences: "校园经历",
  awards: "荣誉奖项",
  summary: "个人总结",
  publications: "学术成果",
  research_projects: "科研项目",
  patents: "知识产权",
  credentials: "证书资质",
  languages: "语言能力",
};

function pageSections() {
  return makeAllSections().map((section) => {
    if (section.key === "basic_info") {
      return {
        ...section,
        name: "基本信息",
        fields: [
          makeField("basic_info", "name", "姓名"),
          makeField("basic_info", "gender", "性别"),
        ],
      };
    }
    return { ...section, name: SECTION_NAMES[section.key] ?? section.name };
  });
}

function pageWorkspace(overrides: Record<string, unknown> = {}) {
  return makeWorkspace({
    sections: pageSections(),
    entries: [makeEntry("basic_info", "basic-1", { "basic_info.name": "张三" })],
    ...overrides,
  });
}

beforeEach(() => {
  resetProfileApiMocks(apiMocks);
  workspaceMocks.getWorkspace.mockReset().mockResolvedValue(pageWorkspace());
  workspaceMocks.saveEntries.mockReset().mockResolvedValue(pageWorkspace());
  workspaceMocks.getCurrentProjection.mockReset().mockResolvedValue(null);
  workspaceMocks.listGroups.mockReset().mockResolvedValue([]);
  workspaceMocks.listProfilePhotos.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  cleanupProfilePage();
});

describe("ProfilePage 「网申资料」", () => {
  it("渲染出「网申资料」区块，并说明它不进简历", async () => {
    renderProfilePage();

    await openWebFormTab();
    expect(
      screen.getAllByText(t("profileLibrary.webform.sectionAlertTitle")).length,
    ).toBeGreaterThan(0);
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
    renderProfilePage();
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
    renderProfilePage();
    await openWebFormTab();

    expect(await screen.findByText("身高(cm)")).toBeInTheDocument();
    expect(screen.queryByText("只存本机", { exact: true })).not.toBeInTheDocument();
  });
  it("编辑态所有字段都可输入（含空的那些）", async () => {
    renderProfilePage();
    await openWebFormTab();

    fireEvent.click(screen.getByRole("button", { name: /编辑资料/ }));

    // 编辑态才铺出全部输入框——查看态看不到空字段。
    expect(await screen.findByLabelText("英语六级分数")).toBeInTheDocument();
    expect(screen.getByLabelText("身高(cm)")).toBeInTheDocument();
  });
  it("简历资料校验失败时不提交网申资料，页面停在编辑态并给出提示", async () => {
    // 回归（用户实测）：简历资料必填项为空（校验不过）时，旧实现仍继续提交网申
    // 资料——用户看到"保存成功"、页面却停在编辑态，而简历资料的改动其实没存上。
    // 现在的语义：两次都成功才算保存；简历资料 invalid 时网申资料不提交。
    renderProfilePage();
    await openWebFormTab();
    fireEvent.click(screen.getByRole("button", { name: /编辑资料/ }));
    fireEvent.change(await screen.findByLabelText("英语六级分数"), { target: { value: "512" } });

    // 清空必填的「姓名」制造校验失败（antd 会把错误标在字段上）。
    fireEvent.click(screen.getByRole("tab", { name: "简历资料" }));
    fireEvent.change(screen.getByLabelText("姓名"), { target: { value: "" } });

    fireEvent.click(screen.getByRole("button", { name: /保存全部资料/ }));

    await waitFor(() => expect(workspaceMocks.saveEntries).not.toHaveBeenCalled());
    expect(apiMocks.updateWebFormExtraProfile).not.toHaveBeenCalled();
    // 页面仍在编辑态（未退出编辑），并给出"先补全必填项"的提示。
    expect(screen.getByRole("button", { name: /保存全部资料/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /取消/ })).toBeInTheDocument();
    expect(await screen.findByText(/请先补全简历资料里的必填项/)).toBeInTheDocument();
  });
  it("全部合法时保存成功并退出编辑态", async () => {
    renderProfilePage();
    await openWebFormTab();
    fireEvent.click(screen.getByRole("button", { name: /编辑资料/ }));

    fireEvent.change(await screen.findByLabelText("英语六级分数"), { target: { value: "512" } });
    fireEvent.click(screen.getByRole("button", { name: /保存全部资料/ }));

    await waitFor(() => expect(apiMocks.updateWebFormExtraProfile).toHaveBeenCalled());
    // 已退出编辑态：页头回到「编辑资料」。
    expect(await screen.findByRole("button", { name: /编辑资料/ })).toBeInTheDocument();
  });
  it("保存全部资料时，网申资料也跟着存一次", async () => {
    renderProfilePage();
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
});
