// SPDX-License-Identifier: Apache-2.0
/**
 * 点击落点 → 纯文本下标（T01）。
 *
 * 只测纯函数：`caretRangeFromPoint` 在 jsdom 里不存在，所以这里桩掉它，验证
 * "节点 + 节点内偏移 → 顺序累加下标"这段映射；真实的浏览器路径由实机截图/量测覆盖。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { clickOffsetFromPoint, textOffsetOf } from "./inlineMarkClickOffset";

/** 桩对象当字典用：jsdom 没有这两个 API，TS 的 DOM 类型也不允许随便删。 */
type CaretStub = Record<string, unknown>;

function stubDocument(): CaretStub {
  return document as unknown as CaretStub;
}

function mount(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

afterEach(() => {
  document.body.innerHTML = "";
  Reflect.deleteProperty(document, "caretRangeFromPoint");
  Reflect.deleteProperty(document, "caretPositionFromPoint");
});

describe("textOffsetOf", () => {
  it("按文本节点顺序累加：第二段第 2 个字 = 2 + 2", () => {
    const root = mount("<span>ab</span><span>cde</span>");
    const second = root.querySelectorAll("span")[1].firstChild as Text;
    expect(textOffsetOf(root, second, 2)).toBe(4);
  });

  it("落在元素节点上返回 null（那是'第几个子节点'，不是'第几个字'）", () => {
    const root = mount("<span>ab</span>");
    expect(textOffsetOf(root, root, 0)).toBeNull();
  });

  it("偏移越界时夹到该文本节点长度内", () => {
    const root = mount("<span>ab</span>");
    const text = root.querySelector("span")!.firstChild as Text;
    expect(textOffsetOf(root, text, 99)).toBe(2);
  });
});

describe("clickOffsetFromPoint", () => {
  it("caretRangeFromPoint 命中文本节点 → 返回对应下标", () => {
    const root = mount("<span>ab</span><span>cde</span>");
    const target = root.querySelectorAll("span")[1].firstChild as Text;
    stubDocument().caretRangeFromPoint = () => {
      const range = document.createRange();
      range.setStart(target, 1);
      range.collapse(true);
      return range;
    };
    expect(clickOffsetFromPoint(root, 10, 10)).toBe(3);
  });

  it("API 不存在（jsdom / 老浏览器）→ null，由调用方落末尾", () => {
    const root = mount("<span>ab</span>");
    expect(clickOffsetFromPoint(root, 10, 10)).toBeNull();
  });

  it("回落的 caretPositionFromPoint 也能用", () => {
    const root = mount("<span>ab</span>");
    const target = root.querySelector("span")!.firstChild as Text;
    stubDocument().caretPositionFromPoint = () => ({ offsetNode: target, offset: 2 });
    expect(clickOffsetFromPoint(root, 1, 1)).toBe(2);
  });

  it("点在内边距上（回的是容器自身）→ null", () => {
    const root = mount("<span>ab</span>");
    stubDocument().caretRangeFromPoint = () => {
      const range = document.createRange();
      range.setStart(root, 0);
      range.collapse(true);
      return range;
    };
    expect(clickOffsetFromPoint(root, 1, 1)).toBeNull();
  });

  it("API 抛错时不冒泡（返回 null）", () => {
    const root = mount("<span>ab</span>");
    stubDocument().caretRangeFromPoint = () => {
      throw new Error("boom");
    };
    const spy = vi.fn();
    let result: number | null = -1;
    try {
      result = clickOffsetFromPoint(root, 1, 1);
    } catch {
      spy();
    }
    expect(spy).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });
});
