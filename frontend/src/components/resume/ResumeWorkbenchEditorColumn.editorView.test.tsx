// SPDX-License-Identifier: Apache-2.0
/** F10：制作台中栏的页签按「冻结的编辑器视图」渲染（自建板块显示用户起的名字）。 */
import { App as AntdApp } from "antd";
import { render, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ProfileFillSources } from "../../features/profile/profileFillOptions";
import { t } from "../../i18n";
import type { ResumeContent } from "../../types";
import { editorSchema, editorSection } from "../../test/editorSchemaFixture";
import ResumeWorkbenchEditorColumn from "./ResumeWorkbenchEditorColumn";

const CONTENT: ResumeContent = {
  photo: "",
  name: "A",
  gender: "",
  birth_year: "",
  phone: "",
  email: "",
  city: "",
  personal_website: "",
  github: "",
  job_intent: "",
  summary: "",
  education: [],
  experience: [],
  campus_experience: [],
  projects: [],
  skills: [],
  awards: [],
};

const SOURCES: ProfileFillSources = {
  education: [],
  experience: [],
  campusExperience: [],
  projects: [],
  skills: [],
  awards: [],
  summary: "",
  editorView: {
    sections: [
      { key: "basic_info", name: "basic" },
      { key: "custom:22333", name: "22333" },
    ],
    schema: editorSchema(
      editorSection("basic_info", "basic", ["name"], {
        form: "singleton",
        resume_field: null,
      }),
      editorSection("custom:22333", "22333", [], { resume_field: "custom_sections" }),
    ),
  },
};

describe("制作台中栏 · 冻结编辑器视图（F10）", () => {
  it("页签只出现视图里的板块；自建板块页签显示用户起的名字", () => {
    render(
      <AntdApp>
        <ResumeWorkbenchEditorColumn
          active
          content={CONTENT}
          resumeId={42}
          onSave={vi.fn(async () => undefined)}
          fillSources={SOURCES}
        />
      </AntdApp>,
    );
    const strip = document.querySelector<HTMLElement>(".resume-wb-tabstrip");
    expect(strip).not.toBeNull();
    const labels = within(strip as HTMLElement)
      .getAllByRole("tab")
      .map((tab) => tab.textContent);
    expect(labels).toEqual([t("editor.tab.basic"), "22333"]);
  });
});
