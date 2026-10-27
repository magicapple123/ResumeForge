// SPDX-License-Identifier: Apache-2.0
/**
 * 系统板块自定义字段输入框（需求 #5）：值直接读写承载区（description / achievements / …）
 * 的「标签：值」行——不新增 ResumeContent 字段、不重复追加。
 *
 * 夹具里的标签用 ASCII（mentor / grade），避免给 cjk 棘轮新增断言文案。
 */
import { Form } from "antd";
import type { FormInstance } from "antd";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { EditorSchemaOut } from "../../features/profile-library/types";
import { editorField, editorSchema } from "../../test/editorSchemaFixture";
import { ProjectEditor } from "./ResumeSectionEditors";
import { EditorFieldProvider } from "./editorSchemaContext";

const APPENDED_LABEL = "mentor";

/** 项目分区的编辑器视图：系统字段 name + 一个没有独立槽位的自定义字段。 */
const PROJECT_SCHEMA: EditorSchemaOut = editorSchema({
  section_key: "projects",
  section_name: "Projects",
  form: "multi",
  resume_field: "projects",
  material_only: false,
  carrier_attr: "description",
  carrier_list: true,
  fields: [editorField("name", "name"), editorField(APPENDED_LABEL, null)],
});

function projectContent(description: string[]) {
  return [
    {
      name: "P",
      role: "",
      start_date: "",
      end_date: "",
      tech_stack: [],
      description,
      highlights: [],
    },
  ];
}

function Harness({
  schema,
  onForm,
  description,
}: {
  schema: EditorSchemaOut | undefined;
  onForm: (form: FormInstance) => void;
  description: string[];
}) {
  const [form] = Form.useForm();
  onForm(form);
  return (
    <Form form={form} initialValues={{ projects: projectContent(description) }}>
      <EditorFieldProvider schema={schema}>
        <ProjectEditor />
      </EditorFieldProvider>
    </Form>
  );
}

function renderProject(schema: EditorSchemaOut | undefined, description: string[]) {
  const holder: { form: FormInstance | null } = { form: null };
  render(
    <Harness schema={schema} onForm={(form) => (holder.form = form)} description={description} />,
  );
  return () => (holder.form?.getFieldValue(["projects", 0, "description"]) ?? []) as string[];
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("系统板块自定义字段（需求 #5）", () => {
  it("渲染输入框，值从承载区的「标签：值」行里取", () => {
    renderProject(PROJECT_SCHEMA, ["Project body", `${APPENDED_LABEL}：Zhang`]);
    const input = screen.getByRole("textbox", { name: APPENDED_LABEL });
    expect(input.tagName).toBe("INPUT");
    expect((input as HTMLInputElement).value).toBe("Zhang");
  });

  it("改值写回承载区同一行（不新增字段、不重复追加）", () => {
    const description = renderProject(PROJECT_SCHEMA, ["Project body", `${APPENDED_LABEL}：Zhang`]);
    fireEvent.change(screen.getByRole("textbox", { name: APPENDED_LABEL }), {
      target: { value: "Li" },
    });
    expect(description()).toEqual(["Project body", `${APPENDED_LABEL}：Li`]);
    // 再改一次仍然只有一行。
    fireEvent.change(screen.getByRole("textbox", { name: APPENDED_LABEL }), {
      target: { value: "Wang" },
    });
    expect(description().filter((line) => line.startsWith(`${APPENDED_LABEL}：`))).toHaveLength(1);
  });

  it("清空输入框 = 移除该行（与纸面投影只追加有值字段一致）", () => {
    const description = renderProject(PROJECT_SCHEMA, ["Project body", `${APPENDED_LABEL}：Zhang`]);
    fireEvent.change(screen.getByRole("textbox", { name: APPENDED_LABEL }), {
      target: { value: "" },
    });
    expect(description()).toEqual(["Project body"]);
  });

  it("没有该行时追加到承载区末尾", () => {
    const description = renderProject(PROJECT_SCHEMA, ["Project body"]);
    fireEvent.change(screen.getByRole("textbox", { name: APPENDED_LABEL }), {
      target: { value: "Zhang" },
    });
    expect(description()).toEqual(["Project body", `${APPENDED_LABEL}：Zhang`]);
  });

  it("旧简历的编辑器视图没有承载区元数据：不渲染这些输入框（旧行为不变）", () => {
    const legacySchema = editorSchema({
      section_key: "projects",
      section_name: "Projects",
      form: "multi",
      resume_field: "projects",
      material_only: false,
      fields: [editorField("name", "name"), editorField(APPENDED_LABEL, null)],
    });
    renderProject(legacySchema, ["Project body"]);
    expect(screen.queryByRole("textbox", { name: APPENDED_LABEL })).not.toBeInTheDocument();
  });
});
