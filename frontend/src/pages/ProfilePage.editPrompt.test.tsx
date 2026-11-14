// SPDX-License-Identifier: Apache-2.0
/**
 * 我的资料页的投投悬浮球「去改资料」提示卡：注册/注销时机，以及「点它等同于点页头编辑」。
 *
 * 从 `ProfilePage.test.tsx` 拆出（行数预算）：这里只放提示卡与页面桥的联动，其余页面
 * 行为（分页 / 未保存防护 / 折叠 / 输入性能）仍在主文件里。`vi.mock` 按测试文件装配，
 * 所以 mock 声明必须在本文件内逐字声明；夹具与 render 脚手架来自
 * `src/test/profilePageHarness.tsx`。
 */
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getProfileEditControl } from "../features/tou-tou/profileSaveBridge";
import {
  makeAllSections,
  makeEntry,
  makeField,
  makeWorkspace,
} from "../test/profileWorkspaceFixture";
import {
  cleanupProfilePage,
  findHeaderEditButton,
  renderProfilePage,
  resetProfileApiMocks,
} from "../test/profilePageHarness";
import { t } from "../i18n";

const apiMocks = vi.hoisted(() => ({
  getProfile: vi.fn(),
  saveProfile: vi.fn(),
  parseProfileText: vi.fn(),
  listResumes: vi.fn(),
  getWebFormExtraProfile: vi.fn(),
  updateWebFormExtraProfile: vi.fn(),
}));

// 「保存全部资料」的第一半走 saveProfile；不假它的话 submit 内部会静默失败——
// 本文件要靠保存链路成功来断言"编辑态注销"，所以一并 mock。
vi.mock("../api/profile", () => ({
  getProfile: apiMocks.getProfile,
  saveProfile: apiMocks.saveProfile,
  parseProfileText: apiMocks.parseProfileText,
}));

// F6 页面数据源已换成 workspace（features/profile/library + features/profile/groups），
// 旧 getProfile 只保留给识别/旧接口回退；这里把新数据源按最小 workspace 夹具假掉。
// F6 页面数据源：workspace（GET /api/profile/workspace）。按真实接口名造 mock 工厂；
// vi.mock 工厂只认具名导出，这里用表驱动一次性生成，避免 20+ 行手工重复。
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
vi.mock("../features/profile/library/api", () => ({ ...workspaceMocks }));
vi.mock("../features/profile/groups/api", () => ({ ...workspaceMocks }));
vi.mock("../api/photo", () => ({ ...workspaceMocks }));

// 「网申资料」走自己的接口（独立的表），这里一并假掉——不假的话这一页会去真发请求。
vi.mock("../api/webform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/webform")>()),
  getWebFormExtraProfile: apiMocks.getWebFormExtraProfile,
  updateWebFormExtraProfile: apiMocks.updateWebFormExtraProfile,
}));

/** F6 页面按服务端 namespace 渲染：测试用中文名，断言才与用户看到的一致。 */
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

/** workspace 夹具：给内置分区中文名 + 基本信息姓名（姓名是唯一必填项）。 */
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

describe("ProfilePage 悬浮球「去改资料」提示卡", () => {
  describe("ProfilePage 悬浮球「去改资料」提示卡", () => {
    it("挂载后注册编辑入口，点它等同于点页头的「编辑资料」", async () => {
      renderProfilePage();
      await waitFor(() => expect(getProfileEditControl()).not.toBeNull());

      act(() => getProfileEditControl()?.onEdit());

      // 进入编辑态：页头换成取消 / 保存全部资料。
      expect(await screen.findByRole("button", { name: /保存全部资料/ })).toBeInTheDocument();
    });

    it("资料还没加载完时不注册（那时点了也没反应）", async () => {
      workspaceMocks.getWorkspace.mockReturnValue(new Promise(() => {}));
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
      await findHeaderEditButton();
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
        expect(
          screen.getAllByText(t("profileLibrary.webform.sectionAlertTitle")).length,
        ).toBeGreaterThan(0),
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
});
