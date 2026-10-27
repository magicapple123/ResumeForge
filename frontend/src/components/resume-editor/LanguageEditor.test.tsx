// SPDX-License-Identifier: Apache-2.0
/**
 * 语言能力编辑器（2026-10 独立成栏）：字段落点与表单往返。
 *
 * 用户反馈 #11：资料里的语言能力在制作台显示成「专业技能」。后端投影与页签映射已拆开，
 * 这里守住前端这一半：独立页签里的表单把五个资料字段写进 `content.languages`，
 * 「添加语言能力」的空条目带全字段（保存时不会被 mergePartial 丢掉）。
 */
import { App as AntdApp, Form } from "antd";
import type { FormInstance } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it } from "vitest";
import LanguageEditor from "./LanguageEditor";

function setup(initialValues: Record<string, unknown> = {}) {
  const instance: { current: FormInstance | null } = { current: null };
  function Harness() {
    const [form] = Form.useForm();
    useEffect(() => {
      instance.current = form;
    }, [form]);
    return (
      <AntdApp>
        <Form form={form} initialValues={initialValues}>
          <LanguageEditor />
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

function add(label: string) {
  fireEvent.click(screen.getByRole("button", { name: (name: string) => name.endsWith(label) }));
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("LanguageEditor", () => {
  it("添加语言能力：空条目带齐五个字段，输入写进 content.languages", () => {
    const { form } = setup();
    add("添加语言能力");
    expect(form.getFieldValue(["languages", 0])).toEqual({
      name: "",
      level: "",
      certificate: "",
      score: "",
      obtained_at: "",
    });

    fireEvent.change(screen.getByLabelText("语言"), { target: { value: "英语" } });
    fireEvent.change(screen.getByLabelText("水平/等级"), { target: { value: "CET-6" } });
    fireEvent.change(screen.getByLabelText("证书"), { target: { value: "六级证书" } });
    fireEvent.change(screen.getByLabelText("分数"), { target: { value: "550" } });
    fireEvent.change(screen.getByLabelText("取得时间"), { target: { value: "2024.06" } });

    expect(form.getFieldValue(["languages", 0])).toEqual({
      name: "英语",
      level: "CET-6",
      certificate: "六级证书",
      score: "550",
      obtained_at: "2024.06",
    });
  });

  it("已有语言条目按五个字段回显（编辑已保存简历时不丢字段）", () => {
    setup({
      languages: [{ name: "日语", level: "N2", certificate: "JLPT", score: "", obtained_at: "" }],
    });
    expect(screen.getByLabelText("语言")).toHaveValue("日语");
    expect(screen.getByLabelText("水平/等级")).toHaveValue("N2");
    expect(screen.getByLabelText("证书")).toHaveValue("JLPT");
  });
});
