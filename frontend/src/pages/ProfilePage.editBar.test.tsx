// SPDX-License-Identifier: Apache-2.0
/**
 * 编辑操作条（需求 6）的页面级契约：出现时机、以及两颗按钮**真的**接到页面既有动作。
 *
 * 为什么要在页面级再钉一遍：单元用例只能证明组件把 `onSave` 转出去了，而这次需求最容易
 * 出错的地方正是"新加的那组按钮有没有另写一套保存逻辑"。这里用真实页面 + 会落库的假服务端
 * 验证：点浮条的「保存修改」→ 走的是页头同一套 submitAll → saveEntries 被调用。
 *
 * 取消同理：浮条的「取消编辑」必须走 handleCancelEditing（dirty 时先出未保存确认卡片），
 * 而不是自己把表单清了。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n";
import { findHeaderEditButton, looseButtonName } from "../test/profilePageHarness";
import {
  makeAllSections,
  makeEntry,
  makeField,
  makeWorkspace,
} from "../test/profileWorkspaceFixture";
import type {
  BulkEntryItem,
  BulkEntriesResult,
  EntryOut,
  WorkspaceOut,
} from "../features/profile-library/types";
import ProfilePage from "./ProfilePage";

const apiMocks = vi.hoisted(() => {
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
    "getProfile",
    "saveProfile",
    "parseProfileText",
    "getWebFormExtraProfile",
    "updateWebFormExtraProfile",
  ] as const;
  return Object.fromEntries(names.map((name) => [name, vi.fn()])) as Record<
    (typeof names)[number],
    ReturnType<typeof vi.fn>
  >;
});

vi.mock("../features/profile-library/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/profile-library/api")>()),
  ...apiMocks,
}));
vi.mock("../features/profile-groups/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/profile-groups/api")>()),
  ...apiMocks,
}));
vi.mock("../api/photo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/photo")>()),
  ...apiMocks,
}));
vi.mock("../api/profile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/profile")>()),
  ...apiMocks,
}));
vi.mock("../api/webform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/webform")>()),
  ...apiMocks,
}));

function renderPage() {
  // 离开守卫用 useBlocker：必须是 data router。
  const router = createMemoryRouter([{ path: "/", element: <ProfilePage /> }]);
  render(
    <AntdApp>
      <RouterProvider router={router} />
    </AntdApp>,
  );
}

/** 服务端状态替身：saveEntries 真的落库，getWorkspace 之后返回它。 */
function createServer() {
  const sections = makeAllSections().map((section) =>
    section.key === "educations"
      ? { ...section, fields: [makeField("educations", "school", "School")] }
      : section,
  );
  const entries: EntryOut[] = [makeEntry("basic_info", "basic-1", { "basic_info.name": "Zhang" })];
  let revision = 3;
  const savedCalls: BulkEntryItem[][] = [];
  const saveEntries = async (items: BulkEntryItem[]): Promise<BulkEntriesResult> => {
    savedCalls.push(items);
    revision += 1;
    return { entries: [], workspace_revision: revision };
  };
  return {
    savedCalls,
    saveEntries,
    workspace: (): WorkspaceOut =>
      makeWorkspace({ sections, entries, workspace_revision: revision }),
  };
}

function educationSection(): HTMLElement {
  const node = document.querySelector<HTMLElement>('[data-profile-section-key="educations"]');
  if (!node) throw new Error("profile section not found: educations");
  return node;
}

function bar(): HTMLElement | null {
  return screen.queryByTestId("profile-edit-bar");
}

function barButton(action: "save" | "cancel"): HTMLElement {
  const region = bar();
  if (!region) throw new Error("编辑操作条未出现");
  const key = action === "save" ? "profileLibrary.editBar.save" : "profileLibrary.editBar.cancel";
  return within(region).getByRole("button", { name: looseButtonName(t(key)) });
}

/** 进编辑态 → 在教育经历里加一条并填学校：这一步之后页面就是 dirty。 */
async function addEducationEntry(): Promise<void> {
  await screen.findByRole("tab", { name: t("profileLibrary.tab.resume") });
  fireEvent.click(await findHeaderEditButton());
  fireEvent.click(
    within(educationSection()).getByRole("button", { name: t("profileLibrary.section.addEntry") }),
  );
  fireEvent.change(within(educationSection()).getByLabelText("School"), {
    target: { value: "Example University" },
  });
}

beforeEach(() => {
  Object.values(apiMocks).forEach((mock) => mock.mockReset());
  apiMocks.listProfilePhotos.mockResolvedValue([]);
  apiMocks.getCurrentProjection.mockResolvedValue(null);
  apiMocks.getWebFormExtraProfile.mockResolvedValue({ fields: [], groups: [], values: {} });
  apiMocks.updateWebFormExtraProfile.mockResolvedValue({ fields: [], groups: [], values: {} });
  apiMocks.listGroups.mockResolvedValue([]);
  apiMocks.getProfile.mockResolvedValue({});
  apiMocks.saveProfile.mockResolvedValue({});
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ProfilePage 编辑操作条（需求 6）", () => {
  it("有未保存改动才出现；点它上面的「保存修改」走的是页面同一套保存", async () => {
    const server = createServer();
    apiMocks.getWorkspace.mockImplementation(async () => server.workspace());
    apiMocks.saveEntries.mockImplementation(server.saveEntries);

    renderPage();
    await screen.findByRole("tab", { name: t("profileLibrary.tab.resume") });
    fireEvent.click(await findHeaderEditButton());

    // 刚进编辑态但什么都没改：不该冒出一条要用户做决定的横条。
    expect(bar()).toBeNull();

    fireEvent.click(
      within(educationSection()).getByRole("button", {
        name: t("profileLibrary.section.addEntry"),
      }),
    );
    fireEvent.change(within(educationSection()).getByLabelText("School"), {
      target: { value: "Example University" },
    });

    await waitFor(() => expect(bar()).not.toBeNull());

    fireEvent.click(barButton("save"));

    // 落库：与点页头「保存全部资料」是同一条路径（submitAll → saveEntries）。
    await waitFor(() => expect(server.savedCalls).toHaveLength(1));
    expect(server.savedCalls[0][0].values).toEqual({ "educations.school": "Example University" });
    // 保存成功后回到"没有未保存改动"：横条自己收起来，不需要调用方再管。
    await waitFor(() => expect(bar()).toBeNull());
  });

  it("点「取消编辑」走既有的未保存确认卡片，卡片弹出时横条让位", async () => {
    const server = createServer();
    apiMocks.getWorkspace.mockImplementation(async () => server.workspace());
    apiMocks.saveEntries.mockImplementation(server.saveEntries);

    renderPage();
    await addEducationEntry();
    await waitFor(() => expect(bar()).not.toBeNull());

    fireEvent.click(barButton("cancel"));

    // 不是"直接清空表单"：先出居中确认卡片（handleCancelEditing → 离开守卫）。
    expect(await screen.findByText(t("profileGroups.leave.title"))).toBeInTheDocument();
    // 同一屏不给第二组"保存/取消"：卡片一开，横条收起（与悬浮球浮卡让位同一条理由）。
    expect(bar()).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: looseButtonName(t("profileGroups.leave.discard")) }),
    );

    // 真正回到查看态，且整个过程没有发出保存请求。
    await findHeaderEditButton();
    expect(bar()).toBeNull();
    expect(server.savedCalls).toHaveLength(0);
  });
});
