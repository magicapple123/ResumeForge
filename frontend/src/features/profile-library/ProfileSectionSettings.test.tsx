// SPDX-License-Identifier: Apache-2.0
/**
 * ProfileSectionSettings（F6/J）：自建大字段 CRUD 与删除三段式确认。
 * 结构定义删除不能静默执行：先取影响面，再把「动作 + 条数 + 保留后果 + 恢复位置」摆出来。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

/**
 * 行内图标动作（改名 / 字段设置 / 删除）改为 24×24 图标按钮后，按钮里没有文字，
 * 可访问名来自 aria-label，所以按 role + name 找。
 */
function clickIconButton(label: string): void {
  const target = screen.getAllByRole("button", { name: label })[0];
  if (!target) throw new Error("icon button not found: " + label);
  fireEvent.click(target);
}

function renderSettings() {
  const onChanged = vi.fn().mockResolvedValue(undefined);
  const onOpenFields = vi.fn();
  const onSetSectionVisible = vi.fn();
  render(
    <AntdApp>
      <ProfileSectionSettings
        workspace={WORKSPACE}
        onChanged={onChanged}
        onOpenFields={onOpenFields}
        onSetSectionVisible={onSetSectionVisible}
      />
    </AntdApp>,
  );
  return { onChanged, onOpenFields, onSetSectionVisible };
}

describe("ProfileSectionSettings", () => {
  it("新建自建大字段带 workspace revision", async () => {
    renderSettings();
    fireEvent.change(screen.getByPlaceholderText(t("profileLibrary.sectionSettings.nameLabel")), {
      target: { value: "Physics" },
    });
    clickButton(t("profileLibrary.sectionSettings.create"));
    await waitFor(() =>
      expect(api.createSection).toHaveBeenCalledWith("Physics", WORKSPACE.workspace_revision),
    );
  });

  it("删除自建大字段先取影响面，再展示三段式确认", async () => {
    const { onChanged } = renderSettings();
    clickIconButton(t("profileLibrary.sectionSettings.delete"));
    await waitFor(() => expect(api.getSectionDeletionImpact).toHaveBeenCalledWith("custom:abc"));
    expect(
      screen.getByText(t("profileLibrary.sectionSettings.deleteBody", { count: 2 })),
    ).toBeInTheDocument();
    expect(screen.getByText(t("profileLibrary.sectionSettings.deleteRestore"))).toBeInTheDocument();
    clickButton(t("profileLibrary.sectionSettings.deleteConfirm", { name: "Math" }));
    await waitFor(() => expect(api.deleteSection).toHaveBeenCalledWith("custom:abc", 7));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("大字段行有「在资料页显示」开关：切换写参与清单，基本信息不可隐藏", () => {
    const { onSetSectionVisible } = renderSettings();
    // 基本信息参与网申（R-21）：开关禁用并给原因，不由本行触发写请求。
    const basicSwitch = screen.getByRole("switch", {
      name: t("profileLibrary.section.visibleAria", { name: "Basic Info" }),
    });
    expect(basicSwitch).toBeDisabled();
    // 其它大字段默认显示；取消勾选 = 从当前组参与清单移除该 key。
    const education = screen.getByRole("switch", {
      name: t("profileLibrary.section.visibleAria", { name: "Education" }),
    });
    expect(education).toBeChecked();
    fireEvent.click(education);
    expect(onSetSectionVisible).toHaveBeenCalledWith("educations", false);
  });

  it("系统大字段没有删除/改名入口", () => {
    renderSettings();
    // 只有自建大字段 Math 有删除按钮；13 个系统大字段只有「字段设置」。
    // 图标按钮的可访问名来自 aria-label，按 role + name 计数。
    const byName = (label: string) => screen.getAllByRole("button", { name: label }).length;
    expect(byName(t("profileLibrary.sectionSettings.delete"))).toBe(1);
    expect(byName(t("profileLibrary.sectionSettings.rename"))).toBe(1);
  });
});
