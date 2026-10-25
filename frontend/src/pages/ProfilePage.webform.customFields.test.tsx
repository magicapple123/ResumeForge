// SPDX-License-Identifier: Apache-2.0
/**
 * 「网申资料」域（自定义字段与多条记录）：原文件超 500 行测试预算后拆出。
 *
 * 基础语义（渲染/查看态/敏感项/编辑态/校验失败/保存成功）在
 * ProfilePage.webform.test.tsx；本文件守：自定义字段新增/改名/删除、多条教育补充记录、
 * 目录懒加载的取消-再提交路径、以及悬浮球保存桥的挂/摘。
 */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SECTION_ORDER } from "../components/profile/ProfileSectionConfig";
import {
  makeAllSections,
  makeEntry,
  makeField,
  makeWorkspace,
} from "../test/profileWorkspaceFixture";
import { getProfileSaveControl } from "../features/tou-tou/profileSaveBridge";
import {
  cleanupProfilePage,
  openWebFormTab,
  renderProfilePage,
  resetProfileApiMocks,
} from "../test/profilePageHarness";

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

describe("ProfilePage 「网申资料」（自定义字段与多条记录）", () => {
  it("编辑态可以新增自定义网申字段并随资料一起保存", async () => {
    renderProfilePage();
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
    renderProfilePage();
    await openWebFormTab();
    // i18n-ok: 查找的是自定义字段值（数据夹具），不是界面文案
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
    renderProfilePage();
    await openWebFormTab();
    // i18n-ok: 查找的是自定义字段值（数据夹具），不是界面文案
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
    renderProfilePage();
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
    renderProfilePage();
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
    renderProfilePage();
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
    renderProfilePage();
    await openWebFormTab();
    fireEvent.click(screen.getByRole("button", { name: /编辑资料/ }));
    fireEvent.change(await screen.findByLabelText("英语六级分数"), { target: { value: "512" } });

    await waitFor(() => expect(getProfileSaveControl()).not.toBeNull());

    fireEvent.click(screen.getByRole("button", { name: /保存全部资料/ }));
    await waitFor(() => expect(getProfileSaveControl()).toBeNull());
    expect(apiMocks.updateWebFormExtraProfile).toHaveBeenCalled();
  });
});
