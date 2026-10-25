// SPDX-License-Identifier: Apache-2.0
/** W03：useResumeDocument —— 命令 → 历史点 → 撤销/恢复；换记录清栈；保存失败不清栈（由调用方决定）。 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResumeContent, ResumeLayout } from "../../types";
import { useResumeDocument } from "./useResumeDocument";

const CONTENT: ResumeContent = {
  photo: "",
  name: "Alex",
  gender: "",
  birth_year: "",
  phone: "",
  email: "",
  city: "",
  personal_website: "",
  github: "",
  job_intent: "Backend",
  summary: "",
  education: [],
  experience: [],
  campus_experience: [],
  projects: [],
  skills: [],
  awards: [],
};

const LAYOUT: ResumeLayout = {
  template: "classic",
  format_name: "",
  page_limit: 1,
  font_scale: "standard",
  language: "zh-CN",
};

/** 这一组用例只验证 content+layout；overlay 为空即"没有未保存的粗体"。 */
const OVERLAYS = {};

function setup(resetKey?: unknown) {
  return renderHook(
    ({ key }: { key?: unknown }) =>
      useResumeDocument({
        initial: { content: CONTENT, layout: LAYOUT, overlays: OVERLAYS },
        resetKey: key,
      }),
    { initialProps: { key: resetKey } },
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useResumeDocument · 命令与历史", () => {
  it("一次命令 = 一个历史点；撤销/恢复回到前后状态", () => {
    const { result } = setup();
    act(() => {
      expect(result.current.dispatch({ kind: "set-text", path: "name", text: "Bob" })).toBe(true);
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current.content.name).toBe("Bob");
    expect(result.current.canUndo).toBe(true);

    act(() => {
      expect(result.current.undo()).toBe(true);
    });
    expect(result.current.content.name).toBe("Alex");
    expect(result.current.canRedo).toBe(true);

    act(() => {
      expect(result.current.redo()).toBe(true);
    });
    expect(result.current.content.name).toBe("Bob");
  });

  it("同路径连续输入合并成一个历史点", () => {
    const { result } = setup();
    act(() => {
      result.current.dispatch({ kind: "set-text", path: "name", text: "A1" });
      vi.advanceTimersByTime(100);
      result.current.dispatch({ kind: "set-text", path: "name", text: "A2" });
      vi.advanceTimersByTime(300);
    });
    act(() => {
      result.current.undo();
    });
    // 中间态 A1 不占历史点：一次撤回回到打开时。
    expect(result.current.content.name).toBe("Alex");
    expect(result.current.canUndo).toBe(false);
  });

  it("改另一个字段会先落地上一步：两次撤销各退一步", () => {
    const { result } = setup();
    act(() => {
      result.current.dispatch({ kind: "set-text", path: "name", text: "Bob" });
      result.current.dispatch({ kind: "set-text", path: "summary", text: "hi" });
      vi.advanceTimersByTime(300);
    });
    act(() => {
      result.current.undo();
    });
    expect(result.current.content.summary).toBe("");
    expect(result.current.content.name).toBe("Bob");
    act(() => {
      result.current.undo();
    });
    expect(result.current.content.name).toBe("Alex");
  });

  it("版式变化合并成一步，撤销恢复版式与正文各自独立", () => {
    const { result } = setup();
    act(() => {
      result.current.setLayout({ ...LAYOUT, page_limit: 2 });
      vi.advanceTimersByTime(100);
      result.current.setLayout({ ...LAYOUT, page_limit: 3 });
      vi.advanceTimersByTime(300);
    });
    expect(result.current.layout.page_limit).toBe(3);
    act(() => {
      result.current.undo();
    });
    expect(result.current.layout.page_limit).toBe(1);
    expect(result.current.content.name).toBe("Alex");
  });

  it("no-op 命令返回 false 且不制造历史点", () => {
    const { result } = setup();
    act(() => {
      expect(result.current.dispatch({ kind: "set-text", path: "name", text: "Alex" })).toBe(false);
      vi.advanceTimersByTime(300);
    });
    expect(result.current.canUndo).toBe(false);
  });

  it("保存失败不清栈（本 hook 没有 clear 入口，只有 reset）", () => {
    const { result } = setup();
    act(() => {
      result.current.dispatch({ kind: "set-text", path: "name", text: "Bob" });
      vi.advanceTimersByTime(300);
    });
    // 模拟保存失败：调用方什么都不做 → 历史与内容原样保留，用户可继续撤回。
    expect(result.current.canUndo).toBe(true);
    expect(result.current.content.name).toBe("Bob");
  });
});

describe("useResumeDocument · 换记录", () => {
  it("resetKey 变化时清栈并以当前文档为新基线", () => {
    const { result, rerender } = setup("record-a");
    act(() => {
      result.current.dispatch({ kind: "set-text", path: "name", text: "Bob" });
      vi.advanceTimersByTime(300);
    });
    expect(result.current.canUndo).toBe(true);
    rerender({ key: "record-b" });
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it("reset 显式清栈（用最新的 / 草稿恢复）", () => {
    const { result } = setup();
    act(() => {
      result.current.dispatch({ kind: "set-text", path: "name", text: "Bob" });
      vi.advanceTimersByTime(300);
    });
    act(() => {
      result.current.reset({
        content: { ...CONTENT, name: "Server" },
        layout: LAYOUT,
        overlays: OVERLAYS,
      });
    });
    expect(result.current.content.name).toBe("Server");
    expect(result.current.canUndo).toBe(false);
  });

  it("replaceDocument 默认独立成步（结构命令不被并进上一次打字）", () => {
    const { result } = setup();
    act(() => {
      result.current.dispatch({ kind: "set-text", path: "name", text: "Bob" });
    });
    act(() => {
      result.current.replaceDocument({
        content: { ...CONTENT, name: "Bob", summary: "structure" },
        layout: LAYOUT,
        overlays: OVERLAYS,
      });
      vi.advanceTimersByTime(300);
    });
    act(() => {
      result.current.undo();
    });
    // 结构步骤被撤销后，打字那一步仍在（两次编辑没有合并）。
    expect(result.current.content.summary).toBe("");
    expect(result.current.content.name).toBe("Bob");
  });

  it("overlay 与正文一起进快照：撤销清空、恢复还原（W02/W03）", () => {
    const { result } = setup();
    const overlays = { name: { raw: "**Bob**", base: "Bob" } };
    act(() => {
      result.current.replaceDocument({
        content: { ...CONTENT, name: "Bob" },
        layout: LAYOUT,
        overlays,
      });
      vi.advanceTimersByTime(300);
    });
    expect(result.current.overlays).toEqual(overlays);

    act(() => {
      result.current.undo();
    });
    expect(result.current.content.name).toBe("Alex");
    expect(result.current.overlays).toEqual({});

    act(() => {
      result.current.redo();
    });
    expect(result.current.content.name).toBe("Bob");
    expect(result.current.overlays).toEqual(overlays);
  });
});
