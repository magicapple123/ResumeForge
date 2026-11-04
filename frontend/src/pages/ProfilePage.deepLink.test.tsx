// SPDX-License-Identifier: Apache-2.0
/**
 * ProfilePage deep link (`/profile?section=…&entry=…`).
 *
 * A global-search hit must land on the actual section/entry, must never fail silently
 * when the section is outside the current scheme, and must degrade to the section
 * when the entry no longer exists (soft-deleted or merged).
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n";
import { setGroupMembers } from "../features/profile-groups/api";
import ProfilePage from "./ProfilePage";
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

function renderPage(entry: string) {
  const router = createMemoryRouter([{ path: "/", element: <ProfilePage /> }], {
    initialEntries: [entry],
  });
  render(
    <AntdApp>
      <RouterProvider router={router} />
    </AntdApp>,
  );
}

function sectionNode(key: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-profile-section-key="${key}"]`);
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

describe("ProfilePage deep link", () => {
  it("locates and focuses the target section", async () => {
    apiMocks.getWorkspace.mockReset().mockResolvedValue(makeWorkspace());
    renderPage("/?section=skills");

    await screen.findByText(t("profileGroups.control.label"));
    await waitFor(() => expect(sectionNode("skills")).toHaveClass("is-deep-link-target"));
    expect(document.activeElement).toBe(sectionNode("skills"));
  });

  it("locates the exact entry when entry key still exists", async () => {
    const workspace = makeWorkspace({
      entries: [makeEntry("skills", "entry-skill-1", { "skills.title": "Python" })],
    });
    apiMocks.getWorkspace.mockReset().mockResolvedValue(workspace);
    renderPage("/?section=skills&entry=entry-skill-1");

    await screen.findByText(t("profileGroups.control.label"));
    const entryNode = await waitFor(() => {
      const node = document.querySelector<HTMLElement>(
        '[data-profile-entry-key="entry-skill-1"]',
      );
      expect(node).not.toBeNull();
      expect(node).toHaveClass("is-deep-link-target");
      return node as HTMLElement;
    });
    expect(document.activeElement).toBe(entryNode);
  });

  it("explains when the target section is outside the current scheme", async () => {
    const sections = makeAllSections();
    const group = makeGroup("group-default", "Default", {
      is_default: true,
      participating_keys: ["basic_info", "educations"],
    });
    apiMocks.getWorkspace
      .mockReset()
      .mockResolvedValue(makeWorkspace({ sections, current_group: group, groups: [group] }));
    renderPage("/?section=skills");

    const notice = await screen.findByText(
      t("profileLibrary.deepLink.hiddenTitle", { name: "Skills" }),
    );
    expect(notice).toBeInTheDocument();
    expect(sectionNode("skills")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: t("profileLibrary.deepLink.showInScheme") }),
    );
    await waitFor(() =>
      expect(setGroupMembers).toHaveBeenCalledWith(
        "group-default",
        ["basic_info", "educations", "skills"],
        1,
      ),
    );
  });

  it("degrades to the section when the entry no longer exists", async () => {
    apiMocks.getWorkspace.mockReset().mockResolvedValue(makeWorkspace({ entries: [] }));
    renderPage("/?section=skills&entry=deleted-entry");

    await screen.findByText(t("profileGroups.control.label"));
    await waitFor(() => expect(sectionNode("skills")).toHaveClass("is-deep-link-target"));
    expect(document.querySelector('[data-profile-entry-key="deleted-entry"]')).toBeNull();
  });
});
