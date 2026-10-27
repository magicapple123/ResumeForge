// SPDX-License-Identifier: Apache-2.0
/**
 * 「我的资料」页的快捷键落点（R5，F7 迁移版）：撤回/恢复作用于整页表单（跨字段），
 * 保存走页面既有的「保存全部资料」入口；输入框里的 Ctrl+Z 仍交给浏览器原生撤销。
 *
 * 与旧版的差异：页面数据源是 GET /workspace，保存走 PATCH /workspace/entries
 * （条目级变更集），因此断言的是 saveEntries 的字段值而不是旧 PUT 的整体资料。
 */
import { App as AntdApp } from "antd";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ShortcutProvider from "../features/shortcuts/ShortcutProvider";
import ProfilePage from "./ProfilePage";
import { cleanupProfilePage, findHeaderEditButton } from "../test/profilePageHarness";
import { makeEntry, makeSection, makeWorkspace, makeField } from "../test/profileWorkspaceFixture";

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
  parseWebForm: vi.fn(),
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
  parseWebFormExtraProfileText: apiMocks.parseWebForm,
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

function makeShortcutWorkspace() {
  return makeWorkspace({
    sections: [
      makeSection("basic_info", "Basic Info", "singleton", [
        makeField("basic_info", "name", "Name"),
        makeField("basic_info", "job_intention", "Job"),
      ]),
    ],
    section_order: ["basic_info"],
  });
}

function renderWithShortcuts() {
  const router = createMemoryRouter([
    {
      path: "/",
      element: (
        <AntdApp>
          <ShortcutProvider>
            <ProfilePage />
          </ShortcutProvider>
        </AntdApp>
      ),
    },
  ]);
  return render(<RouterProvider router={router} />);
}

beforeEach(() => {
  const workspace = makeShortcutWorkspace();
  apiMocks.getWorkspace.mockReset().mockResolvedValue({
    ...workspace,
    current_group: {
      group_id: "group-default",
      name: "Default",
      is_default: true,
      revision: 1,
      participating_keys: ["basic_info"],
      member_count: 1,
    },
    groups: [
      {
        group_id: "group-default",
        name: "Default",
        is_default: true,
        revision: 1,
        participating_keys: ["basic_info"],
        member_count: 1,
      },
    ],
    entries: [
      makeEntry("basic_info", "entry-basic", {
        "basic_info.name": "Zhang",
        "basic_info.job_intention": "Backend",
      }),
    ],
  });
  apiMocks.saveEntries.mockReset().mockResolvedValue({
    entries: [],
    workspace_revision: 4,
  });
  apiMocks.listPhotos.mockReset().mockResolvedValue([]);
  apiMocks.webformGet.mockReset().mockResolvedValue({ fields: [], groups: [], values: {} });
});

afterEach(() => {
  cleanupProfilePage();
});

describe("ProfilePage 快捷键", () => {
  it("输入框外的 Ctrl+Z 撤回整页表单的改动，输入框内不劫持", async () => {
    renderWithShortcuts();
    fireEvent.click(await findHeaderEditButton());

    const nameInput = await screen.findByDisplayValue("Zhang");
    await waitFor(() => expect(nameInput).toBeEnabled());
    fireEvent.change(nameInput, { target: { value: "Li" } });
    expect(nameInput).toHaveValue("Li");

    // 输入框里：交给原生撤销，页面级历史不动。
    fireEvent.keyDown(nameInput, { key: "z", ctrlKey: true });
    expect(nameInput).toHaveValue("Li");

    // 输入框外：表单级撤回，回到改动前的值。
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    await waitFor(() => expect(screen.getByDisplayValue("Zhang")).toBeInTheDocument());

    // 恢复（redo）把改动拿回来。
    fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(screen.getByDisplayValue("Li")).toBeInTheDocument());
  });

  it("Ctrl+S 触发页面既有的保存入口（条目级变更集）", async () => {
    renderWithShortcuts();
    fireEvent.click(await findHeaderEditButton());

    const nameInput = await screen.findByDisplayValue("Zhang");
    await waitFor(() => expect(nameInput).toBeEnabled());
    fireEvent.change(nameInput, { target: { value: "Wang" } });

    fireEvent.keyDown(window, { key: "s", ctrlKey: true });

    await waitFor(() => expect(apiMocks.saveEntries).toHaveBeenCalledTimes(1));
    const [items] = apiMocks.saveEntries.mock.calls[0];
    expect(items).toEqual([
      expect.objectContaining({
        section_key: "basic_info",
        values: { "basic_info.name": "Wang" },
      }),
    ]);
  });
});
