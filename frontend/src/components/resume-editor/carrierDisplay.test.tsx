// SPDX-License-Identifier: Apache-2.0
/**
 * 任务 #8：承载区正文框不再混进该板块自定义字段的「标签：值」行。
 *
 * 数据形状与保存链零改动（行仍存在承载区里，纸面/导出照旧显示），只做显示过滤 +
 * 编辑时把隐藏行并回。覆盖：项目/教育/经历（列表承载区）、技能/荣誉（标量承载区）、
 * 科研论文/科研项目/证照（扩展板块）。
 *
 * 夹具标签用 ASCII，避免给 cjk 棘轮新增 ByText 断言。
 */
import { App as AntdApp } from "antd";
import { Form } from "antd";
import type { FormInstance } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProfileFillSources } from "../../features/profile/profileFillOptions";
import type { EditorSchemaOut } from "../../features/profile-library/types";
import type { ResumeContent } from "../../types";
import { rt } from "../../features/resume-research/i18n";
import { t } from "../../i18n";
import { editorField, editorSchema } from "../../test/editorSchemaFixture";
import ResumeEditorModal from "../ResumeEditorModal";
import { makeResumeContent } from "../ResumeEditorModal.testkit";
import CredentialsEditor from "../resume/CredentialsEditor";
import PublicationsEditor from "../resume/research/PublicationsEditor";
import ResearchProjectsEditor from "../resume/research/ResearchProjectsEditor";
import { ProjectEditor, SkillEditor } from "./ResumeSectionEditors";
import { carrierDisplayFor, mergeCarrierText, splitCarrierLines } from "./carrierDisplay";
import { EditorFieldProvider } from "./editorSchemaContext";

const LABEL = "mentor";

function schemaFor(
  resumeField: string,
  sectionKey: string,
  carrierAttr: string,
  carrierList: boolean,
): EditorSchemaOut {
  return editorSchema({
    section_key: sectionKey,
    section_name: sectionKey,
    form: "multi",
    resume_field: resumeField,
    material_only: false,
    carrier_attr: carrierAttr,
    carrier_list: carrierList,
    fields: [editorField("name", "name"), editorField(LABEL, null)],
  });
}

const PROJECT_SCHEMA = schemaFor("projects", "projects", "description", true);
const SKILL_SCHEMA = schemaFor("skills", "skills", "level", false);
const PUBLICATION_SCHEMA = schemaFor("publications", "publications", "note", false);
const RESEARCH_PROJECT_SCHEMA = schemaFor(
  "research_projects",
  "research_projects",
  "description",
  true,
);
const CREDENTIAL_SCHEMA = schemaFor("credentials", "credentials", "note", false);

function Harness<T extends object>({
  schema,
  initialValues,
  onForm,
  children,
}: {
  schema: EditorSchemaOut | undefined;
  initialValues: T;
  onForm: (form: FormInstance) => void;
  children: React.ReactNode;
}) {
  const [form] = Form.useForm();
  onForm(form);
  return (
    <Form form={form} initialValues={initialValues as never}>
      <EditorFieldProvider schema={schema}>{children}</EditorFieldProvider>
    </Form>
  );
}

function renderEditor<T extends object>(
  schema: EditorSchemaOut | undefined,
  initialValues: T,
  children: React.ReactNode,
) {
  const holder: { form: FormInstance | null } = { form: null };
  render(
    <Harness
      schema={schema}
      initialValues={initialValues}
      onForm={(form) => (holder.form = form)}
      children={children}
    />,
  );
  return () => holder.form;
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("carrierDisplay（纯函数）", () => {
  it("按标签拆出隐藏行；相邻前缀标签不误命中", () => {
    const { visible, extras } = splitCarrierLines(
      ["正文一", `${LABEL}：张三`, "正文二", "mentor_other：x"],
      [LABEL],
    );
    expect(visible).toEqual(["正文一", "正文二", "mentor_other：x"]);
    expect(extras).toEqual([`${LABEL}：张三`]);
  });

  it("编辑正文：用户行替换 + 隐藏行原顺序并回", () => {
    const second = "supervisor";
    expect(
      mergeCarrierText(
        [`${LABEL}：张三`, "正文", `${second}：李四`],
        "新正文",
        [LABEL, second],
        true,
      ),
    ).toEqual(["新正文", `${LABEL}：张三`, `${second}：李四`]);
  });

  it("历史数据里同标签重复行：编辑后合并成一行", () => {
    expect(
      mergeCarrierText([`${LABEL}：张三`, "正文", `${LABEL}：李四`], "新正文", [LABEL], true),
    ).toEqual(["新正文", `${LABEL}：张三`]);
  });

  it("正文里手打的同标签行归并进隐藏行：同一标签只有一行", () => {
    expect(mergeCarrierText([`${LABEL}：张三`], `正文\n${LABEL}：王五`, [LABEL], true)).toEqual([
      "正文",
      `${LABEL}：王五`,
    ]);
  });

  it("没有 schema / 没有自定义字段 / 没有承载区 → 不做过滤", () => {
    expect(carrierDisplayFor([], "projects")).toBeNull();
    expect(
      carrierDisplayFor(
        [
          {
            section_key: "projects",
            section_name: "projects",
            form: "multi",
            resume_field: "projects",
            material_only: false,
            carrier_attr: "description",
            carrier_list: true,
            fields: [editorField("name", "name")],
          },
        ],
        "projects",
      ),
    ).toBeNull();
  });
});

describe("承载区正文框与自定义字段行分离（项目）", () => {
  const content: ResumeContent = makeResumeContent({
    projects: [
      {
        name: "P",
        role: "",
        start_date: "",
        end_date: "",
        tech_stack: [],
        description: ["Project body", `${LABEL}：Zhang`],
        highlights: [],
      },
    ],
  });

  it("描述框只显示用户手写行，自定义字段输入框仍显示值", () => {
    renderEditor(PROJECT_SCHEMA, content, <ProjectEditor />);
    const description = screen.getByLabelText(t("editor.field.projectDescription"));
    expect((description as HTMLTextAreaElement).value).toBe("Project body");
    expect((screen.getByRole("textbox", { name: LABEL }) as HTMLInputElement).value).toBe("Zhang");
  });

  it("编辑描述并保存口径：隐藏行原样保留，且不会被丢掉", () => {
    const formOf = renderEditor(PROJECT_SCHEMA, content, <ProjectEditor />);
    fireEvent.change(screen.getByLabelText(t("editor.field.projectDescription")), {
      target: { value: "Edited body\nSecond line" },
    });
    const form = formOf();
    expect(form?.getFieldValue(["projects", 0, "description"])).toEqual([
      "Edited body",
      "Second line",
      `${LABEL}：Zhang`,
    ]);
  });

  it("空 carrier（没有自定义字段行）时行为逐字不变", () => {
    const plain = makeResumeContent({
      projects: [
        {
          name: "P",
          role: "",
          start_date: "",
          end_date: "",
          tech_stack: [],
          description: ["Project body"],
          highlights: [],
        },
      ],
    });
    const formOf = renderEditor(PROJECT_SCHEMA, plain, <ProjectEditor />);
    const description = screen.getByLabelText(t("editor.field.projectDescription"));
    expect((description as HTMLTextAreaElement).value).toBe("Project body");
    fireEvent.change(description, { target: { value: "Edited" } });
    expect(formOf()?.getFieldValue(["projects", 0, "description"])).toEqual(["Edited"]);
  });

  it("没有方案视图（旧简历）时描述框照旧显示全部行", () => {
    renderEditor(undefined, content, <ProjectEditor />);
    const description = screen.getByLabelText(t("editor.field.projectDescription"));
    expect((description as HTMLTextAreaElement).value).toBe(`Project body\n${LABEL}：Zhang`);
  });
});

describe("标量承载区（技能 level）", () => {
  it("level 输入框只显示用户值，自定义字段行隐藏", () => {
    const content = makeResumeContent({
      skills: [{ name: "React", level: `熟练\n${LABEL}：A`, category: "" }],
    });
    const formOf = renderEditor(SKILL_SCHEMA, content, <SkillEditor />);
    const level = screen.getByLabelText(t("editor.field.skillLevel"));
    expect((level as HTMLInputElement).value).toBe("熟练");
    fireEvent.change(level, { target: { value: "精通" } });
    expect(formOf()?.getFieldValue(["skills", 0, "level"])).toBe(`精通\n${LABEL}：A`);
  });
});

describe("扩展板块（科研论文 / 科研项目 / 证照）", () => {
  it("论文 note 承载区隐藏自定义字段行", () => {
    const content = makeResumeContent({
      publications: [
        {
          title: "T",
          authors: [],
          venue: "",
          year: "",
          status: "published",
          doi: "",
          url: "",
          volume_pages: "",
          note: `备注\n${LABEL}：X`,
        },
      ],
    } as Partial<ResumeContent>);
    renderEditor(PUBLICATION_SCHEMA, content, <PublicationsEditor />);
    const note = screen.getByLabelText(rt("research.publications.note"));
    expect((note as HTMLTextAreaElement).value).toBe("备注");
  });

  it("科研项目 description 承载区隐藏自定义字段行", () => {
    const content = makeResumeContent({
      research_projects: [
        {
          name: "R",
          role: "",
          organization: "",
          start_date: "",
          end_date: "",
          funding: "",
          description: ["正文", `${LABEL}：Y`],
          outcomes: [],
        },
      ],
    } as Partial<ResumeContent>);
    renderEditor(RESEARCH_PROJECT_SCHEMA, content, <ResearchProjectsEditor />);
    const description = screen.getByLabelText(rt("research.projects.description"));
    expect((description as HTMLTextAreaElement).value).toBe("正文");
  });

  it("证照 note 承载区隐藏自定义字段行", () => {
    const content = makeResumeContent({
      credentials: [
        {
          name: "C",
          issuer: "",
          issue_date: "",
          expiry_date: "",
          status: "unknown",
          verify_url: "",
          note: `备注\n${LABEL}：Z`,
        },
      ],
    } as Partial<ResumeContent>);
    renderEditor(CREDENTIAL_SCHEMA, content, <CredentialsEditor />);
    const note = screen.getByLabelText(t("credentials.credential.note"));
    expect((note as HTMLTextAreaElement).value).toBe("备注");
  });
});

const PROJECT_FILL: ProfileFillSources = {
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

function contentWithCarrier(): ResumeContent {
  return makeResumeContent({
    projects: [
      {
        name: "P",
        role: "",
        start_date: "",
        end_date: "",
        tech_stack: [],
        description: ["Project body", `${LABEL}：Zhang`],
        highlights: [],
      },
    ],
  });
}

describe("编辑器整链路：描述框与 carrier 行（任务 #8 验收）", () => {
  it("描述框隐藏自定义行；改描述保存后 carrier 行仍在且只有一行；再保存不重复", async () => {
    const onSave = vi.fn<(content: ResumeContent) => Promise<void>>(async () => undefined);
    render(
      <AntdApp>
        <ResumeEditorModal
          open
          content={contentWithCarrier()}
          onClose={vi.fn()}
          onSave={onSave}
          fillSources={PROJECT_FILL}
        />
      </AntdApp>,
    );
    fireEvent.click(await screen.findByRole("tab", { name: t("editor.tab.projects") }));
    const panel = await screen.findByRole("tabpanel");
    const description = within(panel).getByLabelText(t("editor.field.projectDescription"));
    expect((description as HTMLTextAreaElement).value).toBe("Project body");

    fireEvent.change(description, { target: { value: "Edited body" } });
    fireEvent.click(screen.getByRole("button", { name: /保存并更新预览/ }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = onSave.mock.calls[0][0] as ResumeContent;
    expect(saved.projects?.[0].description).toEqual(["Edited body", `${LABEL}：Zhang`]);

    fireEvent.click(screen.getByRole("button", { name: /保存并更新预览/ }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    const again = onSave.mock.calls[1][0] as ResumeContent;
    expect(
      (again.projects?.[0].description ?? []).filter((line) => line.startsWith(`${LABEL}：`)),
    ).toHaveLength(1);
  });
});
