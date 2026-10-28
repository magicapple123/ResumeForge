// SPDX-License-Identifier: Apache-2.0
/**
 * 简历微调弹窗：参考栏、未保存守卫、双栏独立滚动、快捷键、填入我的资料全部数据。
 *
 * 2026-10-19：条目级填入开关（`entryFill`）那一组按内聚边界拆到
 * `ResumeEditorModal.entryFill.test.tsx`（行数预算 500）。内容夹具与视口 mock 抽到
 * `ResumeEditorModal.testkit.tsx` 供两个文件共用；本文件自身不注册 `vi.mock`
 * （这一批用例断言的都是渲染行为，不打 api）。
 *
 * 2026-10-28：R16「从我的资料填入」入口显隐拆到
 * `ResumeEditorModal.profileFill.test.tsx`（本文件到 500 行上限，新增用例加在那边）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResumeContent } from "../types";
import { CONTENT, makeResumeContent, mockWideViewport } from "./ResumeEditorModal.testkit";
import ResumeEditorModal from "./ResumeEditorModal";
import ShortcutProvider from "../features/shortcuts/ShortcutProvider";
import { EDITOR_FIELD_SCROLL_OPTIONS } from "./resume-editor/editorFieldScroll";

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
    const content: ResumeContent = makeResumeContent({
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
    });

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
/** 只看 footer 的确认条：页面里另有一个 role="alert" 的页内提示，按 role 找会撞车。 */
const discardBar = (): HTMLElement | null => document.querySelector(".rf-form-modal-discard");

/** 就地确认条里的主按钮：L2 确认在 footer 内换态，不再叠第二层弹窗。 */
async function discardBarButton(): Promise<HTMLElement> {
  return waitFor(() => {
    const hit = document.querySelector<HTMLElement>(".rf-form-modal-discard .ant-btn-primary");
    if (!hit) throw new Error("内联确认条未渲染");
    return hit;
  });
}

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

    // 内联确认条：同一个 footer 换态，**不叠第二层弹窗**。
    const bar = discardBar();
    expect(bar?.textContent).toContain("这份简历还有改动没有保存");
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
    expect(discardBar()).toBeNull();
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
    fireEvent.click(screen.getByRole("button", { name: "放弃修改" }));
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

/**
 * R11：桌面端左右两栏各自独立滚动。
 *
 * 整块 body 一起滚时，编辑栏可以长到几十屏，用户一改到下面的条目就再也看不到岗位要求
 * ——而那正是他需要对照的东西。所以宽屏下 body 不滚（`overflow: hidden`），
 * `.resume-editor-main` 与 `.resume-editor-reference` 各自滚动；窄屏回到单列整块滚。
 */
describe("ResumeEditorModal 双栏独立滚动（R11）", () => {
  function bodyStyle(): CSSStyleDeclaration {
    const body = document.querySelector<HTMLElement>(".ant-modal-body");
    if (!body) throw new Error("弹窗 body 未渲染");
    return body.style;
  }

  it("宽屏 + 有参考栏时 body 不滚，左右两栏的容器都在", async () => {
    const restore = mockWideViewport();
    try {
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

      // 两栏布局下 body 自己不滚（否则整块滚，参考栏一秒就滚出可视区）。
      await waitFor(() => expect(bodyStyle().overflow).toBe("hidden"));
      expect(document.querySelector(".resume-editor-main")).not.toBeNull();
      expect(document.querySelector(".resume-editor-reference")).not.toBeNull();
      // 宽屏直接展示参考内容，不走折叠面板。
      expect(screen.getByText("岗位参考内容")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /查看岗位要求/ })).not.toBeInTheDocument();
    } finally {
      restore();
    }
  });

  it("没有参考栏时仍是单列，body 照旧可滚", async () => {
    render(
      <AntdApp>
        <ResumeEditorModal open content={CONTENT} onClose={vi.fn()} onSave={vi.fn()} />
      </AntdApp>,
    );

    expect(bodyStyle().overflowY).toBe("auto");
    expect(bodyStyle().overflow).not.toBe("hidden");
    // 单列时不渲染参考栏容器（不是渲染了但隐藏）。
    expect(document.querySelector(".resume-editor-reference")).toBeNull();
  });

  it("窄屏有参考栏时仍是单列可滚 + 折叠面板", async () => {
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

    // 默认测试视口（matchMedia 一律 false）就是窄屏：body 可滚、参考内容进折叠面板。
    expect(bodyStyle().overflowY).toBe("auto");
    expect(screen.getByRole("button", { name: /查看岗位要求/ })).toBeInTheDocument();
  });

  it("跳转字段时用「滚到中间、已可见就不滚」的选项，并把焦点交给那一栏", async () => {
    // jsdom 没有布局，滚动本身观察不到（`scroll-into-view-if-needed` 在里面是空转），
    // 所以这里钉两件能钉的事：选项值本身，以及"跳转真的跑到了目标字段"（焦点）。
    expect(EDITOR_FIELD_SCROLL_OPTIONS).toMatchObject({
      behavior: "smooth",
      block: "center",
      // `if-needed`：已经在可视区就别再滚，免得把用户正在看的上下文顶走。
      scrollMode: "if-needed",
    });

    const content: ResumeContent = makeResumeContent({
      projects: [
        {
          name: "预测性维护平台",
          role: "负责人",
          start_date: "2026.01",
          end_date: "2026.06",
          tech_stack: ["Python"],
          description: ["采集设备数据"],
          highlights: [],
        },
      ],
    });
    render(
      <AntdApp>
        <ResumeEditorModal
          open
          content={content}
          initialTarget="projects.0.name"
          onClose={vi.fn()}
          onSave={vi.fn()}
        />
      </AntdApp>,
    );

    const field = await screen.findByLabelText("项目名称");
    await waitFor(() => expect(field).toHaveFocus());
    // 目标字段在编辑栏里：两栏布局下这一栏自己滚，参考栏不该跟着动。
    expect(field.closest(".resume-editor-main")).not.toBeNull();
  });
});

describe("ResumeEditorModal 快捷键（R5）", () => {
  it("Ctrl+Z 撤回、Ctrl+Shift+Z 恢复，Ctrl+S 走同一处 form.submit()", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <AntdApp>
        <ShortcutProvider>
          <ResumeEditorModal open content={CONTENT} onClose={vi.fn()} onSave={onSave} />
        </ShortcutProvider>
      </AntdApp>,
    );

    const nameInput = screen.getByLabelText("姓名");
    fireEvent.change(nameInput, { target: { value: "李四" } });
    expect(nameInput).toHaveValue("李四");

    // 输入框里是浏览器原生的逐字撤销，页面级历史不动。
    fireEvent.keyDown(nameInput, { key: "z", ctrlKey: true });
    expect(nameInput).toHaveValue("李四");

    // 输入框外：表单级撤回 / 恢复。
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    await waitFor(() => expect(screen.getByLabelText("姓名")).toHaveValue("张三"));
    fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(screen.getByLabelText("姓名")).toHaveValue("李四"));

    // 保存：与页脚「保存并更新预览」同一个 form.submit() 入口。
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toMatchObject({ name: "李四" });
  });
});

/**
 * T11：「填入我的资料全部数据」——通用手写简历从空白起步后的那条捷径。
 *
 * 两件事必须钉住：这个按钮只在传了 `fillAll` 时存在（岗位模式/编辑已保存简历不该有），
 * 以及"覆盖已有内容"必须先问一句——它替换的是整份表单，不是补一段。
 */
describe("ResumeEditorModal 填入我的资料全部数据（T11）", () => {
  const FILLED: ResumeContent = makeResumeContent({
    name: "李四",
    summary: "资料里的个人总结",
    education: [
      {
        school: "示例大学",
        major: "软件工程",
        degree: "本科",
        start_date: "2023.09",
        end_date: "2027.06",
        gpa: "3.8",
        courses: ["数据结构"],
        achievements: [],
      } as ResumeContent["education"][number],
    ],
  });
  const BLANK: ResumeContent = makeResumeContent({ name: "", job_intent: "", summary: "" });

  function renderEditor(content: ResumeContent, fillAll?: () => ResumeContent) {
    render(
      <AntdApp>
        <ResumeEditorModal
          open
          content={content}
          fillAll={fillAll}
          onClose={vi.fn()}
          onSave={vi.fn()}
        />
      </AntdApp>,
    );
  }

  it("不传 fillAll 时没有这个入口（岗位模式 / 编辑已保存简历都不该出现）", () => {
    renderEditor(CONTENT);

    expect(screen.queryByRole("button", { name: /填入我的资料全部数据/ })).not.toBeInTheDocument();
  });

  it("表单为空时直接填入，不需要确认；填完算未保存（取消会先问）", () => {
    renderEditor(BLANK, () => FILLED);

    fireEvent.click(screen.getByRole("button", { name: /填入我的资料全部数据/ }));

    expect(screen.getByLabelText("姓名")).toHaveValue("李四");
    expect(screen.getByLabelText("个人总结")).toHaveValue("资料里的个人总结");

    // 脏标记生效：这时点「取消」先出未保存确认条。
    fireEvent.click(screen.getByRole("button", { name: /取\s*消/ }));
    expect(discardBar()?.textContent).toContain("这份简历还有改动没有保存");
  });

  it("已有内容时先确认：取消不动，确认后覆盖", async () => {
    renderEditor(CONTENT, () => FILLED);

    fireEvent.click(screen.getByRole("button", { name: /填入我的资料全部数据/ }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "将用「我的资料」覆盖当前已填写的内容",
      ),
    );
    // 取消：原内容一个字符都不动。
    fireEvent.click(screen.getByRole("button", { name: "继续编辑" }));
    expect(screen.getByLabelText("姓名")).toHaveValue("张三");

    // 再来一次并确认覆盖。
    fireEvent.click(screen.getByRole("button", { name: /填入我的资料全部数据/ }));
    fireEvent.click(await discardBarButton());
    await waitFor(() => expect(screen.getByLabelText("姓名")).toHaveValue("李四"));
  });

  /** 叠层回归：确认条就地出现在 footer，不许退回 `modal.confirm`（那会多出一层弹窗容器）。 */
  it("覆盖填入只留一层弹窗容器：确认条在 footer 里就地换态", async () => {
    renderEditor(CONTENT, () => FILLED);

    // 入口按钮按容器定位（编辑栏头部的提示行），不靠文案找。
    const fillEntry = document.querySelector<HTMLElement>(".resume-editor-hint-row button.ant-btn");
    expect(fillEntry).not.toBeNull();
    fireEvent.click(fillEntry!);

    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    fireEvent.click(await discardBarButton());
    await waitFor(() => expect(screen.getByLabelText("姓名")).toHaveValue("李四"));
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  });
});
