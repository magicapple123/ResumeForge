// SPDX-License-Identifier: Apache-2.0
/**
 * ProfileSectionSettings（F6/J + 问题 18）：自建板块 CRUD 与删除三段式确认。
 * 结构定义删除不能静默执行：先取影响面，再把「动作 + 条数 + 保留后果 + 恢复位置」摆出来。
 *
 * 问题 18 改造后的交互契约：行首 Checkbox = 参与当前方案；改名/字段设置/删除收进 ⋯；
 * 创建区在列表底部；系统板块只有「字段设置」一项。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import * as api from "./api";
import ProfileSectionSettings from "./ProfileSectionSettings";
import {
  makeAllSections,
  makeEntry,
  makeSection,
  makeWorkspace,
} from "../../test/profileWorkspaceFixture";

vi.mock("./api", () => ({
  createSection: vi.fn(),
  renameSection: vi.fn(),
  setSectionJobFilter: vi.fn(),
  deleteSection: vi.fn(),
  getSectionDeletionImpact: vi.fn(),
  createField: vi.fn(),
  updateField: vi.fn(),
  deleteField: vi.fn(),
  getFieldDeletionImpact: vi.fn(),
  patchFieldPreference: vi.fn(),
  saveEntries: vi.fn(),
  setSectionOrder: vi.fn(),
  getWorkspace: vi.fn(),
}));

const CUSTOM = makeSection("custom:abc", "Math", "multi", [], { is_builtin: false });
const WORKSPACE = makeWorkspace({
  sections: [...makeAllSections(), CUSTOM],
  entries: [makeEntry("custom:abc", "entry-0001", { "custom:abc.title": "Line" })],
});

beforeEach(() => {
  vi.mocked(api.createSection).mockReset().mockResolvedValue(CUSTOM);
  vi.mocked(api.renameSection).mockReset().mockResolvedValue(CUSTOM);
  vi.mocked(api.deleteSection).mockReset().mockResolvedValue({
    entry_count: 1,
    filled_entry_count: 1,
    can_delete: true,
    restore_path: "Trash",
    revision: 7,
  });
  vi.mocked(api.getSectionDeletionImpact).mockReset().mockResolvedValue({
    entry_count: 2,
    filled_entry_count: 2,
    can_delete: true,
    restore_path: "Trash",
    revision: 7,
  });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

/** antd Button 会给「两个汉字」自动插空格（如「创 建」），按去空白后的文本点按钮。 */
function clickButton(label: string): void {
  const compact = label.replace(/\s+/g, "");
  const target = screen
    .getAllByRole("button")
    .find((button) => (button.textContent ?? "").replace(/\s+/g, "") === compact);
  if (!target) throw new Error("button not found: " + label);
  fireEvent.click(target);
}

/** 行内动作收进 ⋯ 之后：先点该行的 ⋯，再点菜单项（antd Dropdown 菜单挂在 portal 上）。 */
async function chooseRowAction(row: HTMLElement, itemLabel: string) {
  fireEvent.click(
    within(row).getByRole("button", { name: t("profileLibrary.sectionSettings.more") }),
  );
  fireEvent.click(await screen.findByRole("menuitem", { name: itemLabel }));
}

function sectionRow(name: string): HTMLElement {
  const row = screen.getByText(name).closest(".profile-settings-row");
  if (!(row instanceof HTMLElement)) throw new Error("section row not found: " + name);
  return row;
}

function renderSettings() {
  const onChanged = vi.fn().mockResolvedValue(undefined);
  const onOpenFields = vi.fn();
  const onSetSectionVisible = vi.fn();
  const onSetSectionJobFilter = vi.fn();
  render(
    <AntdApp>
      <ProfileSectionSettings
        workspace={WORKSPACE}
        onChanged={onChanged}
        onOpenFields={onOpenFields}
        onSetSectionVisible={onSetSectionVisible}
        onSetSectionJobFilter={onSetSectionJobFilter}
      />
    </AntdApp>,
  );
  return { onChanged, onOpenFields, onSetSectionVisible, onSetSectionJobFilter };
}

describe("ProfileSectionSettings", () => {
  it("新建自建板块带 workspace revision", async () => {
    renderSettings();
    fireEvent.change(screen.getByPlaceholderText(t("profileLibrary.sectionSettings.nameLabel")), {
      target: { value: "Physics" },
    });
    clickButton(t("profileLibrary.sectionSettings.create"));
    await waitFor(() =>
      expect(api.createSection).toHaveBeenCalledWith("Physics", WORKSPACE.workspace_revision),
    );
  });

  it("删除自建板块在 ⋯ 里：先取影响面，再展示三段式确认", async () => {
    const { onChanged } = renderSettings();
    await chooseRowAction(sectionRow("Math"), t("profileLibrary.sectionSettings.deleteMenu"));
    await waitFor(() => expect(api.getSectionDeletionImpact).toHaveBeenCalledWith("custom:abc"));
    expect(
      screen.getByText(t("profileLibrary.sectionSettings.deleteBody", { count: 2 })),
    ).toBeInTheDocument();
    expect(screen.getByText(t("profileLibrary.sectionSettings.deleteRestore"))).toBeInTheDocument();
    clickButton(t("profileLibrary.sectionSettings.deleteConfirm", { name: "Math" }));
    await waitFor(() => expect(api.deleteSection).toHaveBeenCalledWith("custom:abc", 7));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("板块行首勾选写参与清单：切换即回调，基本信息不可取消", () => {
    const { onSetSectionVisible } = renderSettings();
    // 基本信息参与网申（R-21）：勾选框禁用，不由本行触发写请求。
    const basicBox = screen.getByRole("checkbox", {
      name: t("profileLibrary.section.visibleAria", { name: "Basic Info" }),
    });
    expect(basicBox).toBeDisabled();
    // 其它板块默认勾选；取消勾选 = 从当前方案参与清单移除该 key。
    const education = screen.getByRole("checkbox", {
      name: t("profileLibrary.section.visibleAria", { name: "Education" }),
    });
    expect(education).toBeChecked();
    fireEvent.click(education);
    expect(onSetSectionVisible).toHaveBeenCalledWith("educations", false);
  });

  it("自建板块有「参与岗位筛选」开关：切换即回调，说明常驻可见", () => {
    const { onSetSectionJobFilter } = renderSettings();
    // 系统板块没有这个开关（需求 6 只对自建板块开放）。
    expect(
      screen.queryByRole("switch", {
        name: t("profileLibrary.sectionSettings.jobFilterAria", { name: "Education" }),
      }),
    ).not.toBeInTheDocument();

    const toggle = screen.getByRole("switch", {
      name: t("profileLibrary.sectionSettings.jobFilterAria", { name: "Math" }),
    });
    // 默认关 = 保持历史行为（整块无条件进简历）。
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    expect(onSetSectionJobFilter).toHaveBeenCalledWith("custom:abc", true);
    // 说明必须在界面上看得见，不能只放进 Tooltip。
    expect(
      screen.getAllByText(t("profileLibrary.sectionSettings.jobFilterHint")).length,
    ).toBeGreaterThan(0);
  });

  it("系统板块的 ⋯ 里只有「字段设置」，没有改名与删除", async () => {
    const { onOpenFields } = renderSettings();
    fireEvent.click(
      within(sectionRow("Education")).getByRole("button", {
        name: t("profileLibrary.sectionSettings.more"),
      }),
    );
    const items = await screen.findAllByRole("menuitem");
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent(t("profileLibrary.sectionSettings.fields"));
    fireEvent.click(items[0]);
    expect(onOpenFields).toHaveBeenCalledWith("educations");
  });

  it("自建板块的 ⋯ 里改名、字段设置、删除三项齐全", async () => {
    renderSettings();
    fireEvent.click(
      within(sectionRow("Math")).getByRole("button", {
        name: t("profileLibrary.sectionSettings.more"),
      }),
    );
    expect(
      await screen.findByRole("menuitem", { name: t("profileLibrary.sectionSettings.renameMenu") }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: t("profileLibrary.sectionSettings.fields") }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: t("profileLibrary.sectionSettings.deleteMenu") }),
    ).toBeInTheDocument();
  });
});
