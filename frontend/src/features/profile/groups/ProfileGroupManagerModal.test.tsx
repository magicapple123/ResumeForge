// SPDX-License-Identifier: Apache-2.0
/**
 * ProfileGroupManagerModal（F6/I + F9 + 问题 18）：单弹层多视图、默认组保护、删除三段式与切当前组。
 * 不叠 modal.confirm：确认条在本视图内联展示；删除是软删 + 5 秒撤销（hook 内发 toast）。
 *
 * 问题 18（2026-11-03）改造后的交互契约：
 * - 方案行首是 Radio（点整行即切换），重命名/删除收进 ⋯，删除走行下内联确认条；
 * - 板块行首是 Checkbox（参与当前方案），字段设置/改名/删除收进 ⋯；
 * - 字段设置视图标题为「板块名 · 字段设置」，面包屑可退回板块列表。
 *
 * F9 覆盖：
 * - 「大字段与字段」每个大字段行的参与勾选写当前组参与清单（基本信息禁用）；
 * - 新建组：创建即只含基本信息（大字段默认隐藏）；非编辑态自动设为当前组，
 *   编辑态不切组（R-26 未保存改动不能被绕过）；
 * - 字段设置添加自定义字段带 workspace revision（回归：曾经传 section.revision=0 必 409）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import * as api from "./api";
import ProfileGroupManagerModal from "./ProfileGroupManagerModal";
import { makeField, makeGroup, makeWorkspace } from "../../../test/profileWorkspaceFixture";

vi.mock("./api", () => ({
  listGroups: vi.fn(),
  createGroup: vi.fn(),
  renameGroup: vi.fn(),
  deleteGroup: vi.fn(),
  setGroupMembers: vi.fn(),
  switchCurrentGroup: vi.fn(),
  acknowledgeNotice: vi.fn(),
}));

vi.mock("../library/api", () => ({
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

import * as libraryApi from "../library/api";

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

/** 方案行：按方案名定位整行（行首是 Radio，动作收在 ⋯ 里）。 */
function groupRow(name: string): HTMLElement {
  const row = screen
    .getAllByTestId("group-row")
    .find((item) => (item.textContent ?? "").includes(name));
  if (!row) throw new Error("group row not found: " + name);
  return row;
}

/** 打开某一行的 ⋯ 菜单并点其中一项（antd Dropdown 的菜单挂在 portal 上）。 */
async function chooseRowAction(row: HTMLElement, menuName: string, itemLabel: string) {
  fireEvent.click(within(row).getByRole("button", { name: menuName }));
  fireEvent.click(await screen.findByRole("menuitem", { name: itemLabel }));
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
  it("列出活动方案，默认方案不可删除（⋯ 里的删除项禁用）", async () => {
    renderManager();
    expect(screen.getAllByTestId("group-row")).toHaveLength(2);
    // 每个方案行首一颗 Radio：当前方案那颗是选中的（这里是默认方案）。
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(2);
    expect(radios[0]).toBeChecked();
    expect(radios[1]).not.toBeChecked();
    fireEvent.click(
      within(groupRow("Default")).getByRole("button", { name: t("profileGroups.manager.more") }),
    );
    const protectedItem = await screen.findByRole("menuitem", {
      name: t("profileGroups.manager.defaultProtected"),
    });
    expect(protectedItem).toHaveAttribute("aria-disabled", "true");
  });

  it("删除方案先出三段式确认，确认后带 revision 调接口并刷新", async () => {
    const { onChanged } = renderManager();
    await chooseRowAction(
      groupRow("Research"),
      t("profileGroups.manager.more"),
      t("profileGroups.manager.deleteMenu"),
    );
    expect(
      screen.getByText(t("profileGroups.manager.deleteTitle", { name: "Research" })),
    ).toBeInTheDocument();
    expect(screen.getByText(t("profileGroups.manager.deleteBody"))).toBeInTheDocument();
    expect(screen.getByText(t("profileGroups.manager.deleteRestore"))).toBeInTheDocument();
    fireEvent.click(findButton(t("profileGroups.manager.deleteConfirm", { name: "Research" })));
    await waitFor(() => expect(api.deleteGroup).toHaveBeenCalledWith(RESEARCH_GROUP.group_id, 1));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("点整行（行首 Radio）切换当前方案，使用 workspace revision", async () => {
    renderManager();
    fireEvent.click(
      screen.getByRole("radio", {
        name: t("profileGroups.manager.setCurrentAria", { name: "Research" }),
      }),
    );
    await waitFor(() =>
      expect(api.switchCurrentGroup).toHaveBeenCalledWith(
        RESEARCH_GROUP.group_id,
        WORKSPACE.workspace_revision,
      ),
    );
  });

  it("重命名在 ⋯ 里：改名后用返回的新 revision 保存参与清单", async () => {
    // 回归 D1：改名成功会让 revision+1。若随后用 workspace 里的旧 revision 写 members，
    // 后端必然 409 revision_conflict（「内容已在其他窗口修改」），用户在同一弹层里
    // 改的参与清单会丢。这里让 rename 返回 revision=2，断言 members 也用 2。
    vi.mocked(api.renameGroup).mockResolvedValueOnce({
      ...RESEARCH_GROUP,
      name: "Research 2",
      revision: 2,
    });
    renderManager();
    await chooseRowAction(
      groupRow("Research"),
      t("profileGroups.manager.more"),
      t("profileGroups.manager.renameMenu"),
    );
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
    await chooseRowAction(
      groupRow("Research"),
      t("profileGroups.manager.more"),
      t("profileGroups.manager.renameMenu"),
    );
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

  it("新建方案（非编辑态）自动设为当前方案，并说明板块默认隐藏", async () => {
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

  it("编辑态新建方案不自动切组（未保存改动不能被绕过），提示先保存或取消", async () => {
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

  it("可切到「板块与字段」视图（单弹层多视图，不新开弹层）", () => {
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

  it("板块行首勾选写当前方案参与清单；基本信息勾选框禁用", async () => {
    renderManager();
    openSectionsView();
    const basicBox = screen.getByRole("checkbox", {
      name: t("profileLibrary.section.visibleAria", { name: "Basic Info" }),
    });
    expect(basicBox).toBeDisabled();

    const educationBox = screen.getByRole("checkbox", {
      name: t("profileLibrary.section.visibleAria", { name: "Education" }),
    });
    expect(educationBox).toBeChecked();
    fireEvent.click(educationBox);
    await waitFor(() =>
      expect(api.setGroupMembers).toHaveBeenCalledWith(
        DEFAULT_GROUP.group_id,
        CURRENT_KEYS.filter((key) => key !== "educations"),
        1,
      ),
    );
  });

  it("字段设置标题带板块名，面包屑可退回板块列表", async () => {
    renderManager();
    openSectionsView();
    await chooseRowAction(
      sectionRow("Education"),
      t("profileLibrary.sectionSettings.more"),
      t("profileLibrary.sectionSettings.fields"),
    );
    expect(
      screen.getByText(t("profileLibrary.fieldSettings.titleWithSection", { name: "Education" })),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("profileGroups.manager.sectionsTab") }));
    expect(screen.getByText(t("profileLibrary.sectionSettings.customTitle"))).toBeInTheDocument();
  });

  it("字段设置添加自定义字段带 workspace revision（不再 409 revision_conflict）", async () => {
    renderManager();
    openSectionsView();
    await chooseRowAction(
      sectionRow("Education"),
      t("profileLibrary.sectionSettings.more"),
      t("profileLibrary.sectionSettings.fields"),
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
        // v2 迁移后 createField 多了第 5 个参数（纸面位置/仅素材标记）：
        // 自定义短字段默认跟随目录（defaultPlacement=null），不是仅素材。
        { defaultPlacement: null, materialOnly: false },
      ),
    );
    // 成功路径不应出现 409 的「内容已在其他窗口修改」提示。
    expect(screen.queryByText(t("profileLibrary.error.conflict"))).not.toBeInTheDocument();
  });
});
