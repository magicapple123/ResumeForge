// SPDX-License-Identifier: Apache-2.0
/**
 * #21：制作台历史的三条判据。
 *
 * - 21a 离散操作（条目排版开关）立即入栈，不等 300ms 合并窗口；
 * - 21b 标签按操作类型取：条目排版 → 「调整条目排版」，不再一律「编辑正文」；
 * - 21c 无变化的写入（mutator 返回原引用）不产生历史点；
 * - 21a 附件：连续文本输入仍按 300ms 合并成一步（既有行为不能回退）。
 *
 * 文本类断言用「已提交的 past 标签」，i18n 在测试环境默认 zh-CN。
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResumeDocument } from "../../types/resumeDocument";
import { useWorkbenchV2History } from "./useWorkbenchV2History";

function docWithEntry(headLayout?: { head: "split" | "stacked" }): ResumeDocument {
  return {
    version: 2,
    language: "zh-CN",
    header: { items: [], contact_breaks: [] },
    sections: [
      {
        key: "experience",
        title: "",
        hidden: false,
        layout: {},
        entries: [
          {
            id: "ent1",
            hidden: false,
            layout: headLayout ? { ...headLayout } : {},
            items: [
              {
                kind: "field",
                id: "f1",
                key: "position",
                label: "",
                value: "用户增长分析师",
                format: "text",
                placement: "title",
              },
            ],
          },
        ],
      },
    ],
  } as unknown as ResumeDocument;
}

describe("useWorkbenchV2History #21", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("21a/21b：条目排版改动立即入栈，标签是「调整条目排版」", () => {
    const initial = docWithEntry();
    const { result } = renderHook(() => useWorkbenchV2History({ document: initial }));
    const changed = docWithEntry({ head: "stacked" });
    act(() => {
      result.current.recordDraft(changed);
    });
    // 不推进时钟：离散操作必须立刻可见
    const { past } = result.current.historyTab;
    expect(past).toHaveLength(1);
    expect(past[0].label).toBe("调整条目排版");
  });

  it("21a 附件：连续文本输入仍按 300ms 合并，标签是「编辑正文」", () => {
    const initial = docWithEntry();
    const { result } = renderHook(() => useWorkbenchV2History({ document: initial }));
    const typed: ResumeDocument = {
      ...initial,
      sections: [
        {
          ...initial.sections[0],
          entries: [
            {
              ...initial.sections[0].entries[0],
              items: [
                {
                  ...initial.sections[0].entries[0].items[0],
                  kind: "field",
                  value: "用户增长分析专家",
                },
              ],
            },
          ],
        },
      ],
    } as ResumeDocument;
    act(() => {
      result.current.recordDraft(typed);
    });
    // 300ms 内：还没入栈（合并窗口）
    expect(result.current.historyTab.past).toHaveLength(0);
    act(() => {
      vi.advanceTimersByTime(301);
    });
    const { past } = result.current.historyTab;
    expect(past).toHaveLength(1);
    expect(past[0].label).toBe("编辑正文");
  });

  it("21c：传入同一文档引用（无变化）不产生历史点", () => {
    const initial = docWithEntry();
    const { result } = renderHook(() => useWorkbenchV2History({ document: initial }));
    act(() => {
      result.current.recordDraft(initial);
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(result.current.historyTab.past).toHaveLength(0);
  });

  it("21a：历史页签的 flush 把挂起的文本改动立即落地", () => {
    const initial = docWithEntry();
    const { result } = renderHook(() => useWorkbenchV2History({ document: initial }));
    const typed: ResumeDocument = {
      ...initial,
      sections: [
        {
          ...initial.sections[0],
          entries: [
            {
              ...initial.sections[0].entries[0],
              items: [
                {
                  ...initial.sections[0].entries[0].items[0],
                  kind: "field",
                  value: "高级分析师",
                },
              ],
            },
          ],
        },
      ],
    } as ResumeDocument;
    act(() => {
      result.current.recordDraft(typed);
    });
    expect(result.current.historyTab.past).toHaveLength(0);
    act(() => {
      result.current.historyTab.flush?.();
    });
    expect(result.current.historyTab.past).toHaveLength(1);
    expect(result.current.historyTab.past[0].label).toBe("编辑正文");
  });
});
