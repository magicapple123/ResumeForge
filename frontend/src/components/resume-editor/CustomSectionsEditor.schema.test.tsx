// SPDX-License-Identifier: Apache-2.0
/**
 * 自建板块的**字段结构化编辑**（第 8 项，2026-10-27）。
 *
 * 用户口径：「新建简历界面的自定义板块，内容结构要跟其他系统自带板块一样」——自建板块
 * 在正文里的形状是 `{ text, lines }`（一个字段进 text，其余按定义顺序进「标签：值」行），
 * 所以有字段定义时必须渲染成**固定字段表单**，而不是"一个大 textarea + 自由标签行"。
 *
 * 五条性质，对应五类事故：
 * 1. 定义字段各有一个输入框，label 就是定义 label（不是 Label/Value 两栏）；
 * 2. 主文本字段写 `text`（服务端 `custom_section_text_field` 的同一个判定）；
 * 3. 其余字段写 `lines[j].value`，且 `label` 被钉成定义 label（否则保存后串列）；
 * 4. 定义之外的历史行一条都不丢、仍可编辑（字段被删 / 用户手加的行）；
 * 5. 没有定义时（旧快照 / 板块已删）回到原来的通用编辑器。
 *
 * 字段 label 一律用 ASCII：这些是夹具、不是产品文案，避免抬高 cjk 棘轮。
 */
import { App as AntdApp, Form } from "antd";
import type { FormInstance } from "antd";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { EditorFieldOut, EditorSectionOut } from "../../features/profile-library/types";
import type { ResumeCustomSection } from "../../types";
import { t } from "../../i18n";
import CustomSectionsEditor from "./CustomSectionsEditor";
import { EditorFieldProvider } from "./editorSchemaContext";

const FIELDS: EditorFieldOut[] = [
  {
    field_id: "f.gist",
    key: "gist",
    label: "Gist",
    field_type: "multi_line",
    resume_attr: null,
    primary: true,
  },
  { field_id: "f.role", key: "role", label: "Role", field_type: "single_line", resume_attr: null },
  { field_id: "f.link", key: "link", label: "Link", field_type: "single_line", resume_attr: null },
];

const SECTION: EditorSectionOut = {
  section_key: "custom:oss",
  section_name: "OSS",
  form: "multi",
  resume_field: "custom_sections",
  material_only: false,
  fields: FIELDS,
};

function sectionWith(lines: { label: string; value: string }[]): ResumeCustomSection[] {
  return [{ key: "custom:oss", title: "OSS", entries: [{ entry_id: "e1", text: "old", lines }] }];
}

interface Handle {
  form: FormInstance | null;
}

function Harness({
  handle,
  initial,
  section,
}: {
  handle: Handle;
  initial: ResumeCustomSection[];
  section?: EditorSectionOut | null;
}) {
  const [form] = Form.useForm();
  // 测试探针：把 form 实例交给用例同步读取（断言用 `handle.form.getFieldValue`）。
  // 它不参与渲染，也不是给组件用的 props，因此就地豁免 immutability 规则。
  // eslint-disable-next-line react-hooks/immutability
  handle.form = form;
  const body = (
    <Form form={form} initialValues={{ custom_sections: initial }}>
      <CustomSectionsEditor />
    </Form>
  );
  return (
    <AntdApp>
      {section ? (
        <EditorFieldProvider schema={{ sections: [section], workspace_revision: 1 }}>
          {body}
        </EditorFieldProvider>
      ) : (
        body
      )}
    </AntdApp>
  );
}

function renderEditor(initial: ResumeCustomSection[], section: EditorSectionOut | null = SECTION) {
  const handle: Handle = { form: null };
  render(<Harness handle={handle} initial={initial} section={section} />);
  return handle;
}

function linesOf(handle: Handle, entryIndex = 0) {
  const value = handle.form?.getFieldValue(["custom_sections", 0, "entries", entryIndex, "lines"]);
  return (value ?? []) as { label: string; value: string }[];
}

function textOf(handle: Handle, entryIndex = 0) {
  return handle.form?.getFieldValue([
    "custom_sections",
    0,
    "entries",
    entryIndex,
    "text",
  ]) as string;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("CustomSectionsEditor · 有字段定义", () => {
  it("按定义渲染固定字段：label 是定义 label，多行字段是 textarea", async () => {
    const handle = renderEditor(sectionWith([{ label: "Role", value: "maintainer" }]));

    // 主文本字段（multi_line）→ textarea；两个单行字段 → 普通 input。
    expect(screen.getByLabelText("Gist").tagName).toBe("TEXTAREA");
    expect(screen.getByLabelText("Role").tagName).toBe("INPUT");
    expect(screen.getByLabelText("Link").tagName).toBe("INPUT");
    // 不再是"标签 / 值"两栏的自由行。
    expect(screen.queryAllByLabelText(t("editor.custom-sections.label"))).toHaveLength(0);
    expect(screen.queryByLabelText(t("editor.custom-sections.text"))).not.toBeInTheDocument();
    // 对齐把缺失字段补齐（Role 沿用旧值，Link 补空行）。
    await waitFor(() =>
      expect(linesOf(handle)).toEqual([
        { label: "Role", value: "maintainer" },
        { label: "Link", value: "" },
      ]),
    );
  });

  it("主文本字段写进 text", async () => {
    const handle = renderEditor(sectionWith([{ label: "Role", value: "maintainer" }]));
    fireEvent.change(screen.getByLabelText("Gist"), { target: { value: "typed gist" } });
    await waitFor(() => expect(textOf(handle)).toBe("typed gist"));
  });

  it("其余字段写进 lines[j].value，label 钉成定义 label", async () => {
    const handle = renderEditor(sectionWith([]));
    await waitFor(() => expect(linesOf(handle)).toHaveLength(2));

    fireEvent.change(screen.getByLabelText("Link"), { target: { value: "https://x.dev" } });
    await waitFor(() =>
      expect(linesOf(handle)).toEqual([
        { label: "Role", value: "" },
        { label: "Link", value: "https://x.dev" },
      ]),
    );
  });

  it("定义之外的历史行原样保留、仍可编辑", async () => {
    const handle = renderEditor(
      sectionWith([
        { label: "Role", value: "maintainer" },
        { label: "Legacy", value: "keep me" },
      ]),
    );
    // 未知 label 排在定义字段之后，值一个字都不动。
    await waitFor(() =>
      expect(linesOf(handle)).toEqual([
        { label: "Role", value: "maintainer" },
        { label: "Link", value: "" },
        { label: "Legacy", value: "keep me" },
      ]),
    );
    const legacyLabels = screen.getAllByLabelText(t("editor.custom-sections.label"));
    expect(legacyLabels).toHaveLength(1);
    fireEvent.change(legacyLabels[0], { target: { value: "Legacy2" } });
    await waitFor(() => expect(linesOf(handle)[2].label).toBe("Legacy2"));
    // 值输入框也能改：历史行不是只读的。
    const legacyValues = screen.getAllByLabelText(t("editor.custom-sections.value"));
    fireEvent.change(legacyValues[0], { target: { value: "edited" } });
    await waitFor(() => expect(linesOf(handle)[2].value).toBe("edited"));
  });

  it("对齐是幂等的：再挂载一次不再补行、不重排", async () => {
    const initial = sectionWith([
      { label: "Role", value: "maintainer" },
      { label: "Link", value: "https://x.dev" },
    ]);
    const handle = renderEditor(initial);
    await waitFor(() => expect(linesOf(handle)).toEqual(initial[0].entries[0].lines));
  });
});

describe("CustomSectionsEditor · 没有字段定义", () => {
  it("回到通用编辑器：一个主 textarea + 可增删的标签行", async () => {
    const handle = renderEditor(
      [
        {
          key: "custom:ghost",
          title: "Ghost",
          entries: [{ entry_id: "e1", text: "hi", lines: [] }],
        },
      ],
      null,
    );
    expect(screen.getByLabelText(t("editor.custom-sections.text")).tagName).toBe("TEXTAREA");
    // 没有定义就不补行、不重排。
    expect(linesOf(handle)).toEqual([]);
    fireEvent.change(screen.getByLabelText(t("editor.custom-sections.text")), {
      target: { value: "edited" },
    });
    await waitFor(() => expect(textOf(handle)).toBe("edited"));
  });
});
