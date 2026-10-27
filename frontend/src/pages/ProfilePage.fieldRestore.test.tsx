// SPDX-License-Identifier: Apache-2.0
/**
 * 我的资料页：字段隐藏/恢复（#8 的保留能力）。
 *
 * 「默认收起 / 更多字段」折叠入口已下线：字段始终渲染，只保留「隐藏 / 恢复」。
 * 本文件单独成文件：ProfilePage.test.tsx 受 backend/tests/test_file_size_budget.py 的
 * 500 行硬预算约束，字段可见性是与分页/未保存防护/分区折叠无关的独立主题。
 */
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n";
import {
  findHeaderEditButton,
  headerEditButton,
  renderProfilePage,
} from "../test/profilePageHarness";
import {
  makeAllSections,
  makeEntry,
  makeField,
  makeWorkspace,
} from "../test/profileWorkspaceFixture";

const apiMocks = vi.hoisted(() => ({
  getWorkspace: vi.fn(),
  patchFieldPreference: vi.fn(),
  listProfilePhotos: vi.fn(),
  getWebFormExtraProfile: vi.fn(),
  updateWebFormExtraProfile: vi.fn(),
}));

vi.mock("../features/profile-library/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/profile-library/api")>()),
  getWorkspace: apiMocks.getWorkspace,
  patchFieldPreference: apiMocks.patchFieldPreference,
}));

vi.mock("../api/photo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/photo")>()),
  listProfilePhotos: apiMocks.listProfilePhotos,
}));

vi.mock("../api/webform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/webform")>()),
  getWebFormExtraProfile: apiMocks.getWebFormExtraProfile,
  updateWebFormExtraProfile: apiMocks.updateWebFormExtraProfile,
}));

/** basic_info 的「Gender」在服务端已隐藏：只有「已隐藏 N 个字段」能把它恢复出来。 */
function hiddenFieldWorkspace() {
  return makeWorkspace({
    sections: makeAllSections().map((section) =>
      section.key === "basic_info"
        ? {
            ...section,
            fields: [
              makeField("basic_info", "name", "Name"),
              makeField("basic_info", "gender", "Gender", { hidden: true }),
            ],
          }
        : section,
    ),
    entries: [makeEntry("basic_info", "basic-1", { "basic_info.name": "Zhang" })],
  });
}

beforeEach(() => {
  apiMocks.getWorkspace.mockReset().mockResolvedValue(hiddenFieldWorkspace());
  apiMocks.patchFieldPreference.mockReset().mockResolvedValue({
    ...makeField("basic_info", "gender", "Gender"),
    hidden: false,
    preference_revision: 1,
  });
  apiMocks.listProfilePhotos.mockReset().mockResolvedValue([]);
  apiMocks.getWebFormExtraProfile
    .mockReset()
    .mockResolvedValue({ fields: [], groups: [], values: {} });
  apiMocks.updateWebFormExtraProfile
    .mockReset()
    .mockResolvedValue({ fields: [], groups: [], values: {} });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ProfilePage 字段隐藏恢复", () => {
  it("「已隐藏 N 个字段」仍可逐项恢复，且恢复后字段重新出现", async () => {
    renderProfilePage();
    await findHeaderEditButton();
    // 查看态整页在 <Form disabled> 里，行内按钮跟着禁用：字段恢复走编辑态
    //（字段设置弹层是另一条入口，不在本用例范围）。
    fireEvent.click(headerEditButton());

    // 隐藏字段不渲染，但恢复入口还在（折叠下线没有把「隐藏 / 恢复」一起删掉）。
    expect(screen.queryByLabelText("Gender")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: t("profileLibrary.field.hiddenList", { count: 1 }),
      }),
    );
    fireEvent.click(await screen.findByRole("button", { name: t("profileLibrary.field.restore") }));

    await waitFor(() =>
      expect(apiMocks.patchFieldPreference).toHaveBeenCalledWith("basic_info.gender", {
        section_key: "basic_info",
        hidden: false,
        expected_revision: 0,
      }),
    );
    expect(await screen.findByLabelText("Gender")).toBeInTheDocument();
  });
});
