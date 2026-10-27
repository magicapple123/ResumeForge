// SPDX-License-Identifier: Apache-2.0
/**
 * F10：编辑器按「当前方案 / 创建时冻结的视图」隐藏字段（editorSchemaContext）。
 *
 * 三条性质：
 * 1. 不在可见字段里的输入框 display:none，但字段仍注册在表单里（值不丢）；
 * 2. 正文里已有值的字段即使方案里隐藏也显示（一次保存不会把它抹掉）；
 * 3. 没有 schema（旧简历/旧快照）时全部照旧显示。
 *
 * 另外钉住自建板块：方案里有、正文里还没有的自建板块要显示板块名与「添加条目」入口。
 */
import { Form } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { t } from "../../i18n";
import type { EditorSchemaOut } from "../../features/profile-library/types";
import type { ResumeContent, ResumeCustomSection } from "../../types";
import { editorSchema, editorSection } from "../../test/editorSchemaFixture";
import { makeResumeContent } from "../ResumeEditorModal.testkit";
import { EditorFieldProvider } from "./editorSchemaContext";
import CustomSectionsEditor from "./CustomSectionsEditor";
import { EducationEditor } from "./ResumeSectionEditors";

afterEach(cleanup);

const EDUCATION = makeResumeContent({
  education: [
    {
      school: "Example University",
      major: "CS",
      degree: "Bachelor",
      start_date: "2023.09",
      end_date: "2027.06",
      gpa: "3.8",
      courses: [],
      achievements: [],
    },
  ],
});

/** 方案里可见的字段：故意不含 research_direction / courses / achievements。 */
const VISIBLE_ATTRS = [
  "school",
  "major",
  "degree",
  "start_date",
  "end_date",
  "gpa",
  "study_form",
  "degree_type",
  "department",
  "rank",
  "advisor",
];

function educationSchema(): EditorSchemaOut {
  return editorSchema(
    editorSection("basic_info", "basic", ["name"], { form: "singleton", resume_field: null }),
    editorSection("educations", "edu", VISIBLE_ATTRS, { resume_field: "education" }),
  );
}

function renderEducation(schema: EditorSchemaOut | undefined, content: ResumeContent | null) {
  return render(
    <Form initialValues={content ?? undefined}>
      <EditorFieldProvider schema={schema} content={content}>
        <EducationEditor />
      </EditorFieldProvider>
    </Form>,
  );
}

/**
 * 这个输入框是不是被藏起来了：往上找有没有 display:none 的祖先。
 *
 * 不能只查 closest(".ant-col")：Form.Item 自己的 label / control 也是 .ant-col，
 * 最先命中的是内层，永远量不到外层栅格列。
 */
function isHidden(id: string): boolean {
  for (let node = document.getElementById(id); node; node = node.parentElement) {
    if ((node as HTMLElement).style?.display === "none") return true;
  }
  return false;
}

describe("编辑器字段可见性（F10）", () => {
  it("方案里看不见的字段隐藏，但仍在表单里注册（值不丢）", () => {
    renderEducation(educationSchema(), EDUCATION);
    expect(document.getElementById("education_0_research_direction")).not.toBeNull();
    expect(isHidden("education_0_research_direction")).toBe(true);
    expect(isHidden("education_0_study_form")).toBe(false);
  });

  it("正文里已有值的隐藏字段仍然显示（一次保存不会把它抹掉）", () => {
    const content = makeResumeContent({
      education: [{ ...EDUCATION.education[0], research_direction: "NLP" }],
    });
    renderEducation(educationSchema(), content);
    expect(isHidden("education_0_research_direction")).toBe(false);
  });

  it("没有 schema（旧简历/旧快照）时全部字段照旧显示", () => {
    renderEducation(undefined, EDUCATION);
    expect(isHidden("education_0_research_direction")).toBe(false);
  });
});
function CustomHarness({
  schema,
  initialSections = [],
}: {
  schema: EditorSchemaOut;
  initialSections?: ResumeCustomSection[];
}) {
  const [form] = Form.useForm();
  return (
    <Form form={form} initialValues={{ custom_sections: initialSections }}>
      <EditorFieldProvider schema={schema} content={null}>
        <CustomSectionsEditor />
      </EditorFieldProvider>
    </Form>
  );
}

describe("自建板块（F10）", () => {
  const schema = editorSchema(
    editorSection("custom:22333", "22333", [], { resume_field: "custom_sections" }),
  );

  it("方案里有、正文里还没有的自建板块：显示板块名与添加条目入口", () => {
    render(<CustomHarness schema={schema} />);
    expect(screen.getByText("22333")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("custom:22333")).toBeNull();
  });

  it("正文里已有该自建板块时不再渲染同名骨架（首帧也不重复）：板块名只读出现一次", () => {
    render(
      <CustomHarness
        schema={schema}
        initialSections={[
          {
            key: "custom:22333",
            title: "22333",
            entries: [{ entry_id: "e1", text: "entry", lines: [] }],
          },
        ]}
      />,
    );
    // 有正文时渲染的是板块卡片本身；板块名来自方案、只读展示，恰好出现一次（不重复骨架）。
    expect(screen.getAllByText("22333")).toHaveLength(1);
    // 需求 #2：没有「自建板块」泛称输入框。
    expect(screen.queryByLabelText(t("editor.tab.custom-sections"))).not.toBeInTheDocument();
  });

  it("点「添加条目」把该板块写进表单（稳定 key + 标题用方案里的名字）", () => {
    render(<CustomHarness schema={schema} />);
    const button = screen.getByText(t("editor.custom-sections.add-entry")).closest("button");
    expect(button).not.toBeNull();
    fireEvent.click(button as HTMLButtonElement);
    expect(screen.getByDisplayValue("custom:22333")).toBeInTheDocument();
    expect(screen.getByDisplayValue("22333")).toBeInTheDocument();
  });
});
