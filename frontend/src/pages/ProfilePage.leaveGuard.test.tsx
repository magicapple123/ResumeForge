// SPDX-License-Identifier: Apache-2.0
/**
 * 未保存确认卡片与悬浮球浮卡的互斥（2026-10-27 用户截图反馈）。
 *
 * 确认卡片弹出时，右下角投投浮球还挂着「资料有未保存的修改 / 保存资料 / 取消」，同一屏
 * 出现两个"未保存"提示，其中一个还压在遮罩之上——用户会以为有两个不同的决定要做。
 * 所以两个桥槽位在 `confirmOpen` 期间都必须注销，回到编辑态后再挂回来。
 *
 * 单独成文件：`ProfilePage.test.tsx` 已贴 500 行测试预算，而 `vi.mock` 是**文件级**的
 * （每个测试文件各自声明），只能连脚手架一起搬。
 */
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getProfileEditControl,
  getProfileSaveControl,
} from "../features/tou-tou/profileSaveBridge";
import {
  makeAllSections,
  makeEntry,
  makeField,
  makeWorkspace,
} from "../test/profileWorkspaceFixture";
import {
  cleanupProfilePage,
  findHeaderEditButton,
  headerEditButton,
  headerRegion,
  looseButtonName,
  renderProfilePage,
} from "../test/profilePageHarness";
import { t } from "../i18n";

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

/** 用例只碰「姓名」：基本信息的字段定义按 label 造两条，其余分区用夹具默认值。 */
const WORKSPACE = makeWorkspace({
  sections: makeAllSections().map((section) =>
    section.key === "basic_info"
      ? {
          ...section,
          fields: [
            makeField("basic_info", "name", "姓名"),
            makeField("basic_info", "gender", "性别"),
          ],
        }
      : section,
  ),
  entries: [makeEntry("basic_info", "entry-basic", { "basic_info.name": "Zhang" })],
});

beforeEach(() => {
  apiMocks.getWorkspace.mockReset().mockResolvedValue(WORKSPACE);
  apiMocks.saveEntries.mockReset().mockResolvedValue(WORKSPACE);
  apiMocks.listPhotos.mockReset().mockResolvedValue([]);
  apiMocks.webformGet.mockReset().mockResolvedValue({ fields: [], groups: [], values: {} });
});

afterEach(cleanupProfilePage);

describe("ProfilePage 未保存确认卡片 · 与悬浮球浮卡互斥", () => {
  it("确认卡片弹出时注销保存浮卡，继续编辑后重新挂回", async () => {
    renderProfilePage();
    await findHeaderEditButton();
    fireEvent.click(headerEditButton());
    fireEvent.change(await screen.findByLabelText("姓名"), { target: { value: "李四" } });
    // 脏值 → 悬浮球拿到「保存资料 / 取消」入口。
    await waitFor(() => expect(getProfileSaveControl()).not.toBeNull());

    // 取消编辑 = 有内容会丢 → 出确认卡片，浮卡同时收起。
    fireEvent.click(
      within(headerRegion()).getByRole("button", {
        name: looseButtonName(t("profileLibrary.action.cancel")),
      }),
    );
    expect(await screen.findByText(t("profileGroups.leave.title"))).toBeInTheDocument();
    expect(getProfileSaveControl()).toBeNull();
    expect(getProfileEditControl()).toBeNull();

    // 继续编辑：卡片关闭、内容还在、浮卡重新挂回（dirty 没有被清掉）。
    fireEvent.click(
      screen.getByRole("button", { name: looseButtonName(t("profileGroups.leave.keep")) }),
    );
    // 浮卡挂回就是"卡片已关"的可观察证据（两条 effect 的开关同一个 confirmOpen）。
    // 不断言 `.ant-modal-title` 消失：离场动画在 jsdom 里不会走完，节点会留一会儿。
    await waitFor(() => expect(getProfileSaveControl()).not.toBeNull());
  });
});
