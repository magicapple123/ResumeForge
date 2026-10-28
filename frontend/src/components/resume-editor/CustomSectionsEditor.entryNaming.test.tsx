// SPDX-License-Identifier: Apache-2.0
/**
 * 用户反馈 #6（2026-10-28）：新建简历 / 制作台「自建板块」页签里的条目卡，标题改为
 * **当前顺序的纯序号 1/2/3**（此前没有标题，或按字段内容显示，与「我的资料」口径不一致）。
 *
 * 只钉显示层：序号现算、不落库；字段内容照常可编辑并原样保存。夹具用 ASCII
 * （测试数据不是产品文案，避免抬高 cjkRatchet 的 tests 计数）。
 */
import { App as AntdApp, Form } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { t } from "../../i18n";
import type { EditorSectionOut } from "../../features/profile-library/types";
import type { ResumeCustomSection } from "../../types";
import CustomSectionsEditor from "./CustomSectionsEditor";
import { EditorFieldProvider } from "./editorSchemaContext";

const OSS_KEY = "custom:oss";

const SCHEMA: EditorSectionOut = {
  section_key: OSS_KEY,
  section_name: "OSS",
  form: "multi",
  resume_field: "custom_sections",
  material_only: false,
  fields: [
    {
      field_id: "f.title",
      key: "title",
      label: "Title",
      field_type: "single_line",
      resume_attr: null,
    },
  ],
};

function sections(entries: { id: string; text: string }[]): ResumeCustomSection[] {
  return [
    {
      key: OSS_KEY,
      title: "OSS",
      entries: entries.map((entry) => ({ entry_id: entry.id, text: entry.text, lines: [] })),
    },
  ];
}

function renderEditor(initial: ResumeCustomSection[], withSchema = true) {
  const body = (
    <Form initialValues={{ custom_sections: initial }}>
      <CustomSectionsEditor />
    </Form>
  );
  return render(
    <AntdApp>
      {withSchema ? (
        <EditorFieldProvider schema={{ sections: [SCHEMA], workspace_revision: 1 }}>
          {body}
        </EditorFieldProvider>
      ) : (
        body
      )}
    </AntdApp>,
  );
}

/** 条目卡标题上的序号（新增的 data 钩子，与视觉标题同源）。 */
function entryIndexes(): string[] {
  return Array.from(document.querySelectorAll("[data-custom-entry-index]")).map(
    (node) => node.textContent ?? "",
  );
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("自建板块编辑器 · 条目卡标题 = 序号", () => {
  it("两张条目卡显示 1、2；改字段内容不影响序号", () => {
    renderEditor(
      sections([
        { id: "e1", text: "Alpha" },
        { id: "e2", text: "Beta" },
      ]),
    );
    expect(entryIndexes()).toEqual(["1", "2"]);

    const field = screen.getAllByLabelText("Title")[0];
    fireEvent.change(field, { target: { value: "France" } });
    expect((field as HTMLInputElement).value).toBe("France");
    expect(entryIndexes()).toEqual(["1", "2"]);
  });

  it("新增条目后序号连续（兜底路径同样编号）", () => {
    renderEditor(sections([{ id: "e1", text: "Alpha" }]), false);
    expect(entryIndexes()).toEqual(["1"]);

    // 图标 svg 的 role=img / aria-label 会进可访问名（"plus添加条目"），用正则匹配文字。
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(t("editor.custom-sections.add-entry")) }),
    );
    expect(entryIndexes()).toEqual(["1", "2"]);
  });
});
