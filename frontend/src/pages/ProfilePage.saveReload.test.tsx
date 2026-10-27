// SPDX-License-Identifier: Apache-2.0
/**
 * 保存后重载必须与服务器真值一致（用户实测：教育经历加一段→保存→变成两段相同，再保存再多一段）。
 *
 * 根因回归：保存成功后 reloadWorkspace 以「编辑中刷新」口径合并表单，把刚刚已经提交成功的
 * new: 临时草稿又保留了回来（服务端新条目 + 残留草稿同时存在）；下一次保存时
 * collectEntryChanges 把残留草稿当新条目再提交一次 => 每保存一次多一条。
 *
 * 这里用页面级用例端到端钉住：添加一条 -> 保存 -> 只剩一条且无残留草稿 -> 再保存不新增。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n";
import { findHeaderEditButton, headerEditButton } from "../test/profilePageHarness";
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

/** 服务端状态替身：saveEntries / deleteEntry 真的落库，getWorkspace 之后返回它。 */
function createServer(
  initialEntries: EntryOut[] = [makeEntry("basic_info", "basic-1", { "basic_info.name": "Zhang" })],
) {
  const sections = makeAllSections().map((section) =>
    section.key === "educations"
      ? { ...section, fields: [makeField("educations", "school", "School")] }
      : section,
  );
  let entries: EntryOut[] = initialEntries;
  let revision = 3;
  const savedCalls: BulkEntryItem[][] = [];
  const saveEntries = async (items: BulkEntryItem[]): Promise<BulkEntriesResult> => {
    savedCalls.push(items);
    revision += 1;
    let sortOrder = entries.length;
    items.forEach((item) => {
      if (item.entry_id) {
        entries = entries.map((entry) =>
          entry.entry_id === item.entry_id
            ? {
                ...entry,
                values: { ...entry.values, ...item.values },
                revision: entry.revision + 1,
              }
            : entry,
        );
        return;
      }
      sortOrder += 1;
      entries = [
        ...entries,
        makeEntry(item.section_key, "edu-" + sortOrder, item.values, sortOrder),
      ];
    });
    return { entries: [], workspace_revision: revision };
  };
  const deleteEntry = async (_sectionKey: string, entryId: string): Promise<void> => {
    revision += 1;
    entries = entries.filter((entry) => entry.entry_id !== entryId);
  };
  return {
    savedCalls,
    saveEntries,
    deleteEntry,
    workspace: (): WorkspaceOut =>
      makeWorkspace({ sections, entries, workspace_revision: revision }),
  };
}

function sectionNode(sectionKey: string): HTMLElement {
  const node = document.querySelector<HTMLElement>(`[data-profile-section-key="${sectionKey}"]`);
  if (!node) throw new Error(`profile section not found: ${sectionKey}`);
  return node;
}

function educationSection(): HTMLElement {
  return sectionNode("educations");
}

async function waitForProfileReady() {
  await screen.findByRole("tab", { name: t("profileLibrary.tab.resume") });
  await findHeaderEditButton();
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

describe("ProfilePage 保存后的重载", () => {
  it("丢弃已提交的新条目草稿：保存后条目只剩一条，再保存不新增", async () => {
    const server = createServer();
    apiMocks.getWorkspace.mockImplementation(async () => server.workspace());
    apiMocks.saveEntries.mockImplementation(server.saveEntries);

    renderPage();
    await waitForProfileReady();
    fireEvent.click(headerEditButton());

    // 教育经历初始为空：编辑态点「添加一条」，填写学校。
    fireEvent.click(
      within(educationSection()).getByRole("button", {
        name: t("profileLibrary.section.addEntry"),
      }),
    );
    const schoolInputs = within(educationSection()).getAllByLabelText("School");
    expect(schoolInputs).toHaveLength(1);
    fireEvent.change(schoolInputs[0], { target: { value: "Example University" } });

    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(t("profileLibrary.action.save")) }),
    );
    await findHeaderEditButton();

    // 第一轮只提交了一条新条目。
    expect(server.savedCalls).toHaveLength(1);
    expect(server.savedCalls[0]).toHaveLength(1);
    expect(server.savedCalls[0][0].entry_id).toBeUndefined();
    expect(server.savedCalls[0][0].values).toEqual({ "educations.school": "Example University" });

    // 回归失败点：重载保留了残留的 new: 草稿 => 表单里出现两条（服务端那条 + 草稿）。
    await waitFor(() =>
      expect(within(educationSection()).getAllByLabelText("School")).toHaveLength(1),
    );

    // 再保存一次：残留草稿若还在，会被当成新条目再提交一条。
    fireEvent.click(headerEditButton());
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(t("profileLibrary.action.save")) }),
    );
    await findHeaderEditButton();

    expect(server.savedCalls).toHaveLength(1);
    expect(within(educationSection()).getAllByLabelText("School")).toHaveLength(1);
  });

  it("删除条目后的重载仍保留编辑中未保存的新条目", async () => {
    // 与保存后的重载相反：删除一条已存条目会立刻重取 workspace，此时用户正在填的
    // 新草稿必须留着（否则"删一条记录"会把另一段刚打的字一起冲掉）。
    const server = createServer([
      makeEntry("basic_info", "basic-1", { "basic_info.name": "Zhang" }),
      makeEntry("projects", "proj-1", { "projects.title": "Old Project" }, 1),
    ]);
    apiMocks.getWorkspace.mockImplementation(async () => server.workspace());
    apiMocks.deleteEntry.mockImplementation(server.deleteEntry);

    renderPage();
    await waitForProfileReady();
    fireEvent.click(headerEditButton());

    // 先在教育经历里加一条不保存的新草稿。
    fireEvent.click(
      within(educationSection()).getByRole("button", {
        name: t("profileLibrary.section.addEntry"),
      }),
    );
    fireEvent.change(within(educationSection()).getByLabelText("School"), {
      target: { value: "Unsaved Draft" },
    });

    // 再删除项目经历里的一条已存条目：触发 deleteEntry -> reloadWorkspace。
    const projectSection = sectionNode("projects");
    expect(within(projectSection).getByLabelText("Title")).toHaveValue("Old Project");
    fireEvent.click(
      within(projectSection).getByRole("button", { name: t("profileLibrary.entry.remove") }),
    );

    await waitFor(() => expect(apiMocks.getWorkspace).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(within(sectionNode("projects")).queryByLabelText("Title")).not.toBeInTheDocument(),
    );
    // 删除触发的重载走"保留草稿"口径：新条目与刚输入的值都还在。
    expect(within(educationSection()).getAllByLabelText("School")).toHaveLength(1);
    expect(within(educationSection()).getByLabelText("School")).toHaveValue("Unsaved Draft");
  });
});
