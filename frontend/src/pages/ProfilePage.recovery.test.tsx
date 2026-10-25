// SPDX-License-Identifier: Apache-2.0
/**
 * 资料页读取失败与恢复（F6/F7 迁移版）：失败不暴露空白编辑器，重试后回到可编辑的资料页。
 *
 * 新页面数据源是 GET /api/profile/workspace（编辑 DTO），渲染依赖当前组/定义/条目；
 * 读取失败必须显示 ErrorState（带重试），且此时不能挂悬浮球「去改资料」入口。
 */
import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupProfilePage, renderProfilePage } from "../test/profilePageHarness";
import { getProfileEditControl } from "../features/tou-tou/profileSaveBridge";
import { makeEntry, makeWorkspace } from "../test/profileWorkspaceFixture";

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

const WORKSPACE = makeWorkspace({
  entries: [makeEntry("basic_info", "entry-basic", { "basic_info.name": "Zhang" })],
});

beforeEach(() => {
  apiMocks.listPhotos.mockReset().mockResolvedValue([]);
  apiMocks.webformGet.mockReset().mockResolvedValue({ fields: [], groups: [], values: {} });
});

afterEach(cleanupProfilePage);

describe("profile read recovery", () => {
  it("does not expose a blank editor after a failed read and reloads the saved profile on retry", async () => {
    apiMocks.getWorkspace
      .mockReset()
      .mockRejectedValueOnce(new Error("原始资料读取失败"))
      .mockResolvedValue(WORKSPACE);
    renderProfilePage();

    const retry = await screen.findByRole("button", { name: /重\s*试/ });
    expect(retry.closest('[role="alert"]')).toHaveTextContent("原始资料读取失败");
    expect(screen.queryByRole("heading", { name: "我的资料" })).toBeNull();
    expect(apiMocks.saveEntries).not.toHaveBeenCalled();
    expect(getProfileEditControl()).toBeNull();

    fireEvent.click(retry);
    expect(await screen.findByDisplayValue("Zhang")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "我的资料" })).toBeInTheDocument();
    expect(apiMocks.saveEntries).not.toHaveBeenCalled();
  });
});
