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
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ResumePreview from "./ResumePreview";
import { CLICK_TO_EDIT_CLASS, CLICK_TO_EDIT_STYLE_ID } from "./resume-preview/clickToEdit";
import { clearPreviewCache } from "./resume-preview/exactPreviewCache";

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
