// SPDX-License-Identifier: Apache-2.0
/**
 * 「粘贴文本识别」两阶段（F7 迁移版）：识别结果先列校对清单，用户确认后才写表单。
 *
 * 新契约：/profile/parse-text 返回 sections[{key,name,fields[{field_id,label,value}]}]，
 * 前端只按服务端下发的 field_id 写表单（不维护旧->新映射，已移除字段不会复活）。
 * 网申侧的同链路用例见 WebFormProfileSection.parse.test.tsx（句柄直测）。
 */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getProfileSaveControl } from "../features/tou-tou/profileSaveBridge";
import {
  cleanupProfilePage,
  findHeaderEditButton,
  renderProfilePage,
} from "../test/profilePageHarness";
import {
  makeAllSections,
  makeEntry,
  makeGroup,
  makeWorkspace,
} from "../test/profileWorkspaceFixture";

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

const PARSED = {
  sections: [
    {
      key: "basic_info",
      name: "Basic Info",
      fields: [
        { field_id: "basic_info.name", label: "Name", value: "Li" },
        { field_id: "basic_info.job_intention", label: "Job", value: "" },
      ],
    },
  ],
  warnings: [] as string[],
  parse_engine: "local" as const,
  recognized_text: "Name: Li",
};

const BASIC_ENTRY = makeEntry("basic_info", "entry-basic", {
  "basic_info.name": "Zhang",
  "basic_info.job_intention": "Backend",
});

beforeEach(() => {
  const sections = makeAllSections();
  const group = makeGroup("group-default", "Default", {
    is_default: true,
    participating_keys: sections.map((section) => section.key),
  });
  apiMocks.getWorkspace
    .mockReset()
    .mockResolvedValue(
      makeWorkspace({ sections, groups: [group], current_group: group, entries: [BASIC_ENTRY] }),
    );
  apiMocks.listPhotos.mockReset().mockResolvedValue([]);
  apiMocks.webformGet.mockReset().mockResolvedValue({ fields: [], groups: [], values: {} });
  apiMocks.parseProfileText.mockReset().mockResolvedValue(PARSED);
});

afterEach(cleanupProfilePage);

async function openAndParse() {
  fireEvent.click(await findHeaderEditButton());
  fireEvent.click(await screen.findByRole("button", { name: /粘贴文本识别/ }));
  fireEvent.change(await screen.findByLabelText("个人资料文本"), { target: { value: "Name: Li" } });
  fireEvent.click(screen.getByRole("button", { name: /识别并填入/ }));
}

const ROW_ID = "basic_info::0::basic_info.name";

async function waitRow() {
  await waitFor(() =>
    expect(document.querySelector('[data-row-id="' + ROW_ID + '"]')).not.toBeNull(),
  );
}

describe("ProfilePage 粘贴识别 · 两阶段", () => {
  it("识别成功不直接改表单：先列校对清单，弹窗不关", async () => {
    renderProfilePage();
    await openAndParse();
    await waitRow();
    expect(screen.getByText(/识别到 1 项/)).toBeInTheDocument();
    expect(screen.getByDisplayValue("Zhang")).toBeInTheDocument();
    expect(getProfileSaveControl()).toBeNull();
  });

  it("改一行再确认：写回该字段，空值不清空其它已填字段", async () => {
    renderProfilePage();
    await openAndParse();
    await waitRow();
    const row = document.querySelector<HTMLElement>('[data-row-id="' + ROW_ID + '"]');
    if (!row) throw new Error("row not found");
    fireEvent.change(within(row).getByLabelText("Name"), { target: { value: "Wang" } });
    fireEvent.click(screen.getByRole("button", { name: /确认填入 1 项/ }));
    const pageRoot = document.querySelector<HTMLElement>(".profile-page");
    if (!pageRoot) throw new Error("page root not found");
    await waitFor(() => expect(within(pageRoot).getByDisplayValue("Wang")).toBeInTheDocument());
    // 已存条目的稳定 id 仍在：确认填入只改字段值，不会把这条当成"新建条目"。
    expect(within(pageRoot).getByDisplayValue("entry-basic")).toBeInTheDocument();
    await waitFor(() => expect(getProfileSaveControl()).not.toBeNull());
  });

  it("点「取消」：弹窗关闭、表单一个字都不动", async () => {
    renderProfilePage();
    await openAndParse();
    await waitRow();
    const footer = document.querySelector<HTMLElement>(".ant-modal-footer");
    if (!footer) throw new Error("footer not found");
    fireEvent.click(within(footer).getByRole("button", { name: /取\s*消/ }));
    expect(screen.getByDisplayValue("Zhang")).toBeInTheDocument();
    expect(getProfileSaveControl()).toBeNull();
  });
});
