// SPDX-License-Identifier: Apache-2.0
/**
 * 7-A 验收：自定义字段在「字段设置」里也有隐藏开关。
 *
 * 现象：默认字段每行右侧有隐藏开关，自定义字段只有「纸面位置」「仅素材」和 ⋯，
 * 用户想暂时不用某个自定义字段只能删掉（连定义与已填内容一起丢）。后端早已支持
 * （patch_preference 对自建字段走 active_custom_field 归属校验），缺的只是 UI。
 *
 * 这里钉住四件事：
 * 1. 自定义字段行有隐藏开关，且写到**同一份偏好接口**（hidden + expected_revision）；
 * 2. 已隐藏的字段显示「恢复显示」的 aria，点回来写 hidden=false；
 * 3. 「仅素材」与「隐藏」是两颗独立开关，不是同一个控件；
 * 4. 自建板块的主文本字段带「主文本字段」标注（隐藏它会丢正文段落）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import * as api from "./api";
import ProfileFieldSettings from "./ProfileFieldSettings";
import { makeField, makeSection } from "../../test/profileWorkspaceFixture";
import type { FieldOut, SectionOut } from "./types";

vi.mock("./api", () => ({
  createField: vi.fn(),
  updateField: vi.fn(),
  deleteField: vi.fn(),
  getFieldDeletionImpact: vi.fn(),
  patchFieldPreference: vi.fn(),
}));

/**
 * 纸面位置目录走 `./fieldPlacement` 的会话级缓存（**不在** `./api` 里），且 hook 内部
 * 直接调同模块的取数函数——所以这里只替换 hook 的返回值，其余（`profilePlacementLabel`、
 * `catalogPlacementOf`、`PROFILE_PLACEMENT_OPTIONS`…）保持真实实现。
 * 空目录 = 内置字段无徽标，正是 jsdom 里没有后端时的真实降级形态。
 */
vi.mock("./fieldPlacement", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./fieldPlacement")>();
  return {
    ...actual,
    useFieldPlacementCatalog: () => ({ catalog: null, loading: false, error: true }),
  };
});

const PRIMARY_ID = "fld_primary00000001";
const SECOND_ID = "fld_secondary000001";

function customField(fieldId: string, label: string, extra: Partial<FieldOut> = {}): FieldOut {
  return makeField("custom:sec1", label.toLowerCase(), label, {
    field_id: fieldId,
    is_builtin: false,
    preference_revision: 3,
    revision: 2,
    default_placement: "trail",
    effective_placement: "trail",
    material_only: false,
    ...extra,
  });
}

/** 自建板块：carrier_field_id 就是 primary_field_id（后端 _merge_custom_section 的同一判定）。 */
function customSection(fields: FieldOut[], carrierFieldId: string | null): SectionOut {
  return makeSection("custom:sec1", "Math", "multi", fields, {
    is_builtin: false,
    carrier_field_id: carrierFieldId,
  });
}

const FIELD = customField(PRIMARY_ID, "Title");
const SECTION = customSection([FIELD], PRIMARY_ID);

beforeEach(() => {
  vi.mocked(api.patchFieldPreference).mockReset().mockResolvedValue(FIELD);
  vi.mocked(api.updateField).mockReset().mockResolvedValue(FIELD);
  vi.mocked(api.createField).mockReset().mockResolvedValue(FIELD);
  // deleteField 返回的是删除影响面（不是 void）：删成功也是一份 FieldDeletionImpactOut。
  vi.mocked(api.deleteField).mockReset().mockResolvedValue({
    affected_entries: 0,
    can_delete: true,
    restore_path: "Trash",
    revision: 2,
  });
  vi.mocked(api.getFieldDeletionImpact).mockReset().mockResolvedValue({
    affected_entries: 0,
    can_delete: true,
    restore_path: "Trash",
    revision: 2,
  });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

function renderSettings(section: SectionOut = SECTION) {
  const onChanged = vi.fn().mockResolvedValue(undefined);
  render(
    <AntdApp>
      <ProfileFieldSettings
        section={section}
        maxCustomFields={20}
        workspaceRevision={11}
        sectionVisible
        onSetSectionVisible={vi.fn()}
        onChanged={onChanged}
        onBack={vi.fn()}
      />
    </AntdApp>,
  );
  return { onChanged };
}

/** 自定义字段那一行（.profile-field-row），隐藏开关与「仅素材」都在它里面。 */
function fieldRow(label: string): HTMLElement {
  const row = screen.getByText(label).closest(".profile-field-row");
  if (!(row instanceof HTMLElement)) throw new Error("field row not found: " + label);
  return row;
}

function hideSwitch(label: string): HTMLElement {
  return within(fieldRow(label)).getByRole("switch", {
    name: t("profileLibrary.fieldSettings.hideAria", { label }),
  });
}

describe("ProfileFieldSettings 的自定义字段隐藏开关（7-A）", () => {
  it("自定义字段可隐藏：写到 hidden 偏好并带 expected_revision", async () => {
    const { onChanged } = renderSettings();

    fireEvent.click(hideSwitch("Title"));

    await waitFor(() =>
      expect(api.patchFieldPreference).toHaveBeenCalledWith(PRIMARY_ID, {
        section_key: "custom:sec1",
        hidden: true,
        expected_revision: 3,
      }),
    );
    // 与默认字段走同一条写路径：写完必须让宿主重取资料（否则开关状态留在旧值）。
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("已隐藏的自定义字段显示「恢复显示」，点回来写 hidden=false", async () => {
    renderSettings(customSection([customField(PRIMARY_ID, "Title", { hidden: true })], PRIMARY_ID));

    const restore = within(fieldRow("Title")).getByRole("switch", {
      name: t("profileLibrary.fieldSettings.showAria", { label: "Title" }),
    });
    expect(restore).not.toBeChecked();

    fireEvent.click(restore);

    await waitFor(() =>
      expect(api.patchFieldPreference).toHaveBeenCalledWith(PRIMARY_ID, {
        section_key: "custom:sec1",
        hidden: false,
        expected_revision: 3,
      }),
    );
  });

  it("「仅素材」与「隐藏」是两颗独立开关，互不覆盖", () => {
    renderSettings();

    const switches = within(fieldRow("Title")).getAllByRole("switch");
    // 行内两颗：隐藏（行尾）+ 仅素材（位置控件组）。合并成一颗会让"不上纸面"与
    // "完全不参与"这两个不同承诺混为一谈。
    expect(switches).toHaveLength(2);
    expect(
      within(fieldRow("Title")).getByRole("switch", {
        name: t("structure.profile.materialOnlyToggle"),
      }),
    ).toBeInTheDocument();
    // 打开「仅素材」不会碰 hidden 偏好（那是字段定义列，走 updateField）。
    fireEvent.click(
      within(fieldRow("Title")).getByRole("switch", {
        name: t("structure.profile.materialOnlyToggle"),
      }),
    );
    expect(api.patchFieldPreference).not.toHaveBeenCalled();
  });

  it("自建板块的主文本字段带「主文本字段」标注，普通字段没有", () => {
    renderSettings(
      customSection(
        [customField(PRIMARY_ID, "Title"), customField(SECOND_ID, "Subtitle")],
        PRIMARY_ID,
      ),
    );

    const primaryRow = fieldRow("Title");
    const plainRow = fieldRow("Subtitle");

    expect(
      within(primaryRow).getByText(t("profileLibrary.fieldSettings.primaryTextField")),
    ).toBeInTheDocument();
    expect(
      within(plainRow).queryByText(t("profileLibrary.fieldSettings.primaryTextField")),
    ).toBeNull();
  });

  it("内置板块的 carrier_field_id 不是主文本字段，不标注", () => {
    // 内置板块的 carrier_field_id 指「标签：值」承载区，与主文本字段无关。
    const builtin = makeSection("projects", "Projects", "multi", [
      makeField("projects", "name", "Name", { field_id: "projects.name" }),
      makeField("projects", "description", "Description", {
        field_id: "projects.description",
        field_type: "multi_line",
      }),
    ]);
    renderSettings(builtin);

    expect(screen.queryByText(t("profileLibrary.fieldSettings.primaryTextField"))).toBeNull();
  });
});
