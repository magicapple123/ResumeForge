// SPDX-License-Identifier: Apache-2.0
/**
 * 加粗 overlay 的**受控模式**（W02/W03 收口）：宿主持有唯一一份，hook 只算下一份是什么。
 *
 * 为什么单测这一层：制作台的撤销/恢复靠"宿主 state 真的变了"来记历史点，如果受控模式还在
 * 内部偷偷 setState，宿主与快照就会各持一份，撤销时表现成"纸面变了、历史没动"（或反过来）。
 * 断言只碰纯数据与回调，不渲染任何界面。
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ResumeContent } from "../../types";
import { useRichTextOverrides, type RichTextOverlayMap } from "./useRichTextOverrides";

function makeContent(): ResumeContent {
  return {
    photo: "data:image/png;base64,AAAA",
    name: "Alex",
    gender: "",
    birth_year: "",
    phone: "",
    email: "",
    city: "",
    personal_website: "",
    github: "",
    job_intent: "",
    summary: "plain summary",
    education: [],
    experience: [],
    campus_experience: [],
    projects: [],
    skills: [],
    awards: [],
  };
}

describe("useRichTextOverrides · 受控模式", () => {
  it("apply 把下一份交给宿主（onChange），不保留内部状态", () => {
    const content = makeContent();
    const onChange = vi.fn();
    const { result } = renderHook(() => useRichTextOverrides(content, { overlays: {}, onChange }));

    let merged: ResumeContent | null = null;
    act(() => {
      merged = result.current.apply("summary", "**plain** summary", "plain summary");
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toEqual({
      summary: { raw: "**plain** summary", base: "plain summary" },
    });
    // 返回值仍是"叠加后"的内容：同一次点击里保存/预览要立刻可用。
    expect((merged as unknown as ResumeContent).summary).toBe("**plain** summary");
    // 受控模式的当前值来自 props：宿主还没更新时它仍是空的。
    expect(result.current.dirty).toBe(false);
  });

  it("宿主更新 overlays 后，read / merged 立即跟着走（没有第二份 state）", () => {
    const content = makeContent();
    const { result, rerender } = renderHook(
      ({ overlays }: { overlays: RichTextOverlayMap }) =>
        useRichTextOverrides(content, { overlays, onChange: vi.fn() }),
      { initialProps: { overlays: {} as RichTextOverlayMap } },
    );
    expect(result.current.read("summary")).toBe("plain summary");

    rerender({ overlays: { summary: { raw: "**plain** summary", base: "plain summary" } } });
    expect(result.current.read("summary")).toBe("**plain** summary");
    expect(result.current.merged?.summary).toBe("**plain** summary");
    expect(result.current.dirty).toBe(true);
  });

  it("clear 与 remapPaths 都只走 onChange（键随结构换下标）", () => {
    const content = makeContent();
    const onChange = vi.fn();
    const initial: RichTextOverlayMap = {
      "experience.1.description.0": { raw: "**b**", base: "b" },
    };
    const { result } = renderHook(() =>
      useRichTextOverrides(content, { overlays: initial, onChange }),
    );

    act(() => {
      result.current.remapPaths(
        new Map([["experience.1.description.0", "experience.0.description.0"]]),
      );
    });
    expect(onChange).toHaveBeenLastCalledWith({
      "experience.0.description.0": { raw: "**b**", base: "b" },
    });

    act(() => result.current.clear());
    expect(onChange).toHaveBeenLastCalledWith({});
  });
});
