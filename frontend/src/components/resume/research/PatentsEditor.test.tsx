// SPDX-License-Identifier: Apache-2.0
/** 「专利」编辑页（W14）：发明人顺序、状态不混淆、专利号原样保存、链接安全。 */
import { App as AntdApp, Form } from "antd";
import type { FormInstance } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { rt } from "../../../features/resume-research/i18n";
import PatentsEditor from "./PatentsEditor";

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
        <Form form={form} initialValues={{ patents: [] }}>
          <PatentsEditor />
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

const ADD_LABEL = () => rt("research.list.add", { label: rt("research.tab.patents") });

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("PatentsEditor", () => {
  it("添加一条：发明人为空数组、状态 other（不预设已授权）", () => {
    const { form } = setup();
    fireEvent.click(screen.getByRole("button", { name: ADD_LABEL() }));
    const list = form.getFieldValue("patents") as Record<string, unknown>[];
    expect(list[0]).toMatchObject({ inventors: [], status: "other", patent_number: "" });
  });

  it("发明人顺序即署名顺序", () => {
    const { form } = setup();
    fireEvent.click(screen.getByRole("button", { name: ADD_LABEL() }));
    const add = () =>
      fireEvent.click(screen.getByRole("button", { name: rt("research.inventors.add") }));
    add();
    add();
    const inputs = screen.getAllByLabelText(rt("research.authors.name"));
    fireEvent.change(inputs[0], { target: { value: "Alice" } });
    fireEvent.change(inputs[1], { target: { value: "Bob" } });
    fireEvent.click(
      screen.getByRole("button", { name: rt("research.authors.moveUpAria", { index: 2 }) }),
    );
    const inventors = form.getFieldValue(["patents", 0, "inventors"]) as { name: string }[];
    expect(inventors.map((item) => item.name)).toEqual(["Bob", "Alice"]);
  });

  it("专利号按原样保存（不改写、不格式化）", () => {
    const { form } = setup();
    fireEvent.click(screen.getByRole("button", { name: ADD_LABEL() }));
    fireEvent.change(screen.getByLabelText(rt("research.patents.number")), {
      target: { value: "CN123456789A" },
    });
    expect(form.getFieldValue(["patents", 0, "patent_number"])).toBe("CN123456789A");
  });

  it("状态同时列出「已授权」与「审查中」，选中审查中只写 pending", async () => {
    const { form } = setup();
    fireEvent.click(screen.getByRole("button", { name: ADD_LABEL() }));
    fireEvent.mouseDown(screen.getByRole("combobox", { name: rt("research.patents.status") }));
    expect(await screen.findByText(rt("research.patentStatus.pending"))).toBeTruthy();
    expect(screen.getByText(rt("research.patentStatus.granted"))).toBeTruthy();
    fireEvent.click(screen.getByText(rt("research.patentStatus.pending")));
    expect(form.getFieldValue(["patents", 0, "status"])).toBe("pending");
  });

  it("非法链接不渲染可点链接", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: ADD_LABEL() }));
    fireEvent.change(screen.getByLabelText(rt("research.patents.url")), {
      target: { value: "javascript:alert(1)" },
    });
    expect(screen.queryByRole("link", { name: rt("research.link.open") })).toBeNull();
  });
});
