// SPDX-License-Identifier: Apache-2.0
/**
 * ProfilePage.groups（F6/A）：资料页按当前组参与清单渲染大字段（不是固定 7 个），
 * 标题区只有「当前组」下拉 + 管理组；编辑入口可进入保存态。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n";
import { setGroupMembers } from "../features/profile-groups/api";
import ProfilePage from "./ProfilePage";
import { makeAllSections, makeGroup, makeWorkspace } from "../test/profileWorkspaceFixture";

const apiMocks = vi.hoisted(() => ({
  getWorkspace: vi.fn(),
  saveEntries: vi.fn(),
  setSectionOrder: vi.fn(),
  patchFieldPreference: vi.fn(),
  deleteEntry: vi.fn(),
  reorderEntries: vi.fn(),
  createSection: vi.fn(),
  renameSection: vi.fn(),
  deleteSection: vi.fn(),
  getSectionDeletionImpact: vi.fn(),
  createField: vi.fn(),
  updateField: vi.fn(),
  deleteField: vi.fn(),
  getFieldDeletionImpact: vi.fn(),
  getCurrentProjection: vi.fn(),
  webformGet: vi.fn(),
  webformUpdate: vi.fn(),
  parseProfileText: vi.fn(),
  listPhotos: vi.fn(),
}));

vi.mock("../features/profile-library/api", () => ({
  getWorkspace: apiMocks.getWorkspace,
  saveEntries: apiMocks.saveEntries,
  setSectionOrder: apiMocks.setSectionOrder,
  patchFieldPreference: apiMocks.patchFieldPreference,
  deleteEntry: apiMocks.deleteEntry,
  reorderEntries: apiMocks.reorderEntries,
  createSection: apiMocks.createSection,
  renameSection: apiMocks.renameSection,
  deleteSection: apiMocks.deleteSection,
  getSectionDeletionImpact: apiMocks.getSectionDeletionImpact,
  createField: apiMocks.createField,
  updateField: apiMocks.updateField,
  deleteField: apiMocks.deleteField,
  getFieldDeletionImpact: apiMocks.getFieldDeletionImpact,
  getCurrentProjection: apiMocks.getCurrentProjection,
}));

vi.mock("../features/profile-groups/api", () => ({
  listGroups: vi.fn(),
  createGroup: vi.fn(),
  renameGroup: vi.fn(),
  deleteGroup: vi.fn(),
  setGroupMembers: vi.fn(),
  switchCurrentGroup: vi.fn(),
  acknowledgeNotice: vi.fn(),
}));

vi.mock("../api/webform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/webform")>()),
  getWebFormExtraProfile: apiMocks.webformGet,
  updateWebFormExtraProfile: apiMocks.webformUpdate,
}));

vi.mock("../api/profile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/profile")>()),
  parseProfileText: apiMocks.parseProfileText,
}));

vi.mock("../api/photo", () => ({
  listProfilePhotos: apiMocks.listPhotos,
  createProfilePhoto: vi.fn(),
  updateProfilePhoto: vi.fn(),
  deleteProfilePhoto: vi.fn(),
}));

function renderPage() {
  // useBlocker（离开守卫）要求 data router，这里用 createMemoryRouter；
  // 资料页本身是单路由，不涉及跳转断言。
  const router = createMemoryRouter([{ path: "/", element: <ProfilePage /> }]);
  render(
    <AntdApp>
      <RouterProvider router={router} />
    </AntdApp>,
  );
}

beforeEach(() => {
  apiMocks.listPhotos.mockReset().mockResolvedValue([]);
  apiMocks.webformGet.mockReset().mockResolvedValue({ fields: [], groups: [], values: {} });
  apiMocks.webformUpdate.mockReset().mockResolvedValue({ fields: [], groups: [], values: {} });
  vi.mocked(setGroupMembers)
    .mockReset()
    .mockResolvedValue(makeGroup("group-default", "Default", { is_default: true }));
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ProfilePage 当前组与分区渲染", () => {
  it("只渲染当前组参与的大字段（3 个），并保留标题区组控件", async () => {
    const sections = makeAllSections();
    const group = makeGroup("group-default", "Default", {
      is_default: true,
      participating_keys: ["basic_info", "educations", "skills"],
    });
    apiMocks.getWorkspace
      .mockReset()
      .mockResolvedValue(makeWorkspace({ sections, current_group: group, groups: [group] }));
    renderPage();

    await screen.findByText(t("profileGroups.control.label"));
    await waitFor(() => {
      expect(document.querySelectorAll("[data-profile-section-key]")).toHaveLength(3);
    });
    const rendered = Array.from(document.querySelectorAll("[data-profile-section-key]")).map(
      (node) => node.getAttribute("data-profile-section-key"),
    );
    expect(rendered).toEqual(["basic_info", "educations", "skills"]);
    expect(screen.queryByText("Projects")).not.toBeInTheDocument();
    // antd 图标参与可访问名，按文本正则匹配避免把图标 aria-label 也算进去。
    expect(
      screen.getByRole("button", { name: new RegExp(t("profileGroups.control.manage")) }),
    ).toBeInTheDocument();
  });

  it("参与清单为 13 项时渲染 13 个分区，且没有第 14 个", async () => {
    const workspace = makeWorkspace();
    apiMocks.getWorkspace.mockReset().mockResolvedValue(workspace);
    renderPage();
    await screen.findByText(t("profileGroups.control.label"));
    await waitFor(() => {
      expect(document.querySelectorAll("[data-profile-section-key]")).toHaveLength(13);
    });
    // 已退役的补充事实不再是页内分区。
    expect(document.querySelector("[data-profile-section-key='profile_facts']")).toBeNull();
  });

  it("查看态可从「已隐藏的大字段」逐项恢复（写当前组参与清单，不进编辑态）", async () => {
    const sections = makeAllSections();
    const group = makeGroup("group-default", "Default", {
      is_default: true,
      participating_keys: ["basic_info"],
    });
    apiMocks.getWorkspace
      .mockReset()
      .mockResolvedValue(makeWorkspace({ sections, current_group: group, groups: [group] }));
    renderPage();

    // 当前组只剩基本信息：空态说明 + 「已隐藏的大字段 (12)」入口都要在查看态可见。
    await screen.findByText(t("profileLibrary.empty.groupTitle"));
    expect(
      screen.getByRole("button", {
        name: t("profileLibrary.hiddenSections.button", { count: 12 }),
      }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: t("profileLibrary.empty.showHidden") }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: t("profileLibrary.hiddenSections.showAria", { name: "Education" }),
      }),
    );
    await waitFor(() =>
      expect(setGroupMembers).toHaveBeenCalledWith(
        "group-default",
        ["basic_info", "educations"],
        1,
      ),
    );
    // 恢复显示只是写参与清单，不把页面切进编辑态。
    expect(
      screen.queryByRole("button", { name: new RegExp(t("profileLibrary.action.save")) }),
    ).not.toBeInTheDocument();
  });

  it("编辑资料进入保存态（保存全部资料入口出现）", async () => {
    apiMocks.getWorkspace.mockReset().mockResolvedValue(makeWorkspace());
    renderPage();
    const editButton = await screen.findByRole("button", {
      name: new RegExp(t("profileLibrary.action.edit")),
    });
    editButton.click();
    expect(
      await screen.findByRole("button", { name: new RegExp(t("profileLibrary.action.save")) }),
    ).toBeInTheDocument();
  });

  it("点分区标题栏的齿轮，弹层直接落到该大字段的字段设置", async () => {
    const sections = makeAllSections();
    const group = makeGroup("group-default", "Default", {
      is_default: true,
      participating_keys: ["basic_info", "educations"],
    });
    apiMocks.getWorkspace
      .mockReset()
      .mockResolvedValue(makeWorkspace({ sections, current_group: group, groups: [group] }));
    renderPage();

    const gear = await screen.findByRole("button", {
      name: t("profileLibrary.section.fieldSettingsAria", { name: "Education" }),
    });
    // 查看态整页在 <Form disabled> 里，齿轮靠就地覆盖 DisabledContext 保持可点。
    expect(gear).toBeEnabled();
    fireEvent.click(gear);

    // 「字段设置」视图独有的两处内容：默认字段说明 + 该分区内置字段（educations 只有 Title）。
    // 改前页面丢掉了 sectionKey，弹层只能停在组列表，这两条都拿不到。
    expect(
      await screen.findByText(t("profileLibrary.fieldSettings.defaultHint")),
    ).toBeInTheDocument();
    expect(screen.getByText("Title")).toBeInTheDocument();
    // 不是「管理组」视图：新建组的说明文案不出现。
    expect(screen.queryByText(t("profileGroups.manager.createHint"))).not.toBeInTheDocument();
  });
});
