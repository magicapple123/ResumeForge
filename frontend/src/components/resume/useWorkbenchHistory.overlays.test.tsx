// SPDX-License-Identifier: Apache-2.0
/**
 * W02/W03 收口验收：**纸面加粗进统一历史**。
 *
 * 审计口径（§三 W02/W03）：overlay 由 `ResumeDetailModal` 的 `useRichTextOverrides` 独立持有，
 * `useResumeDocument` 的快照只有 `{content, layout}`，所以撤销退不回粗体、历史面板也看不到
 * "加粗"这一步。这一组用例从 hook 的公开输出上钉住修复后的四条性质：
 *
 * 1. 加粗 → 撤销 → 粗体消失；恢复 → 粗体回来（快照含 overlays）；
 * 2. 正文 + 排版 + 加粗混合 10 步，连续撤销回初态、恢复回末态（三者一起回）；
 * 3. 保存失败（宿主 props 原样）不清栈；
 * 4. 历史面板出现「加粗」步骤；旧记录（没有 overlays）加载与编辑无回归。
 *
 * 断言文案一律走 `t()`：`cjkRatchet` 的 tests 口径逐文件卡中文 `*ByText`。
 */
import { App as AntdApp } from "antd";
import { act, render, renderHook, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import type { ResumeContent, ResumeLayout } from "../../types";
import type { RichTextOverlayMap } from "../../features/resume/useRichTextOverrides";
import type { ResumeWorkbenchEditorHandle } from "./ResumeWorkbenchEditorColumn";
import HistoryPanel from "./history/HistoryPanel";
import { useWorkbenchHistory } from "./useWorkbenchHistory";

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
  summary: "hi",
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

/** 与制作台同形的最小宿主：overlay 与 layout 都住在"宿主"这一层，历史只读取/回写。 */
function useHarness(initial?: RichTextOverlayMap) {
  const [layout, setLayout] = useState<ResumeLayout>(LAYOUT);
  const [overlays, setOverlays] = useState<RichTextOverlayMap>(initial ?? {});
  const [content, setContent] = useState<ResumeContent>(CONTENT);
  const editorRef = {
    current: { replaceContent: vi.fn() } as unknown as ResumeWorkbenchEditorHandle,
  };
  const history = useWorkbenchHistory({
    resumeId: 42,
    content,
    layout,
    onApplyLayout: setLayout,
    editorRef,
    overlays,
    onOverlaysChange: setOverlays,
  });
  return { history, overlays, layout, content, setContent, setOverlays };
}

/** 旧记录 / 没有加粗能力的宿主：完全没有 overlay 绑定（overlays 与回写口都不传）。 */
function useLegacyHarness() {
  const [layout, setLayout] = useState<ResumeLayout>(LAYOUT);
  const editorRef = {
    current: { replaceContent: vi.fn() } as unknown as ResumeWorkbenchEditorHandle,
  };
  const history = useWorkbenchHistory({
    resumeId: 7,
    content: CONTENT,
    layout,
    onApplyLayout: setLayout,
    editorRef,
  });
  return { history, layout };
}

function commit(): void {
  act(() => {
    vi.advanceTimersByTime(300);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("纸面加粗进统一历史（W02/W03）", () => {
  it("加粗 → 撤销：粗体消失；恢复：粗体回来", () => {
    const { result } = renderHook(() => useHarness());

    act(() => {
      result.current.history.applyOverlay("name", "**Alex**", "Alex");
    });
    commit();
    expect(result.current.overlays).toEqual({ name: { raw: "**Alex**", base: "Alex" } });
    expect(result.current.history.historyTab.past.map((step) => step.label)).toContain(
      t("workbench.history.label.bold"),
    );

    act(() => result.current.history.historyTab.onUndo());
    expect(result.current.overlays).toEqual({});
    expect(result.current.history.historyTab.canRedo).toBe(true);

    act(() => result.current.history.historyTab.onRedo());
    expect(result.current.overlays).toEqual({ name: { raw: "**Alex**", base: "Alex" } });
  });

  it("连续加粗（300ms 内）合并成一步，不按每处加粗碎步", () => {
    const { result } = renderHook(() => useHarness());
    act(() => {
      result.current.history.applyOverlay("name", "**Alex**", "Alex");
      result.current.history.applyOverlay("summary", "**hi**", "hi");
    });
    commit();

    expect(result.current.history.historyTab.past).toHaveLength(1);
    expect(result.current.history.historyTab.past[0].label).toBe(t("workbench.history.label.bold"));
    expect(result.current.overlays).toEqual({
      name: { raw: "**Alex**", base: "Alex" },
      summary: { raw: "**hi**", base: "hi" },
    });
  });

  it("正文 + 排版 + 加粗混合 10 步：撤销回初态，恢复回末态（三者一致）", () => {
    const { result } = renderHook(() => useHarness());

    // 5 步正文。
    for (let step = 1; step <= 5; step += 1) {
      act(() => result.current.history.recordDraft({ ...CONTENT, name: `Alex ${step}` }));
      commit();
    }
    // 3 步加粗（中间隔开 300ms，各成一步）。
    act(() => result.current.history.applyOverlay("name", "**Alex 5**", "Alex 5"));
    commit();
    act(() => result.current.history.applyOverlay("summary", "**hi**", "hi"));
    commit();
    act(() => result.current.history.applyOverlay("job_intent", "**Backend**", "Backend"));
    commit();
    // 1 步版式 + 1 步正文。
    act(() => result.current.history.recordLayout({ ...LAYOUT, page_limit: 2 }));
    commit();
    act(() => result.current.history.recordDraft({ ...CONTENT, name: "Alex 6", summary: "hi" }));
    commit();

    const finalOverlays = result.current.overlays;
    const finalLayout = result.current.layout;
    expect(Object.keys(finalOverlays)).toHaveLength(3);
    expect(finalLayout.page_limit).toBe(2);

    let undoCount = 0;
    while (result.current.history.historyTab.canUndo && undoCount < 20) {
      act(() => result.current.history.historyTab.onUndo());
      undoCount += 1;
    }
    expect(undoCount).toBe(10);
    expect(result.current.history.content.name).toBe("Alex");
    expect(result.current.overlays).toEqual({});
    expect(result.current.layout).toEqual(LAYOUT);

    let redoCount = 0;
    while (result.current.history.historyTab.canRedo && redoCount < 20) {
      act(() => result.current.history.historyTab.onRedo());
      redoCount += 1;
    }
    expect(redoCount).toBe(10);
    expect(result.current.history.content.name).toBe("Alex 6");
    expect(result.current.overlays).toEqual(finalOverlays);
    expect(result.current.layout.page_limit).toBe(2);
  });

  it("保存失败（宿主 props 原样重渲染）不清栈：仍能继续撤销", () => {
    const { result, rerender } = renderHook(() => useHarness());
    act(() => result.current.history.recordDraft({ ...CONTENT, name: "Alex 1" }));
    commit();
    act(() => result.current.history.applyOverlay("name", "**Alex 1**", "Alex 1"));
    commit();
    const stepsBefore = result.current.history.historyTab.past.length;
    expect(stepsBefore).toBe(2);

    // 模拟保存失败：宿主只重渲染（等值但新引用的正文），没有新的服务端内容 → 历史必须原样。
    rerender();
    expect(result.current.history.historyTab.past.length).toBe(stepsBefore);
    expect(result.current.history.historyTab.canUndo).toBe(true);
    act(() => result.current.history.historyTab.onUndo());
    expect(result.current.overlays).toEqual({});
  });

  it("历史面板能看到「加粗」步骤", () => {
    const { result } = renderHook(() => useHarness());
    act(() => result.current.history.applyOverlay("name", "**Alex**", "Alex"));
    commit();

    render(
      <AntdApp>
        <HistoryPanel {...result.current.history.historyTab} />
      </AntdApp>,
    );
    expect(screen.getByText(t("workbench.history.label.bold"))).toBeInTheDocument();
  });

  it("旧记录（没有 overlays 绑定）加载与编辑无回归：撤销仍有效", () => {
    const { result } = renderHook(() => useLegacyHarness());
    // 没有加粗能力/旧记录：overlay 恒为空对象，不因 undefined 抛错，也不产生"加粗"步骤。
    act(() => result.current.history.recordDraft({ ...CONTENT, name: "Old Record" }));
    commit();
    expect(result.current.history.historyTab.past.map((step) => step.label)).not.toContain(
      t("workbench.history.label.bold"),
    );
    act(() => result.current.history.historyTab.onUndo());
    expect(result.current.history.content.name).toBe("Alex");
  });
});
