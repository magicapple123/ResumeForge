import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { replaceSelection } from "./replaceSelection";
import { getSelectionTarget, type SelectionTarget } from "./selectionTarget";

function makeTextarea(value: string): HTMLTextAreaElement {
  const area = document.createElement("textarea");
  area.value = value;
  document.body.append(area);
  return area;
}

/** 选中 `[start, end)` 后取一次目标，模拟用户"鼠标划完 → 点按钮"的那一刻。 */
function select(area: HTMLTextAreaElement, start: number, end: number): SelectionTarget {
  area.focus();
  area.setSelectionRange(start, end);
  const target = getSelectionTarget();
  expect(target).not.toBeNull();
  return target!;
}

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  cleanup();
  document.body.innerHTML = "";
});

describe("replaceSelection（input / textarea）", () => {
  it("替换受控 textarea 后值更新，且只派发一次 input", () => {
    const area = makeTextarea("负责后端接口开发");
    const onInput = vi.fn();
    area.addEventListener("input", onInput);

    const outcome = replaceSelection(select(area, 0, 2), "主导");

    expect(outcome).toEqual({ ok: true });
    expect(area.value).toBe("主导后端接口开发");
    // React 的受控组件靠这一次 input 事件同步状态；多派发会导致重复渲染。
    expect(onInput).toHaveBeenCalledTimes(1);
  });

  it("超过 maxLength 时拒绝替换且一个字都不动", () => {
    const area = makeTextarea("abcd");
    area.maxLength = 4;

    const outcome = replaceSelection(select(area, 0, 4), "很长的一段改写");

    expect(outcome).toEqual({ ok: false, reason: "maxLength" });
    expect(area.value).toBe("abcd");
  });

  it("元素已经从文档里移除时如实返回 detached", () => {
    const area = makeTextarea("负责后端接口开发");
    const target = select(area, 0, 2);
    area.remove();

    expect(replaceSelection(target, "主导")).toEqual({ ok: false, reason: "detached" });
  });

  it("结果与原文一致时不重复派发 input", () => {
    const area = makeTextarea("负责后端接口开发");
    const onInput = vi.fn();
    area.addEventListener("input", onInput);

    const outcome = replaceSelection(select(area, 0, 2), "负责");

    expect(outcome).toEqual({ ok: true });
    expect(area.value).toBe("负责后端接口开发");
    expect(onInput).not.toHaveBeenCalled();
  });
});

describe("replaceSelection（contenteditable）", () => {
  it("替换选中片段并把光标收到结果之后", () => {
    const host = document.createElement("div");
    host.setAttribute("contenteditable", "true");
    host.textContent = "负责后端接口开发";
    document.body.append(host);

    const range = document.createRange();
    range.setStart(host.firstChild!, 0);
    range.setEnd(host.firstChild!, 2);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    const target = getSelectionTarget();
    expect(target?.kind).toBe("contenteditable");

    const outcome = replaceSelection(target!, "主导");

    expect(outcome).toEqual({ ok: true });
    expect(host.textContent).toBe("主导后端接口开发");
    // 光标收在结果之后（折叠状态），用户可以接着往下敲。
    expect(selection.isCollapsed).toBe(true);
    expect(selection.toString()).toBe("");
  });
});
