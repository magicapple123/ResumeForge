// SPDX-License-Identifier: Apache-2.0
/**
 * 「论文发表」编辑页（W14）：空态 → 添加 → 作者顺序/本人标记 → 状态不混淆 → 链接安全。
 *
 * 所有可见文案都从 `rt()` 取（与组件同源），测试里不写中文字面量：改一次文案只改语言包，
 * 这里跟着一起变。
 */
import { App as AntdApp, Form } from "antd";
import type { FormInstance } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { rt } from "../../../features/resume-research/i18n";
import PublicationsEditor from "./PublicationsEditor";

interface AuthorRecord {
  name: string;
  is_self: boolean;
  corresponding: boolean;
}

function setup(initial: Record<string, unknown> = {}) {
  // 表单实例在 effect 里捕获：渲染期给外部变量赋值是副作用（react-hooks/globals 会红）。
  const instance: { current: FormInstance | null } = { current: null };
  function Harness() {
    const [form] = Form.useForm();
    useEffect(() => {
      instance.current = form;
    }, [form]);
    return (
      <AntdApp>
        <Form form={form} initialValues={initial}>
          <PublicationsEditor />
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

const ADD_LABEL = () => rt("research.list.add", { label: rt("research.tab.publications") });
const ADD_AUTHOR = () => rt("research.authors.add");

function authorsOf(form: FormInstance): AuthorRecord[] {
  return (form.getFieldValue(["publications", 0, "authors"]) ?? []) as AuthorRecord[];
}

function addFirstPublication() {
  fireEvent.click(screen.getByRole("button", { name: ADD_LABEL() }));
}

afterEach(() => {
  cleanup();
  // 下拉/提示渲染在 portal（body）里：不清掉会把上一用例的节点留给下一个。
  document.body.innerHTML = "";
});

describe("PublicationsEditor", () => {
  it("空列表显示空态与添加按钮", () => {
    setup();
    expect(screen.getByText(rt("research.empty.publications"))).toBeTruthy();
    expect(screen.getByRole("button", { name: ADD_LABEL() })).toBeTruthy();
  });

  it("添加一条：写进表单的是后端默认值（状态 other，不是 published）", () => {
    const { form } = setup();
    addFirstPublication();
    const list = form.getFieldValue("publications") as Record<string, unknown>[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ title: "", authors: [], status: "other", doi: "", url: "" });
  });

  it("作者可添加、下移、删除，表单里的顺序就是署名顺序", () => {
    const { form } = setup();
    addFirstPublication();
    fireEvent.click(screen.getByRole("button", { name: ADD_AUTHOR() }));
    fireEvent.click(screen.getByRole("button", { name: ADD_AUTHOR() }));

    const nameInputs = screen.getAllByLabelText(rt("research.authors.name"));
    expect(nameInputs).toHaveLength(2);
    fireEvent.change(nameInputs[0], { target: { value: "Alice" } });
    fireEvent.change(nameInputs[1], { target: { value: "Bob" } });
    expect(authorsOf(form).map((author) => author.name)).toEqual(["Alice", "Bob"]);

    fireEvent.click(
      screen.getByRole("button", { name: rt("research.authors.moveDownAria", { index: 1 }) }),
    );
    expect(authorsOf(form).map((author) => author.name)).toEqual(["Bob", "Alice"]);

    fireEvent.click(
      screen.getByRole("button", { name: rt("research.authors.removeAria", { index: 2 }) }),
    );
    expect(authorsOf(form).map((author) => author.name)).toEqual(["Bob"]);
  });

  it("「本人」写布尔字段，不改写姓名文本", () => {
    const { form } = setup();
    addFirstPublication();
    fireEvent.click(screen.getByRole("button", { name: ADD_AUTHOR() }));
    fireEvent.change(screen.getByLabelText(rt("research.authors.name")), {
      target: { value: "Alice" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: rt("research.authors.self") }));

    const [first] = authorsOf(form);
    expect(first.is_self).toBe(true);
    expect(first.name).toBe("Alice");
  });

  it("发表状态下拉同时列出「已发表」与「在投」，选中在投只写 under_review", async () => {
    const { form } = setup();
    addFirstPublication();
    const status = screen.getByRole("combobox", { name: rt("research.publications.status") });
    fireEvent.mouseDown(status);
    expect(await screen.findByText(rt("research.status.under_review"))).toBeTruthy();
    expect(screen.getByText(rt("research.status.published"))).toBeTruthy();
    fireEvent.click(screen.getByText(rt("research.status.under_review")));
    expect(form.getFieldValue(["publications", 0, "status"])).toBe("under_review");
  });

  it("URL 只接受 http(s)：javascript: 不渲染链接，并给出说明", () => {
    setup();
    addFirstPublication();
    const urlInput = screen.getByLabelText(rt("research.publications.url"));

    fireEvent.change(urlInput, { target: { value: "javascript:alert(1)" } });
    expect(screen.queryByRole("link", { name: rt("research.link.open") })).toBeNull();
    expect(screen.getByText(rt("research.link.invalid"))).toBeTruthy();

    fireEvent.change(urlInput, { target: { value: "https://example.com/paper" } });
    const link = screen.getByRole("link", { name: rt("research.link.open") });
    expect(link).toHaveAttribute("href", "https://example.com/paper");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(screen.queryByText(rt("research.link.invalid"))).toBeNull();
  });

  it("合法 DOI 生成 doi.org 链接", () => {
    setup();
    addFirstPublication();
    fireEvent.change(screen.getByLabelText(rt("research.publications.doi")), {
      target: { value: "10.1000/xyz123" },
    });
    const links = screen.getAllByRole("link", { name: rt("research.link.open") });
    expect(links.map((link) => link.getAttribute("href"))).toContain(
      "https://doi.org/10.1000/xyz123",
    );
  });

  it("删除条目后回到空态", () => {
    setup();
    addFirstPublication();
    fireEvent.click(
      screen.getByRole("button", {
        name: rt("research.list.removeAria", { label: rt("research.tab.publications"), index: 1 }),
      }),
    );
    expect(screen.getByText(rt("research.empty.publications"))).toBeTruthy();
  });
});
