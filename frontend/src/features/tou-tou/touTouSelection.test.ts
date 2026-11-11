// SPDX-License-Identifier: Apache-2.0
/**
 * 划词动作的纯函数（#27A）：选区并集、浮条落点（单字符 / 跨段落 / 跨元素）、
 * 区域分类与区域 → 动作映射。三种定位形态都必须在视口内、且距选区 8px。
 */
import { describe, expect, it } from "vitest";
import {
  SELECTION_MENU_GAP,
  SELECTION_VIEWPORT_MARGIN,
  classifySelectionRegion,
  readActiveSelection,
  readFormControlSelection,
  readWindowSelection,
  selectionActionsForRegion,
  selectionAnchorRect,
  selectionMenuPosition,
  toSelectionRect,
  type SelectionRect,
} from "./touTouSelection";

const VIEWPORT = { width: 1_200, height: 800 };
const MENU = { width: 320, height: 44 };

function rect(top: number, left: number, width: number, height: number): SelectionRect {
  return { top, left, right: left + width, bottom: top + height, width, height };
}

describe("选区矩形并集", () => {
  it("单个字符：一个矩形原样返回", () => {
    const anchor = selectionAnchorRect([rect(100, 40, 7, 17)]);
    expect(anchor).toEqual(rect(100, 40, 7, 17));
  });

  it("跨段落：多行矩形取并集（浮条才会落在整段下方）", () => {
    const anchor = selectionAnchorRect([
      rect(100, 40, 300, 20),
      rect(124, 40, 260, 20),
      rect(148, 40, 120, 20),
    ]);
    expect(anchor).toEqual(rect(100, 40, 300, 68));
  });

  it("跨元素：两个不相交的矩形也要覆盖整片选区", () => {
    const anchor = selectionAnchorRect([rect(100, 40, 120, 20), rect(100, 400, 200, 20)]);
    expect(anchor).toEqual(rect(100, 40, 560, 20));
  });

  it("没有矩形 / 全零 caret 返回 null（不显示浮条）", () => {
    expect(selectionAnchorRect([])).toBeNull();
    expect(selectionAnchorRect([rect(100, 40, 0, 0)])).toBeNull();
  });
});

describe("浮条落点（距选区 8px）", () => {
  it("默认在选区下方 8px、水平居中", () => {
    const anchor = rect(100, 400, 100, 20);
    const position = selectionMenuPosition(anchor, VIEWPORT, MENU);
    expect(position.placement).toBe("below");
    expect(position.top - anchor.bottom).toBe(SELECTION_MENU_GAP);
    expect(position.left + MENU.width / 2).toBe(anchor.left + anchor.width / 2);
  });

  it("单字符选区：浮条仍以字符中心对齐，不越出左边界", () => {
    const anchor = rect(100, 2, 7, 17);
    const position = selectionMenuPosition(anchor, VIEWPORT, MENU);
    expect(position.left).toBe(SELECTION_VIEWPORT_MARGIN);
    expect(position.top - anchor.bottom).toBe(SELECTION_MENU_GAP);
  });

  it("跨段落选区：浮条落在并集矩形的下沿 8px 处", () => {
    const anchor =
      selectionAnchorRect([rect(100, 40, 300, 20), rect(124, 40, 260, 20)]) ?? rect(0, 0, 0, 0);
    const position = selectionMenuPosition(anchor, VIEWPORT, MENU);
    expect(position.top - anchor.bottom).toBe(SELECTION_MENU_GAP);
    expect(position.left + MENU.width / 2).toBe(anchor.left + anchor.width / 2);
  });

  it("下方放不下就翻到选区上方 8px", () => {
    const anchor = rect(740, 400, 100, 20);
    const position = selectionMenuPosition(anchor, VIEWPORT, MENU);
    expect(position.placement).toBe("above");
    expect(anchor.top - position.top).toBe(MENU.height + SELECTION_MENU_GAP);
  });

  it("左右都装不下时夹回视口，浮条不越界", () => {
    const anchor = rect(100, 1_100, 80, 20);
    const position = selectionMenuPosition(anchor, VIEWPORT, MENU);
    expect(position.left + MENU.width).toBeLessThanOrEqual(
      VIEWPORT.width - SELECTION_VIEWPORT_MARGIN,
    );
    expect(position.left).toBeGreaterThanOrEqual(SELECTION_VIEWPORT_MARGIN);
  });
});

describe("区域分类（选中文本落在哪）", () => {
  function mount(html: string): HTMLElement {
    const root = document.createElement("div");
    root.innerHTML = html;
    document.body.appendChild(root);
    return root;
  }

  it("剪贴板卡里的文本 → clipboard", () => {
    const root = mount('<div class="tt-clipboard-card"><p id="t">片段</p></div>');
    const node = root.querySelector("#t")?.firstChild ?? null;
    expect(classifySelectionRegion(node)).toBe("clipboard");
    root.remove();
  });

  it("岗位详情正文 → job-description", () => {
    const root = mount('<div class="job-detail-text"><span id="t">要求</span></div>');
    expect(classifySelectionRegion(root.querySelector("#t"))).toBe("job-description");
    root.remove();
  });

  it("简历编辑器（.document-editor / data-document-section）→ resume-experience", () => {
    const root = mount(
      '<div class="document-editor"><section data-document-section="experience"><b id="t">经历</b></section></div>',
    );
    expect(classifySelectionRegion(root.querySelector("#t"))).toBe("resume-experience");
    root.remove();
  });

  it("显式 data-tou-tou-region 覆盖默认判定", () => {
    const root = mount(
      '<div class="document-editor" data-tou-tou-region="job-description"><i id="t">x</i></div>',
    );
    expect(classifySelectionRegion(root.querySelector("#t"))).toBe("job-description");
    root.remove();
  });

  it("普通页面文本 → text", () => {
    const root = mount('<p id="t">随便一段</p>');
    expect(classifySelectionRegion(root.querySelector("#t"))).toBe("text");
    root.remove();
  });
});

describe("区域 → 动作", () => {
  it("简历经历给四个动作：改写 / STAR / 找数字 / 查重复条目", () => {
    expect(selectionActionsForRegion("resume-experience")).toEqual([
      "rewrite",
      "star",
      "numbers",
      "check-duplicates",
    ]);
  });

  it("JD 给：这条要求我够吗 / 提取关键词 / 解释 / 复制", () => {
    expect(selectionActionsForRegion("job-description")).toEqual([
      "jd-match",
      "keywords",
      "explain",
      "copy",
    ]);
  });

  it("剪贴板给：识别填资料 / 复制 / 存资料库", () => {
    expect(selectionActionsForRegion("clipboard")).toEqual(["recognize", "copy", "save-material"]);
  });

  it("任意文本给：解释 / 复制 / 存资料库", () => {
    expect(selectionActionsForRegion("text")).toEqual(["explain", "copy", "save-material"]);
  });
});

describe("读选区", () => {
  it("输入框内选择走 selectionStart/End（window.getSelection 看不到它）", () => {
    const textarea = document.createElement("textarea");
    textarea.value = "熟悉 SQL，有 A/B 测试经验者优先。";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.setSelectionRange(0, 6);
    // jsdom 的控件 rect 全 0，这里补一个真实尺寸（读选区的门槛是"控件可见"）。
    textarea.getBoundingClientRect = () =>
      ({ top: 60, left: 10, right: 410, bottom: 120, width: 400, height: 60 }) as DOMRect;
    const snapshot = readFormControlSelection(window);
    expect(snapshot?.text).toBe("熟悉 SQL");
    expect(snapshot?.rect.top).toBe(60);
    expect(readActiveSelection(window)?.text).toBe("熟悉 SQL");
    textarea.remove();
  });

  it("没有选区时返回 null", () => {
    expect(readWindowSelection(window)).toBeNull();
  });

  it("toSelectionRect 兼容缺 width/height 的 DOMRect 形状", () => {
    expect(toSelectionRect({ top: 1, left: 2, right: 12, bottom: 21 } as DOMRect)).toMatchObject({
      width: 10,
      height: 20,
    });
  });
});
