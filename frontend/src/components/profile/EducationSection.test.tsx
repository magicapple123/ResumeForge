/**
 * 教育经历分区：四六级分数录在这里（不是基本信息）。
 *
 * 用户的要求是"把四六级分数放到教育经历里面"——因为成绩是**某段学历期间**考出来的，
 * 而网申表单普遍问具体分数（不少系统按分数自动筛，只填"已通过"过不了）。
 *
 * 这个文件钉两件事：两个输入框真的在分区里；以及新增一条教育经历时会带上这两个键
 * （空值模板漏了的话，新加的那条存下去就没有这两个字段，表现为"填了没保存上"）。
 */
import { App as AntdApp } from "antd";
import { Form } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EducationSection } from "./EducationSection";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

function renderSection(editable = true) {
  return render(
    <AntdApp>
      <Form>
        <EducationSection editable={editable} />
      </Form>
    </AntdApp>,
  );
}

/** 点「添加一条」加一条。 */
function addOne() {
  fireEvent.click(screen.getByRole("button", { name: /添加一条/ }));
}

describe("EducationSection 四六级分数", () => {
  it("把四六级分数放在教育经历里（而不是基本信息）", () => {
    renderSection();
    addOne();

    expect(screen.getByLabelText("英语四级分数")).toBeInTheDocument();
    expect(screen.getByLabelText("英语六级分数")).toBeInTheDocument();
  });

  it("新增的那条带着这两个键——空值模板漏了就会变成「填了没保存上」", () => {
    renderSection();
    addOne();

    // 两个框都在，且初始值为空串（不是 undefined，否则输入框从非受控变受控会告警）。
    const cet4 = screen.getByLabelText("英语四级分数") as HTMLInputElement;
    const cet6 = screen.getByLabelText("英语六级分数") as HTMLInputElement;
    expect(cet4.value).toBe("");
    expect(cet6.value).toBe("");
  });

  it("提示写的是分数，不是「是否通过」——系统按分数自动筛", () => {
    renderSection();
    addOne();

    // 占位符要给出可照抄的样式，用户才知道该填什么。
    expect(screen.getByPlaceholderText("如：520")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("如：512")).toBeInTheDocument();
  });
});
