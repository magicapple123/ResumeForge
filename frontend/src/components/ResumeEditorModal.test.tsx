import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResumeContent } from "../types";
import ResumeEditorModal from "./ResumeEditorModal";
import ShortcutProvider from "../features/shortcuts/ShortcutProvider";
import { EDITOR_FIELD_SCROLL_OPTIONS } from "./resume-editor/editorFieldScroll";

/**
 * 把测试视口切成"宽屏"：`src/test/setup.ts` 的 matchMedia 一律返回 false，所以默认
 * 视口等价于窄屏。antd 的 `Grid.useBreakpoint` 在每次订阅时重新读 matchMedia，
 * 因此在 render 之前替换、之后还原即可（不需要动那个全局默认值）。
 */
function mockWideViewport(minWidthPx = 992): () => void {
  const original = window.matchMedia;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => {
      const minWidth = /min-width:\s*(\d+)px/.exec(query);
      return {
        matches: minWidth ? Number(minWidth[1]) <= minWidthPx : false,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      };
    },
  });
  return () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: original,
    });
  };
}

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

    const content: ResumeContent = {
      ...CONTENT,
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
    };
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

/**
 * R16：`fillSources` 不传时这条入口**完全不渲染**。
 *
 * 编辑已保存简历时用户要的是改这一份，不是从资料里再抓一条进来；把入口留在那里只会让
 * 他以为"填进来会替换"，而实际是追加一条重复项。
 */
describe("ResumeEditorModal 从我的资料填入（R16）", () => {
  const FILL_SOURCES = {
    education: [
      {
        key: "示例大学|软件工程|2023.09|2027.06",
        label: "示例大学",
        hint: "软件工程",
        value: { school: "示例大学", major: "软件工程" },
      },
    ],
    experience: [],
    campusExperience: [],
    projects: [],
    skills: [],
    awards: [],
    summary: "资料里的个人总结",
  };

  async function openEducationTab() {
    fireEvent.click(await screen.findByRole("tab", { name: "教育" }));
    // 「添加教育经历」始终存在，用它确认这一页真的挂上了（内容为空时没有字段可等）。
    // 用正则：按钮里带图标，无障碍名会混进图标的 aria-label。
    return screen.findByRole("button", { name: /添加教育经历/ });
  }

  it("不传 fillSources 时教育页没有任何填入入口", async () => {
    render(
      <AntdApp>
        <ResumeEditorModal open content={CONTENT} onClose={vi.fn()} onSave={vi.fn()} />
      </AntdApp>,
    );

    await openEducationTab();
    expect(screen.queryByText("从我的资料填入")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "从我的资料选择教育经历" }),
    ).not.toBeInTheDocument();
    // 基本信息页的「填入个人总结」同样不该出现。
    expect(
      screen.queryByRole("button", { name: /从我的资料填入个人总结/ }),
    ).not.toBeInTheDocument();
  });

  it("传了 fillSources 时教育页出现候选下拉", async () => {
    render(
      <AntdApp>
        <ResumeEditorModal
          open
          content={CONTENT}
          fillSources={FILL_SOURCES}
          onClose={vi.fn()}
          onSave={vi.fn()}
        />
      </AntdApp>,
    );

    await openEducationTab();
    expect(
      await screen.findByRole("combobox", { name: "从我的资料选择教育经历" }),
    ).toBeInTheDocument();
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
