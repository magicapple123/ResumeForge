// SPDX-License-Identifier: Apache-2.0
/**
 * F8-C：简历编辑器新增字段（资料小字段在简历里的落点）。
 *
 * 守三层：
 * 1. 空条目（emptyValue）必须带上全部新字段——否则「添加一条」后从资料填入的新字段
 *    没有落点，保存时也会被 mergePartial 丢掉；
 * 2. 新字段有可见输入框、能写进表单（= 保存载荷里会出现）；
 * 3. 工作类型是 Select，存的是 A4 白名单 code（不是中文）。
 */
import { App as AntdApp, Form } from "antd";
import type { FormInstance } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  AwardEditor,
  CampusEditor,
  EducationEditor,
  ExperienceEditor,
  ProjectEditor,
  SkillEditor,
} from "./ResumeSectionEditors";

function setup() {
  const instance: { current: FormInstance | null } = { current: null };
  function Harness() {
    const [form] = Form.useForm();
    useEffect(() => {
      instance.current = form;
    }, [form]);
    return (
      <AntdApp>
        <Form form={form}>
          <EducationEditor />
          <ExperienceEditor />
          <CampusEditor />
          <ProjectEditor />
          <SkillEditor />
          <AwardEditor />
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

// 添加按钮前面有 PlusOutlined 图标（aria-label="plus"），可访问名是 "plus添加XX"。
function add(label: string) {
  fireEvent.click(screen.getByRole("button", { name: (name: string) => name.endsWith(label) }));
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("F8-C 编辑器新字段", () => {
  it("教育经历：空条目带 6 个新字段，输入能写进表单（保存载荷可见）", () => {
    const { form } = setup();
    add("添加教育经历");
    expect(form.getFieldValue(["education", 0])).toMatchObject({
      study_form: "",
      degree_type: "",
      department: "",
      rank: "",
      advisor: "",
      research_direction: "",
    });

    fireEvent.change(screen.getByLabelText("导师"), { target: { value: "张伟" } });
    fireEvent.change(screen.getByLabelText("研究方向"), { target: { value: "数据库" } });
    fireEvent.change(screen.getByLabelText("成绩排名"), { target: { value: "前 5%" } });
    expect(form.getFieldValue(["education", 0, "advisor"])).toBe("张伟");
    expect(form.getFieldValue(["education", 0, "research_direction"])).toBe("数据库");
    expect(form.getFieldValue(["education", 0, "rank"])).toBe("前 5%");
  });

  it("实习/工作经历：团队规模可填，工作类型下拉存 A4 code", () => {
    const { form } = setup();
    add("添加实习/工作经历");
    expect(form.getFieldValue(["experience", 0])).toMatchObject({
      team_size: "",
      experience_kind: "",
    });

    fireEvent.change(screen.getByLabelText("团队规模"), { target: { value: "8 人" } });
    expect(form.getFieldValue(["experience", 0, "team_size"])).toBe("8 人");

    fireEvent.mouseDown(screen.getByLabelText("工作类型"));
    // i18n-ok: 编辑器字段标签是组件里的中文字面量（存量约定），测试按同一文案定位下拉项。
    fireEvent.click(screen.getByText("实习"));
    expect(form.getFieldValue(["experience", 0, "experience_kind"])).toBe("internship");
  });

  it("校园/项目/技能/奖项：新字段在空条目里注册且可编辑", () => {
    const { form } = setup();
    add("添加校园经历");
    add("添加项目经历");
    add("添加专业技能");
    add("添加荣誉奖项");

    expect(form.getFieldValue(["campus_experience", 0])).toMatchObject({ activity_type: "" });
    expect(form.getFieldValue(["projects", 0])).toMatchObject({
      project_size: "",
      artifact_type: "",
    });
    expect(form.getFieldValue(["skills", 0])).toMatchObject({ category: "" });
    expect(form.getFieldValue(["awards", 0])).toMatchObject({
      issuer: "",
      level: "",
      ratio: "",
    });

    fireEvent.change(screen.getByLabelText("活动类型"), { target: { value: "社团" } });
    fireEvent.change(screen.getByLabelText("项目规模"), { target: { value: "5 人" } });
    fireEvent.change(screen.getByLabelText("成果类型"), { target: { value: "开源作品" } });
    fireEvent.change(screen.getByLabelText("技能分类"), { target: { value: "编程语言" } });
    fireEvent.change(screen.getByLabelText("颁发机构"), { target: { value: "教育部" } });
    fireEvent.change(screen.getByLabelText("奖项级别"), { target: { value: "国家级" } });
    fireEvent.change(screen.getByLabelText("获奖比例"), { target: { value: "前 1%" } });
    expect(form.getFieldValue(["campus_experience", 0, "activity_type"])).toBe("社团");
    expect(form.getFieldValue(["projects", 0, "project_size"])).toBe("5 人");
    expect(form.getFieldValue(["projects", 0, "artifact_type"])).toBe("开源作品");
    expect(form.getFieldValue(["skills", 0, "category"])).toBe("编程语言");
    expect(form.getFieldValue(["awards", 0, "issuer"])).toBe("教育部");
    expect(form.getFieldValue(["awards", 0, "level"])).toBe("国家级");
    expect(form.getFieldValue(["awards", 0, "ratio"])).toBe("前 1%");
  });
});
