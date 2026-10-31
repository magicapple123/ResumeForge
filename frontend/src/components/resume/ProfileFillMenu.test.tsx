// SPDX-License-Identifier: Apache-2.0
/** 「从资料填入」菜单（v2）：候选 → 单一 helper 合并、source 去重、selectedPath 失配禁用。 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import { makeEntry, makeResumeDocument } from "../../test/documentHarness";
import type { PaperProjectionOut } from "../../features/profile-library/types";
import type { ResumeDocument, ResumeEntry, ResumeItem } from "../../types/resumeDocument";
import ProfileFillMenu from "./ProfileFillMenu";

const api = vi.hoisted(() => ({ getCurrentProjection: vi.fn() }));
vi.mock("../../features/profile-library/api", () => api);

const SOURCE = { section_key: "educations", field_id: "educations.school" };
const SCHOOL: ResumeItem = {
  kind: "field",
  id: "it_school00001",
  key: "school",
  label: "",
  value: "示例大学",
  placement: "title",
  format: "text",
  wrap: "none",
  show_label: false,
  solo: false,
  source: SOURCE,
  body_style: "bullet",
};
const MAJOR: ResumeItem = {
  ...SCHOOL,
  id: "it_major00001",
  key: "major",
  value: "软件工程",
  source: { ...SOURCE, field_id: "educations.major" },
};
const EDU_ENTRY: ResumeEntry = makeEntry([SCHOOL, MAJOR], { id: "ob_edu000001" });
const PRJ_ENTRY: ResumeEntry = makeEntry(
  [
    {
      ...SCHOOL,
      id: "it_prjname0001",
      key: "name",
      value: "别的项目",
      source: { section_key: "projects", field_id: "projects.name" },
    },
  ],
  { id: "ob_prj000001" },
);

const WORKING: ResumeDocument = makeResumeDocument({
  sections: [
    {
      key: "education",
      title: "",
      kind: "entries",
      layout: {} as never,
      entries: [makeEntry([], { id: "ob_edu000001" })],
    },
  ],
});

function projection(): PaperProjectionOut {
  return {
    scope: {
      group_id: "g",
      group_name: "默认",
      is_default: true,
      participating_keys: ["educations", "projects"],
      section_order: ["education", "projects"],
      workspace_revision: 1,
    },
    content: {
      version: 2,
      language: "zh-CN",
      header: { items: [] },
      sections: [
        { key: "education", title: "", kind: "entries", layout: {} as never, entries: [EDU_ENTRY] },
        { key: "projects", title: "", kind: "entries", layout: {} as never, entries: [PRJ_ENTRY] },
      ],
    },
    candidates: [
      {
        section_key: "educations",
        section_name: "教育经历",
        entry_id: "e1",
        title: "示例大学",
        subtitle: "软件工程",
        document_path: "education.ob_edu000001",
        document_entry: EDU_ENTRY,
      },
      {
        section_key: "projects",
        section_name: "项目经历",
        entry_id: "e2",
        title: "别的项目",
        subtitle: "",
        document_path: "projects.ob_prj000001",
        document_entry: PRJ_ENTRY,
      },
    ],
    source_layout: [],
    warnings: [],
    snapshot_token: "t",
  } as unknown as PaperProjectionOut;
}

function setup(document: ResumeDocument = WORKING, selectedPath: string | null = null) {
  api.getCurrentProjection.mockResolvedValue(projection());
  const onChange = vi.fn();
  render(
    <AntdApp>
      <ProfileFillMenu document={document} onChange={onChange} selectedPath={selectedPath} />
    </AntdApp>,
  );
  fireEvent.click(screen.getByRole("button", { name: t("editor.profileFill.aria.entry") }));
  return { onChange };
}

afterEach(() => {
  cleanup();
  api.getCurrentProjection.mockReset();
});

describe("ProfileFillMenu", () => {
  it("选择同分区资料候选：按单一 helper 合并 v2 items 并带 source", async () => {
    const { onChange } = setup();
    fireEvent.click(await screen.findByText("示例大学 · 软件工程"));
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const items = (onChange.mock.calls[0][0] as ResumeDocument).sections[0].entries[0].items;
    const school = items.find((item) => item.kind === "field" && item.key === "school");
    expect(school && school.kind === "field" && school.placement).toBe("title");
    expect(school && school.kind === "field" && school.source?.field_id).toBe("educations.school");
  });

  it("同一 source 已在条目里：不重复灌入该字段，其余缺的字段照常补", async () => {
    const withSchool = makeResumeDocument({
      sections: [
        {
          key: "education",
          title: "",
          kind: "entries",
          layout: {} as never,
          entries: [makeEntry([SCHOOL], { id: "ob_edu000001" })],
        },
      ],
    });
    const { onChange } = setup(withSchool);
    fireEvent.click(await screen.findByText("示例大学 · 软件工程"));
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const items = (onChange.mock.calls[0][0] as ResumeDocument).sections[0].entries[0].items;
    const schools = items.filter(
      (item) => item.kind === "field" && item.source?.field_id === "educations.school",
    );
    expect(schools).toHaveLength(1);
    expect(items.length).toBeGreaterThan(1);
  });

  it("selectedPath 指向别的条目：跨分区候选禁用并给原因，点击不写入", async () => {
    const { onChange } = setup(WORKING, "education.ob_edu000001.it_school00001");
    await screen.findByText(/别的项目/);
    const disabledItem = screen.getByText(/别的项目/).closest('[role="menuitem"]');
    expect(disabledItem).toHaveAttribute("aria-disabled", "true");
    expect(disabledItem?.textContent).toContain(t("editor.profileFill.needTarget"));
    if (disabledItem) fireEvent.click(disabledItem);
    expect(onChange).not.toHaveBeenCalled();
  });
});
