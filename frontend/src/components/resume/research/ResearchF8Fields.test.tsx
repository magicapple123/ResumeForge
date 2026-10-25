// SPDX-License-Identifier: Apache-2.0
/**
 * F8-C：科研栏目新增字段（论文成果类型/我的署名位次、科研项目级别）。
 *
 * 空条目必须由 researchFields 的空工厂带上新字段（组件只负责渲染与写值）；
 * 标签仍统一走 rt()，测试不写中文字面量。
 */
import { App as AntdApp, Form } from "antd";
import type { FormInstance } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { rt } from "../../../features/resume-research/i18n";
import PublicationsEditor from "./PublicationsEditor";
import ResearchProjectsEditor from "./ResearchProjectsEditor";

function setup(children: React.ReactNode) {
  const instance: { current: FormInstance | null } = { current: null };
  function Harness() {
    const [form] = Form.useForm();
    useEffect(() => {
      instance.current = form;
    }, [form]);
    return (
      <AntdApp>
        <Form form={form}>{children}</Form>
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

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("F8-C 科研栏目新字段", () => {
  it("论文：空条目带成果类型/我的署名位次，输入写进表单", () => {
    const { form } = setup(<PublicationsEditor />);
    fireEvent.click(
      screen.getByRole("button", {
        name: rt("research.list.add", { label: rt("research.tab.publications") }),
      }),
    );
    expect(form.getFieldValue(["publications", 0])).toMatchObject({
      outcome_type: "",
      my_rank: "",
    });
    fireEvent.change(screen.getByLabelText(rt("research.publications.outcomeType")), {
      target: { value: "会议论文" },
    });
    fireEvent.change(screen.getByLabelText(rt("research.publications.myRank")), {
      target: { value: "第一作者" },
    });
    expect(form.getFieldValue(["publications", 0, "outcome_type"])).toBe("会议论文");
    expect(form.getFieldValue(["publications", 0, "my_rank"])).toBe("第一作者");
  });

  it("科研项目：空条目带项目级别，输入写进表单", () => {
    const { form } = setup(<ResearchProjectsEditor />);
    fireEvent.click(
      screen.getByRole("button", {
        name: rt("research.list.add", { label: rt("research.tab.projects") }),
      }),
    );
    expect(form.getFieldValue(["research_projects", 0])).toMatchObject({ level: "" });
    fireEvent.change(screen.getByLabelText(rt("research.projects.level")), {
      target: { value: "国家级" },
    });
    expect(form.getFieldValue(["research_projects", 0, "level"])).toBe("国家级");
  });
});
