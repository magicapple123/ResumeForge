import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResumeContent } from "../types";
import ResumeEditorModal from "./ResumeEditorModal";

const CONTENT: ResumeContent = {
  photo: "",
  name: "张三",
  gender: "",
  birth_year: "",
  phone: "",
  email: "",
  city: "",
  personal_website: "",
  github: "",
  job_intent: "产品运营专员",
  summary: "",
  education: [],
  experience: [],
  campus_experience: [],
  projects: [],
  skills: [],
  awards: [],
};

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ResumeEditorModal reference panel", () => {
  it("places the reference before the form in a collapsible narrow-screen section", () => {
    render(
      <AntdApp>
        <ResumeEditorModal
          open
          content={CONTENT}
          referencePanel={<div>岗位参考内容</div>}
          onClose={vi.fn()}
          onSave={vi.fn()}
        />
      </AntdApp>,
    );

    const referenceToggle = screen.getByRole("button", { name: /查看岗位要求/ });
    const referenceContainer = referenceToggle.closest(".resume-editor-reference");
    const editorContainer = screen.getByLabelText("姓名").closest(".resume-editor-main");

    expect(referenceToggle).toHaveAttribute("aria-expanded", "false");
    expect(referenceContainer?.parentElement?.firstElementChild).toBe(referenceContainer);
    expect(editorContainer).toBeInTheDocument();

    fireEvent.click(referenceToggle);
    expect(referenceToggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("岗位参考内容")).toBeInTheDocument();
  });

  it("keeps the existing editor unchanged when no reference is supplied", () => {
    render(
      <AntdApp>
        <ResumeEditorModal open content={CONTENT} onClose={vi.fn()} onSave={vi.fn()} />
      </AntdApp>,
    );

    expect(screen.queryByText("查看岗位要求")).not.toBeInTheDocument();
    expect(screen.getByLabelText("姓名")).toHaveValue("张三");
  });

  it("opens the matching tab and focuses a multiline field selected from the preview", async () => {
    const content: ResumeContent = {
      ...CONTENT,
      projects: [
        {
          name: "预测性维护平台",
          role: "负责人",
          start_date: "2026.01",
          end_date: "2026.06",
          tech_stack: ["Python"],
          description: ["采集设备数据", "构建故障预警模型"],
          highlights: ["降低停机时间"],
        },
      ],
    };

    render(
      <AntdApp>
        <ResumeEditorModal
          open
          content={content}
          initialTarget="projects.0.description.1"
          onClose={vi.fn()}
          onSave={vi.fn()}
        />
      </AntdApp>,
    );

    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "项目" })).toHaveAttribute("aria-selected", "true"),
    );
    const description = screen.getByLabelText("项目描述");
    expect(description).toHaveValue("采集设备数据\n构建故障预警模型");
    await waitFor(() => expect(description).toHaveFocus());
  });
});

/**
 * 未保存守卫（RF-13）：表单被改过还没保存时，取消/遮罩要先弹确认
 * （「未保存的修改将丢失」继续编辑/放弃）；保存成功即解除。beforeunload
 * 的挂载/解除模式与 ProfilePage 相同。
 */
describe("ResumeEditorModal 未保存守卫", () => {
  function spyBeforeUnload() {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");
    return { addSpy, removeSpy };
  }

  it("没改过时点取消直接关闭，不弹确认", () => {
    const onClose = vi.fn();
    render(
      <AntdApp>
        <ResumeEditorModal open content={CONTENT} onClose={onClose} onSave={vi.fn()} />
      </AntdApp>,
    );

    fireEvent.click(screen.getByRole("button", { name: /取\s*消/ }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".ant-modal-confirm")).toBeNull();
  });

  it("改过之后点取消先弹确认；继续编辑不关闭", () => {
    const onClose = vi.fn();
    render(
      <AntdApp>
        <ResumeEditorModal open content={CONTENT} onClose={onClose} onSave={vi.fn()} />
      </AntdApp>,
    );

    fireEvent.change(screen.getByLabelText("姓名"), { target: { value: "张四" } });
    fireEvent.click(screen.getByRole("button", { name: /取\s*消/ }));

    const confirm = document.querySelector(".ant-modal-confirm");
    expect(confirm).not.toBeNull();
    expect(confirm?.textContent).toContain("未保存的修改将丢失");
    expect(onClose).not.toHaveBeenCalled();

    // 继续编辑：确认框关闭，弹窗仍开着。
    fireEvent.click(screen.getByRole("button", { name: /继\s*续\s*编\s*辑/ }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("确认弹窗里选「放弃修改」才真正关闭", () => {
    const onClose = vi.fn();
    render(
      <AntdApp>
        <ResumeEditorModal open content={CONTENT} onClose={onClose} onSave={vi.fn()} />
      </AntdApp>,
    );

    fireEvent.change(screen.getByLabelText("姓名"), { target: { value: "张四" } });
    fireEvent.click(screen.getByRole("button", { name: /取\s*消/ }));
    fireEvent.click(screen.getByRole("button", { name: /放\s*弃\s*修\s*改/ }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("表单有更改后挂上 beforeunload 监听，保存成功后解除并直接关闭", async () => {
    const { addSpy, removeSpy } = spyBeforeUnload();
    const onClose = vi.fn();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <AntdApp>
        <ResumeEditorModal open content={CONTENT} onClose={onClose} onSave={onSave} />
      </AntdApp>,
    );

    fireEvent.change(screen.getByLabelText("姓名"), { target: { value: "张四" } });
    await waitFor(() => expect(addSpy).toHaveBeenCalledWith("beforeunload", expect.any(Function)));
    expect(removeSpy).not.toHaveBeenCalledWith("beforeunload", expect.any(Function));

    fireEvent.click(screen.getByRole("button", { name: /保存并更新预览/ }));
    await waitFor(() =>
      expect(removeSpy).toHaveBeenCalledWith("beforeunload", expect.any(Function)),
    );
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
