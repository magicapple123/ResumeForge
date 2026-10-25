// SPDX-License-Identifier: Apache-2.0
/** ProfilePage.upgrade（F6/F）：旧资料待重填告知只在"旧有新空"时出现，并给两条出路。 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n";
import ProfilePage from "./ProfilePage";
import { makeWorkspace } from "../test/profileWorkspaceFixture";

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
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ProfilePage 升级告知", () => {
  it("旧资料存在且新模型为空时显示告知与备份/开始填写两条出路", async () => {
    apiMocks.getWorkspace
      .mockReset()
      .mockResolvedValue(
        makeWorkspace({ upgrade: { has_legacy_data: true, new_profile_has_entries: false } }),
      );
    renderPage();
    const notice = (await screen.findByText(t("profileLibrary.upgrade.title"))).closest(
      ".ant-alert",
    );
    if (!notice) throw new Error("upgrade alert not found");
    expect(
      within(notice as HTMLElement).getByRole("button", {
        name: new RegExp(t("profileLibrary.upgrade.backup")),
      }),
    ).toBeInTheDocument();
    fireEvent.click(
      within(notice as HTMLElement).getByRole("button", {
        name: new RegExp(t("profileLibrary.upgrade.start")),
      }),
    );
    expect(
      await screen.findByRole("button", { name: new RegExp(t("profileLibrary.action.save")) }),
    ).toBeInTheDocument();
  });

  it("新模型已有内容时不显示告知", async () => {
    apiMocks.getWorkspace
      .mockReset()
      .mockResolvedValue(
        makeWorkspace({ upgrade: { has_legacy_data: true, new_profile_has_entries: true } }),
      );
    renderPage();
    await screen.findByText(t("profileGroups.control.label"));
    expect(screen.queryByText(t("profileLibrary.upgrade.title"))).not.toBeInTheDocument();
  });

  it("读取失败走 ErrorState，重试后恢复", async () => {
    apiMocks.getWorkspace
      .mockReset()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue(makeWorkspace());
    renderPage();
    // 默认重试按钮文案来自 ErrorState（"重试"，antd 对两个汉字自动插空格）。
    const retry = await screen.findByRole("button", { name: /重\s*试/ });
    fireEvent.click(retry);
    await waitFor(() => expect(apiMocks.getWorkspace).toHaveBeenCalledTimes(2));
    await screen.findByText(t("profileGroups.control.label"));
  });
});
