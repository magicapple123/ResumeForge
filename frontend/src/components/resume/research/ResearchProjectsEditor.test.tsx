// SPDX-License-Identifier: Apache-2.0
/** 「科研项目」编辑页（W14）：空值形状、多行文本 ↔ 数组、上下移改的是表单值。 */
import { App as AntdApp, Form } from "antd";
import type { FormInstance } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { rt } from "../../../features/resume-research/i18n";
import ResearchProjectsEditor from "./ResearchProjectsEditor";

function setup() {
  // 表单实例在 effect 里捕获：渲染期给外部变量赋值是副作用（react-hooks/globals 会红）。
  const instance: { current: FormInstance | null } = { current: null };
  function Harness() {
    const [form] = Form.useForm();
    useEffect(() => {
      instance.current = form;
    }, [form]);
    return (
      <AntdApp>
        <Form form={form} initialValues={{ research_projects: [] }}>
          <ResearchProjectsEditor />
        </Form>
      </AntdApp>
    );
  }
  render(<Harness />);
  return {
    get form(): FormInstance {
      if (!instance.current) throw new Error("form instance not ready");
      return instance.current;
    },
  };
}

const ADD_LABEL = () => rt("research.list.add", { label: rt("research.tab.projects") });

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ResearchProjectsEditor", () => {
  it("添加一条：描述与成果都是空数组", () => {
    const { form } = setup();
    fireEvent.click(screen.getByRole("button", { name: ADD_LABEL() }));
    const list = form.getFieldValue("research_projects") as Record<string, unknown>[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: "", description: [], outcomes: [] });
  });

  it("多行文本按行转成字符串数组", () => {
    const { form } = setup();
    fireEvent.click(screen.getByRole("button", { name: ADD_LABEL() }));
    fireEvent.change(screen.getByLabelText(rt("research.projects.description")), {
      target: { value: "first line\nsecond line" },
    });
    fireEvent.change(screen.getByLabelText(rt("research.projects.outcomes")), {
      target: { value: "paper" },
    });
    expect(form.getFieldValue(["research_projects", 0, "description"])).toEqual([
      "first line",
      "second line",
    ]);
    expect(form.getFieldValue(["research_projects", 0, "outcomes"])).toEqual(["paper"]);
  });

  it("上移/下移改变条目顺序（表单数组真实换位）", () => {
    const { form } = setup();
    fireEvent.click(screen.getByRole("button", { name: ADD_LABEL() }));
    fireEvent.click(screen.getByRole("button", { name: ADD_LABEL() }));
    const nameInputs = screen.getAllByLabelText(rt("research.projects.name"));
    fireEvent.change(nameInputs[0], { target: { value: "Alpha" } });
    fireEvent.change(nameInputs[1], { target: { value: "Beta" } });

    fireEvent.click(
      screen.getByRole("button", {
        name: rt("research.list.moveUpAria", { label: rt("research.tab.projects"), index: 2 }),
      }),
    );
    const list = form.getFieldValue("research_projects") as { name: string }[];
    expect(list.map((item) => item.name)).toEqual(["Beta", "Alpha"]);
  });
});
