// SPDX-License-Identifier: Apache-2.0
/**
 * ProfileGroupManagerModal（F6/I + F9）：单弹层多视图、默认组保护、删除三段式与切当前组。
 * 不叠 modal.confirm：确认条在本视图内联展示；删除是软删 + 5 秒撤销（hook 内发 toast）。
 *
 * F9 新增覆盖：
 * - 「大字段与字段」每个大字段行的「在资料页显示」开关写当前组参与清单（基本信息禁用）；
 * - 新建组：创建即只含基本信息（大字段默认隐藏）；非编辑态自动设为当前组，
 *   编辑态不切组（R-26 未保存改动不能被绕过）；
 * - 字段设置添加自定义字段带 workspace revision（回归：曾经传 section.revision=0 必 409）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import * as api from "./api";
import ProfileGroupManagerModal from "./ProfileGroupManagerModal";
import { makeField, makeGroup, makeWorkspace } from "../../test/profileWorkspaceFixture";

vi.mock("./api", () => ({
  listGroups: vi.fn(),
  createGroup: vi.fn(),
  renameGroup: vi.fn(),
  deleteGroup: vi.fn(),
  setGroupMembers: vi.fn(),
  switchCurrentGroup: vi.fn(),
  acknowledgeNotice: vi.fn(),
}));

vi.mock("../profile-library/api", () => ({
  createField: vi.fn(),
  updateField: vi.fn(),
  deleteField: vi.fn(),
  getFieldDeletionImpact: vi.fn(),
  patchFieldPreference: vi.fn(),
  createSection: vi.fn(),
  renameSection: vi.fn(),
  deleteSection: vi.fn(),
  getSectionDeletionImpact: vi.fn(),
  saveEntries: vi.fn(),
  setSectionOrder: vi.fn(),
  getWorkspace: vi.fn(),
}));

import * as libraryApi from "../profile-library/api";

const DEFAULT_GROUP = makeGroup("group-default", "Default", { is_default: true });
const RESEARCH_GROUP = makeGroup("group-research", "Research", {
  participating_keys: ["basic_info", "educations"],
});
const WORKSPACE = makeWorkspace({ groups: [DEFAULT_GROUP, RESEARCH_GROUP] });
const CURRENT_KEYS = WORKSPACE.current_group?.participating_keys ?? [];

beforeEach(() => {
  vi.mocked(api.switchCurrentGroup).mockReset().mockResolvedValue({
    section_order: WORKSPACE.section_order,
    current_group_id: RESEARCH_GROUP.group_id,
    default_group_id: DEFAULT_GROUP.group_id,
    workspace_revision: 4,
    pending_notice: null,
  });
  vi.mocked(api.deleteGroup).mockReset().mockResolvedValue({
    deleted_group_id: RESEARCH_GROUP.group_id,
    switched_to: null,
    notice_id: null,
    current_group: DEFAULT_GROUP,
  });
  vi.mocked(api.createGroup).mockReset().mockResolvedValue(RESEARCH_GROUP);
  vi.mocked(api.renameGroup).mockReset().mockResolvedValue(RESEARCH_GROUP);
  vi.mocked(api.setGroupMembers).mockReset().mockResolvedValue(RESEARCH_GROUP);
  vi.mocked(libraryApi.createField)
    .mockReset()
    .mockResolvedValue(makeField("educations", "lab", "Research"));
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

/** antd Button 会给两个汉字的文本自动插空格，按去空白后的名字找按钮。 */
function compactLabel(label: string): string {
  return label.replace(/\s+/g, "");
}

function findButton(label: string): HTMLElement {
  const compact = compactLabel(label);
  const found = screen
    .getAllByRole("button")
    .find((button) => compactLabel(button.textContent ?? "") === compact);
  if (!found) throw new Error("button not found: " + label);
  return found;
}

/**
 * 行内图标动作（编辑 / 删除 / 字段设置）按钮里没有文字，可访问名来自 aria-label，
 * 所以按 role + name 找，而不是按 textContent。
 */
function findIconButton(label: string): HTMLElement {
  const found = screen.getAllByRole("button", { name: label })[0];
  if (!found) throw new Error("icon button not found: " + label);
  return found;
}

function findIconButtonIn(container: HTMLElement, label: string): HTMLElement {
  const found = within(container).getByRole("button", { name: label });
  if (!found) throw new Error("icon button not found in row: " + label);
  return found;
}

function renderManager(onChanged = vi.fn().mockResolvedValue(undefined), editing = false) {
  render(
    <AntdApp>
      <ProfileGroupManagerModal
        open
        onClose={vi.fn()}
        workspace={WORKSPACE}
        onChanged={onChanged}
        editing={editing}
      />
    </AntdApp>,
  );
  return { onChanged };
}

function openSectionsView() {
  // 视图切换已从底部按钮改成顶部页签（用户 2026-10-28 要求去掉底部那排按钮）。
  fireEvent.click(screen.getByRole("tab", { name: t("profileGroups.manager.sectionsTab") }));
}

function sectionRow(name: string): HTMLElement {
  const row = screen.getByText(name).closest(".profile-settings-row");
  if (!(row instanceof HTMLElement)) throw new Error("section row not found: " + name);
  return row;
}

describe("ProfileGroupManagerModal", () => {
  it("列出活动组，默认组受保护（不可删除）", () => {
    renderManager();
    expect(screen.getAllByTestId("group-row")).toHaveLength(2);
    // 默认组不给删除按钮；非默认组有一颗。
    expect(findIconButton(t("profileGroups.manager.delete"))).toBeInTheDocument();
    expect(screen.getByText(t("profileGroups.manager.defaultProtected"))).toBeInTheDocument();
    // 默认组之外的那一个才有「设为当前组」。
    expect(findButton(t("profileGroups.manager.setCurrent"))).toBeInTheDocument();
  });

  it("删除组先出三段式确认，确认后带 revision 调接口并刷新", async () => {
    const { onChanged } = renderManager();
    fireEvent.click(findIconButton(t("profileGroups.manager.delete")));
    expect(
      screen.getByText(t("profileGroups.manager.deleteTitle", { name: "Research" })),
    ).toBeInTheDocument();
    expect(screen.getByText(t("profileGroups.manager.deleteBody"))).toBeInTheDocument();
    expect(screen.getByText(t("profileGroups.manager.deleteRestore"))).toBeInTheDocument();
    fireEvent.click(findButton(t("profileGroups.manager.deleteConfirm", { name: "Research" })));
    await waitFor(() => expect(api.deleteGroup).toHaveBeenCalledWith(RESEARCH_GROUP.group_id, 1));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("切换当前组使用 workspace revision；组编辑视图用改名返回的新 revision 保存参与清单", async () => {
    // 回归 D1：改名成功会让 revision+1。若随后用 workspace 里的旧 revision 写 members，
    // 后端必然 409 revision_conflict（「内容已在其他窗口修改」），用户在同一弹层里
    // 改的参与清单会丢。这里让 rename 返回 revision=2，断言 members 也用 2。
    vi.mocked(api.renameGroup).mockResolvedValueOnce({
      ...RESEARCH_GROUP,
      name: "Research 2",
      revision: 2,
    });
    renderManager();
    fireEvent.click(findButton(t("profileGroups.manager.setCurrent")));
    await waitFor(() =>
      expect(api.switchCurrentGroup).toHaveBeenCalledWith(
        RESEARCH_GROUP.group_id,
        WORKSPACE.workspace_revision,
      ),
    );

    const researchRow = screen
      .getAllByTestId("group-row")
      .find((row) => (row.textContent ?? "").includes("Research"));
    if (!researchRow) throw new Error("research group row not found");
    fireEvent.click(findIconButtonIn(researchRow, t("profileGroups.manager.rename")));
    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: "Education" })).toBeInTheDocument(),
    );
    // 「编辑」打开的是名称 + 参与清单：参与清单的显示语义要有说明（F9）。
    expect(screen.getByText(t("profileGroups.manager.membersVisibilityHint"))).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(t("profileGroups.manager.nameLabel")), {
      target: { value: "Research 2" },
    });
    fireEvent.click(findButton(t("profileGroups.manager.saveMembers")));
    await waitFor(() =>
      expect(api.renameGroup).toHaveBeenCalledWith(RESEARCH_GROUP.group_id, "Research 2", 1),
    );
    await waitFor(() =>
      expect(api.setGroupMembers).toHaveBeenCalledWith(
        RESEARCH_GROUP.group_id,
        expect.any(Array),
        2,
      ),
    );
    // 成功路径不得出现 409 的「内容已在其他窗口修改」提示。
    expect(screen.queryByText(t("profileLibrary.error.conflict"))).not.toBeInTheDocument();
  });

  it("只改参与清单不改名时，用 workspace 里的当前 revision 保存（不触发多余改名）", async () => {
    renderManager();
    const researchRow = screen
      .getAllByTestId("group-row")
      .find((row) => (row.textContent ?? "").includes("Research"));
    if (!researchRow) throw new Error("research group row not found");
    fireEvent.click(findIconButtonIn(researchRow, t("profileGroups.manager.rename")));
    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: "Education" })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Projects" }));
    fireEvent.click(findButton(t("profileGroups.manager.saveMembers")));
    await waitFor(() =>
      expect(api.setGroupMembers).toHaveBeenCalledWith(
        RESEARCH_GROUP.group_id,
        expect.arrayContaining(["projects"]),
        1,
      ),
    );
    expect(api.renameGroup).not.toHaveBeenCalled();
  });

  it("新建组（非编辑态）自动设为当前组，并说明大字段默认隐藏", async () => {
    renderManager();
    fireEvent.change(screen.getByLabelText(t("profileGroups.manager.nameLabel")), {
      target: { value: "Teaching" },
    });
    fireEvent.click(findButton(t("profileGroups.manager.create")));
    await waitFor(() => expect(api.createGroup).toHaveBeenCalledWith("Teaching"));
    await waitFor(() =>
      expect(api.switchCurrentGroup).toHaveBeenCalledWith(
        RESEARCH_GROUP.group_id,
        WORKSPACE.workspace_revision,
      ),
    );
    expect(
      await screen.findByText(t("profileGroups.manager.createdSwitched", { name: "Research" })),
    ).toBeInTheDocument();
  });

  it("编辑态新建组不自动切组（未保存改动不能被绕过），提示先保存或取消", async () => {
    renderManager(vi.fn().mockResolvedValue(undefined), true);
    fireEvent.change(screen.getByLabelText(t("profileGroups.manager.nameLabel")), {
      target: { value: "Teaching" },
    });
    fireEvent.click(findButton(t("profileGroups.manager.create")));
    await waitFor(() => expect(api.createGroup).toHaveBeenCalledWith("Teaching"));
    expect(api.switchCurrentGroup).not.toHaveBeenCalled();
    expect(
      await screen.findByText(t("profileGroups.manager.createdKeepEditing", { name: "Research" })),
    ).toBeInTheDocument();
  });

  it("可切到大字段与字段视图（单弹层多视图，不新开弹层）", () => {
    renderManager();
    openSectionsView();
    expect(screen.getByText(t("profileLibrary.sectionSettings.customTitle"))).toBeInTheDocument();
    expect(screen.getByText(t("profileLibrary.sectionSettings.builtinHint"))).toBeInTheDocument();
  });

  it("视图切换只在顶部页签：底部不再有「板块与字段 / 关闭」按钮", () => {
    renderManager();
    // 导航只有页签，关闭只有右上角 ×；底部那排按钮已在 2026-10-28 移除。
    expect(
      screen.getByRole("tab", { name: t("profileGroups.manager.groupsTab") }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: t("profileGroups.manager.sectionsTab") }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: t("profileGroups.manager.close") }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: t("profileGroups.manager.sectionsTab") }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: t("profileGroups.manager.groupsTab") }),
    ).not.toBeInTheDocument();
  });

  it("大字段行开关写当前组参与清单；基本信息开关禁用", async () => {
    renderManager();
    openSectionsView();
    const basicSwitch = screen.getByRole("switch", {
      name: t("profileLibrary.section.visibleAria", { name: "Basic Info" }),
    });
    expect(basicSwitch).toBeDisabled();

    const educationSwitch = screen.getByRole("switch", {
      name: t("profileLibrary.section.visibleAria", { name: "Education" }),
    });
    expect(educationSwitch).toBeChecked();
    fireEvent.click(educationSwitch);
    await waitFor(() =>
      expect(api.setGroupMembers).toHaveBeenCalledWith(
        DEFAULT_GROUP.group_id,
        CURRENT_KEYS.filter((key) => key !== "educations"),
        1,
      ),
    );
  });

  it("字段设置添加自定义字段带 workspace revision（不再 409 revision_conflict）", async () => {
    renderManager();
    openSectionsView();
    fireEvent.click(
      findIconButtonIn(sectionRow("Education"), t("profileLibrary.sectionSettings.fields")),
    );
    fireEvent.change(screen.getByPlaceholderText(t("profileLibrary.fieldSettings.label")), {
      target: { value: "Research" },
    });
    fireEvent.click(findButton(t("profileLibrary.fieldSettings.create")));
    await waitFor(() =>
      expect(libraryApi.createField).toHaveBeenCalledWith(
        "educations",
        "Research",
        "single_line",
        WORKSPACE.workspace_revision,
      ),
    );
    // 成功路径不应出现 409 的「内容已在其他窗口修改」提示。
    expect(screen.queryByText(t("profileLibrary.error.conflict"))).not.toBeInTheDocument();
  });
});
