// SPDX-License-Identifier: Apache-2.0
/**
 * 需求 #5 回归（新建简历 / 编辑器）：系统板块（这里用项目经历）的自定义字段必须有输入框，
 * 保存后值进入纸面承载区（`projects[i].description` 的「标签：值」行），再次保存不重复。
 *
 * 数据链路：后端 `editor_schema` 给出自定义字段（`resume_attr = null`）与板块承载区元数据
 * （`carrier_attr` / `carrier_list`）→ `AppendedCarrierFields` 把输入框直接绑到承载区同一路径。
 * 因此"保存两次"与"不改动直接保存"都必须只有一行。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorSchemaOut } from "../features/profile-library/types";
import type { ProfileFillSources } from "../features/profile/profileFillOptions";
import { t } from "../i18n";
import type { ResumeContent } from "../types";
import ResumeEditorModal from "./ResumeEditorModal";
import { makeResumeContent } from "./ResumeEditorModal.testkit";

/** 夹具标签用 ASCII：测试里的断言文案不该给 cjk 棘轮添新条目。 */
const APPENDED_LABEL = "mentor";
const SAVE_BUTTON = /保存并更新预览/;

const PROJECT_SCHEMA: EditorSchemaOut = {
  sections: [
    {
      section_key: "projects",
      section_name: "Projects",
      form: "multi",
      resume_field: "projects",
      material_only: false,
      carrier_attr: "description",
      carrier_list: true,
      fields: [
        {
          field_id: "projects.name",
          key: "name",
          label: "name",
          field_type: "single_line",
          resume_attr: "name",
        },
        {
          field_id: "projects.custom.mentor",
          key: "mentor",
          label: APPENDED_LABEL,
          field_type: "single_line",
          resume_attr: null,
        },
      ],
    },
  ],
  workspace_revision: 1,
};

const FILL_SOURCES: ProfileFillSources = {
  education: [],
  experience: [],
  campusExperience: [],
  projects: [],
  skills: [],
  awards: [],
  summary: "",
  editorView: {
    sections: [
      { key: "basic_info", name: "Basic Info" },
      { key: "projects", name: "Projects" },
    ],
    schema: PROJECT_SCHEMA,
  },
};

function contentWithProject(): ResumeContent {
  return makeResumeContent({
    projects: [
      {
        name: "P",
        role: "",
        start_date: "",
        end_date: "",
        tech_stack: [],
        description: ["Project body", `${APPENDED_LABEL}：Zhang`],
        highlights: [],
      },
    ],
  });
}

async function openProjectsTab() {
  fireEvent.click(await screen.findByRole("tab", { name: t("editor.tab.projects") }));
  return screen.findByRole("tabpanel");
}

function renderEditor(onSave: (content: ResumeContent) => Promise<void>) {
  render(
    <AntdApp>
      <ResumeEditorModal
        open
        content={contentWithProject()}
        onClose={vi.fn()}
        onSave={onSave}
        fillSources={FILL_SOURCES}
      />
    </AntdApp>,
  );
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("项目经历自定义字段（需求 #5）", () => {
  it("渲染输入框；保存后值进承载区，再次保存仍只有一行", async () => {
    const onSave = vi.fn<(content: ResumeContent) => Promise<void>>(async () => undefined);
    renderEditor(onSave);
    const panel = await openProjectsTab();
    const input = within(panel).getByRole("textbox", { name: APPENDED_LABEL });
    expect(input.tagName).toBe("INPUT");
    expect((input as HTMLInputElement).value).toBe("Zhang");

    fireEvent.change(input, { target: { value: "Li" } });
    fireEvent.click(screen.getByRole("button", { name: SAVE_BUTTON }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = onSave.mock.calls[0][0] as ResumeContent;
    expect(saved.projects?.[0].description).toEqual(["Project body", `${APPENDED_LABEL}：Li`]);

    // 第二次保存：同一个标签行还是一条（不是"每保存一次追加一行"）。
    fireEvent.click(screen.getByRole("button", { name: SAVE_BUTTON }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    const again = onSave.mock.calls[1][0] as ResumeContent;
    const lines = (again.projects?.[0].description ?? []).filter((line) =>
      line.startsWith(`${APPENDED_LABEL}：`),
    );
    expect(lines).toEqual([`${APPENDED_LABEL}：Li`]);
  });

  it("不改动直接保存：承载区原样保留（不重复追加）", async () => {
    const onSave = vi.fn<(content: ResumeContent) => Promise<void>>(async () => undefined);
    renderEditor(onSave);
    await openProjectsTab();
    fireEvent.click(screen.getByRole("button", { name: SAVE_BUTTON }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = onSave.mock.calls[0][0] as ResumeContent;
    expect(saved.projects?.[0].description).toEqual(["Project body", `${APPENDED_LABEL}：Zhang`]);
  });
});
