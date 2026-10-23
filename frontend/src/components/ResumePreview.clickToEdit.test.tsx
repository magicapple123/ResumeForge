// SPDX-License-Identifier: Apache-2.0
/**
 * 「草稿模式编辑」在**组件这一层**的接线。
 *
 * 纯函数与状态机由 `resume-preview/useClickToEditPreview.test.ts` 逐个钉住（命中判定、
 * 监听去重、持久化）。这里补的是它测不到的那一段：`ResumePreview` 把这套状态机挂到
 * **真的 iframe 文档**上。两种失效只有在这一层才看得见，而且都不报错：
 *
 * 1. **勾选值没传下去**：复选框勾了，纸面里既没有开关 class 也没有样式表——用户以为
 *    "勾了没反应"（父页面的样式表进不去 iframe，反馈必须注入那个文档内部）；
 * 2. **`onIframeLoad` 里漏了 `bindDocument`**：勾了、样式也有，点下去什么都不发生。
 *
 * 单独成文件的另一个理由是行数预算：`ResumePreview.test.tsx` 已经贴着
 * `test_file_size_budget` 的测试文件上限（500），再塞三条会直接超线。
 *
 * 断言里不出现中文：`cjkRatchet` 的 tests 口径按文件卡中文 `*ByText`，新文件基线为 0。
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ResumePreview from "./ResumePreview";
import { t } from "../i18n";
import { CLICK_TO_EDIT_CLASS, CLICK_TO_EDIT_STYLE_ID } from "./resume-preview/clickToEdit";
import { clearPreviewCache } from "./resume-preview/exactPreviewCache";
import type { RichTextEditAdapter } from "./resume-preview/richText";

// 精确预览会去服务端要 PDF；这里只关心"复选框在精确模式下是否禁用"，让请求永远悬着
// （= 还在排版），就不必在 jsdom 里伪造 objectURL。
const fetchPreviewPdf = vi.hoisted(() => vi.fn(() => new Promise(() => {})));
vi.mock("../api/resumes", () => ({ fetchResumePreviewPdf: fetchPreviewPdf }));

const HTML = "<!doctype html><html><body></body></html>";

/** `ResumePreview` 要求的那组精确预览上下文（有 `resumeId` 才会出现口径切换）。 */
const EXACT = {
  resumeId: 7,
  template: "classic",
  formatName: "",
  fontScale: "standard",
  language: "zh-CN",
  formatConfig: {},
  contentSignature: "sig",
};

beforeEach(() => {
  // 勾选值是**持久化**的（`resume.preview.clickEdit`）：不清掉它，上一条用例勾过的状态会
  // 带进下一条，"点一下复选框"在某些用例里会变成"取消勾选"，而界面上看不出区别。
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  localStorage.clear();
  clearPreviewCache();
  fetchPreviewPdf.mockReset();
  fetchPreviewPdf.mockImplementation(() => new Promise(() => {}));
});

function getPreviewFrame(): HTMLIFrameElement {
  return screen.getByTitle("简历预览") as HTMLIFrameElement;
}

/** 在纸面里放一处带路径的文字（模拟后端模板的 `data-resume-path`），并让它"加载完成"。 */
function paperField(iframe: HTMLIFrameElement): Element {
  const doc = iframe.contentDocument;
  if (!doc) throw new Error("测试环境未创建 iframe document");
  doc.body.innerHTML = '<span data-resume-path="name">Alex</span>';
  fireEvent.load(iframe);
  const target = doc.querySelector("[data-resume-path]");
  if (!target) throw new Error("字段未渲染");
  return target;
}

/** 把纸面正文换成给定 HTML，并让它"加载完成"（挂监听）。 */
function paperBody(iframe: HTMLIFrameElement, html: string): Document {
  const doc = iframe.contentDocument;
  if (!doc) throw new Error("测试环境未创建 iframe document");
  doc.body.innerHTML = html;
  fireEvent.load(iframe);
  return doc;
}

/** 在纸面里选中一段文字（渲染态偏移；`**` 不计入）。落到第一个**文本节点**上。 */
function selectText(root: Element, start: number, end: number): void {
  const doc = root.ownerDocument;
  // 4 = NodeFilter.SHOW_TEXT（常量在跨 realm 时不一定取得到，直接写字面值）。
  const node = doc.createTreeWalker(root, 4).nextNode();
  if (!node) throw new Error("选区目标为空");
  const range = doc.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  const selection = doc.defaultView?.getSelection();
  if (!selection) throw new Error("jsdom 没有 Selection");
  selection.removeAllRanges();
  selection.addRange(range);
}

/** 在某个元素上右键；事件用**那个 realm** 的构造器造（iframe 里的节点跨 realm）。 */
function contextMenuOn(node: Element): MouseEvent {
  const view = node.ownerDocument.defaultView;
  if (!view) throw new Error("iframe 没有窗口");
  const event = new view.MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    clientX: 12,
    clientY: 24,
  });
  fireEvent(node, event);
  return event;
}

/** 宿主侧的加粗契约（`toggle` 是 mock，用来断言"交出去的是什么"）。 */
function richAdapter(raw = "Alex") {
  const toggle = vi.fn();
  const read = (path: string): string | null => (path === "name" ? raw : null);
  return { read, toggle } satisfies RichTextEditAdapter;
}

describe("ResumePreview · 草稿模式编辑的组件接线", () => {
  it("勾选后点纸面字段：宿主收到那条路径，样式注入进 iframe 内部", () => {
    const onPickField = vi.fn();
    render(<ResumePreview html={HTML} warnings={[]} onPickField={onPickField} />);

    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();

    const iframe = getPreviewFrame();
    const target = paperField(iframe);

    // 父页面的样式表进不去 iframe：开关 class 与样式表都必须落在**那个文档**里。
    const doc = iframe.contentDocument;
    expect(doc).not.toBeNull();
    expect(doc!.documentElement.classList.contains(CLICK_TO_EDIT_CLASS)).toBe(true);
    expect(doc!.getElementById(CLICK_TO_EDIT_STYLE_ID)).not.toBeNull();

    fireEvent.click(target);
    expect(onPickField).toHaveBeenCalledTimes(1);
    expect(onPickField).toHaveBeenCalledWith("name");
  });

  it("重复的 load 事件不会让一次点击跳两次（监听去重），点空白也不回调", () => {
    const onPickField = vi.fn();
    render(<ResumePreview html={HTML} warnings={[]} onPickField={onPickField} />);

    fireEvent.click(screen.getByRole("checkbox"));

    const iframe = getPreviewFrame();
    const target = paperField(iframe);
    // `onIframeLoad` 在真实浏览器里会因为重渲染与"下一帧补测"被多次触发同一个文档。
    fireEvent.load(iframe);
    fireEvent.load(iframe);

    fireEvent.click(target);
    expect(onPickField).toHaveBeenCalledTimes(1);

    // 点普通文字（模板里没有路径的段落）不跳：误点不该变成一次定位。
    const doc = iframe.contentDocument!;
    const plain = doc.createElement("p");
    plain.textContent = "not a field";
    doc.body.appendChild(plain);
    fireEvent.click(plain);
    expect(onPickField).toHaveBeenCalledTimes(1);
  });

  it("精确模式下复选框禁用（纸面是一张 PDF），切回草稿恢复可用", () => {
    render(<ResumePreview html={HTML} warnings={[]} onPickField={vi.fn()} exactPreview={EXACT} />);

    expect(screen.getByRole("checkbox")).not.toBeDisabled();

    // 不按文案查这两段：文案是硬编码中文，按文案断言会撞上 CJK 棘轮。
    const segments = document.querySelectorAll(".ant-segmented-item");
    expect(segments).toHaveLength(2);
    fireEvent.click(segments[1]);
    expect(screen.getByRole("checkbox")).toBeDisabled();

    fireEvent.click(document.querySelectorAll(".ant-segmented-item")[0]);
    expect(screen.getByRole("checkbox")).not.toBeDisabled();
  });
});

/**
 * 右键加粗：**只在这四种情况之外**劫持原生菜单。
 *
 * 四种"放行"场景必须逐个钉住：它们的共同点是**没有任何可见报错**——用户只是发现"右键复制
 * 不见了"，或者"右键之后弹出个莫名其妙的加粗菜单"。原生菜单一旦被误拦，浏览器提供的复制 /
 * 全选 / 检查元素全部消失，而界面上看不出任何原因。
 */
describe("ResumePreview · 右键加粗的放行场景", () => {
  it("未勾选「草稿模式编辑」：右键交给浏览器", () => {
    const rich = richAdapter();
    render(<ResumePreview html={HTML} warnings={[]} onPickField={vi.fn()} richEdit={rich} />);

    const iframe = getPreviewFrame();
    const field = paperField(iframe);
    selectText(field, 0, 4);

    const event = contextMenuOn(field);
    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(rich.toggle).not.toHaveBeenCalled();
  });

  it("精确预览模式：纸面是一张 PDF，不接管右键", () => {
    const rich = richAdapter();
    render(
      <ResumePreview
        html={HTML}
        warnings={[]}
        previewMode="exact"
        exactPreview={EXACT}
        // 精确模式下草稿画布只是"测量用的尸体"：给了 onMeasure 它才会继续挂载。
        onMeasure={vi.fn()}
        onPickField={vi.fn()}
        richEdit={rich}
      />,
    );
    expect(screen.getByRole("checkbox")).toBeDisabled();

    const iframe = getPreviewFrame();
    const field = paperField(iframe);
    selectText(field, 0, 4);

    const event = contextMenuOn(field);
    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("选区不在带路径的文字里：右键交给浏览器", () => {
    const rich = richAdapter();
    render(<ResumePreview html={HTML} warnings={[]} onPickField={vi.fn()} richEdit={rich} />);
    fireEvent.click(screen.getByRole("checkbox"));

    const doc = paperBody(getPreviewFrame(), "<p class='plain'>not a field</p>");
    const plain = doc.querySelector("p");
    if (!plain?.firstChild) throw new Error("段落未渲染");
    selectText(plain, 0, 3);

    const event = contextMenuOn(plain);
    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("原生 textarea 里的选区：右键交给浏览器", () => {
    const rich = richAdapter();
    render(<ResumePreview html={HTML} warnings={[]} onPickField={vi.fn()} richEdit={rich} />);
    fireEvent.click(screen.getByRole("checkbox"));

    const doc = paperBody(
      getPreviewFrame(),
      "<span data-resume-path='name'><textarea>Alex</textarea></span>",
    );
    const area = doc.querySelector("textarea");
    if (!area?.firstChild) throw new Error("输入框未渲染");
    selectText(area, 0, 4);

    const event = contextMenuOn(area);
    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("ResumePreview · 右键加粗的接管路径", () => {
  it("选中字段内的一段文字后右键：菜单出现，点「加粗」写入标记并即时改纸面", () => {
    const rich = richAdapter();
    render(<ResumePreview html={HTML} warnings={[]} onPickField={vi.fn()} richEdit={rich} />);
    fireEvent.click(screen.getByRole("checkbox"));

    const iframe = getPreviewFrame();
    const field = paperField(iframe);
    selectText(field, 0, 4);

    const event = contextMenuOn(field);
    expect(event.defaultPrevented).toBe(true);

    const menu = screen.getByRole("menu");
    expect(menu).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole("menuitem", { name: t("rich.menu.bold") }));

    expect(rich.toggle).toHaveBeenCalledWith("name", "**Alex**", "Alex");
    // 纸面立刻看到粗体：等整份重渲染要一个网络往返。
    expect(field.innerHTML).toBe("<strong>Alex</strong>");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("选区已经整段加粗：菜单第一项变成「取消加粗」", () => {
    const rich = richAdapter("**Alex**");
    render(<ResumePreview html={HTML} warnings={[]} onPickField={vi.fn()} richEdit={rich} />);
    fireEvent.click(screen.getByRole("checkbox"));

    const iframe = getPreviewFrame();
    const field = paperBody(
      iframe,
      "<span data-resume-path='name'><strong>Alex</strong></span>",
    ).querySelector("[data-resume-path]");
    if (!field) throw new Error("字段未渲染");
    selectText(field, 0, 4);

    contextMenuOn(field);
    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: t("rich.menu.unbold") })).toBeInTheDocument();
  });
});
