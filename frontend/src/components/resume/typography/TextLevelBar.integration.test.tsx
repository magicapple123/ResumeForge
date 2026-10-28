// SPDX-License-Identifier: Apache-2.0
/**
 * W07-TL 的**宿主集成**：两根真实接线，不是组件自证。
 *
 * 1. **撤销 / 历史一步**：`onChange` 接的是制作台的 `useWorkbenchHistory.recordLayout`
 *    （W03 唯一历史）。一次应用 = 一个历史点；撤销后 layout 回到应用前、级别显示回到
 *    "跟随模板"；恢复（redo）级别回来。
 * 2. **预览样式跟随**：layout 变化经 `useResumeLivePreview` 触发重排请求，请求里带的
 *    就是含 `format_config.objects[<id>]` 的新版式——后端渲染器据此产出
 *    `[data-object-id]` CSS（`entry_style_css`，已有后端用例覆盖）。
 *
 * 断言文案走 `t()`（cjkRatchet 的 tests 口径）；时间性质用假定时器，不靠墙钟。
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import type { ResumeContent, ResumeLayout } from "../../../types";
import { useResumeLivePreview } from "../../../features/resume/useResumeLivePreview";
import type { ResumeWorkbenchEditorHandle } from "../ResumeWorkbenchEditorColumn";
import { useWorkbenchHistory } from "../useWorkbenchHistory";
import TextLevelBar from "./TextLevelBar";

const OBJ_A = "exp_12345678";
const OBJ_B = "prj_87654321";
const TARGETS = [{ id: OBJ_A }, { id: OBJ_B }];

const LAYOUT: ResumeLayout = {
  template: "classic",
  format_name: "",
  page_limit: 1,
  font_scale: "standard",
  language: "zh-CN",
};

const CONTENT: ResumeContent = {
  photo: "",
  name: "AL",
  gender: "",
  birth_year: "",
  phone: "",
  email: "",
  city: "",
  personal_website: "",
  github: "",
  job_intent: "",
  summary: "",
  education: [],
  experience: [],
  campus_experience: [],
  projects: [],
  skills: [],
  awards: [],
};

function levelButton(label: string) {
  return screen.getByRole("button", { name: new RegExp(`^${label.split("").join("\\s*")}$`) });
}

function objectsOf(text: string | null): Record<string, Record<string, unknown>> {
  const raw = JSON.parse(text || "{}") as { objects?: Record<string, Record<string, unknown>> };
  const entries: Record<string, Record<string, unknown>> = {};
  for (const [key, value] of Object.entries(raw.objects ?? {})) {
    if (key === "version") continue;
    entries[key] = value;
  }
  return entries;
}

function currentText(levelLabel: string) {
  return t("typography.level.current", { level: levelLabel });
}

/** 作用范围 Segmented 的四个单选（顺序 = TEXT_LEVEL_SCOPES：整条目 / 条目标题 / 正文 / 说明）。 */
function scopeRadios() {
  const group = screen.getByRole("radiogroup", { name: t("typography.level.scope.aria") });
  return within(group).getAllByRole("radio");
}

/** 与制作台同形的最小宿主：layout 住宿主，历史只负责记快照/回写。 */
function HistoryHost() {
  const [layout, setLayout] = useState<ResumeLayout>(LAYOUT);
  const editorRef = useRef({
    replaceContent: vi.fn(),
  } as unknown as ResumeWorkbenchEditorHandle);
  const history = useWorkbenchHistory({
    resumeId: 42,
    content: CONTENT,
    layout,
    onApplyLayout: setLayout,
    editorRef,
  });
  return (
    <div>
      <output data-testid="past">{history.historyTab.past.length}</output>
      <output data-testid="layout">{JSON.stringify(layout.format_config)}</output>
      <button type="button" onClick={history.historyTab.onUndo}>
        undo
      </button>
      <button type="button" onClick={history.historyTab.onRedo}>
        redo
      </button>
      <TextLevelBar
        layout={layout}
        selected={TARGETS}
        selectedObjectId={null}
        onChange={history.recordLayout}
      />
    </div>
  );
}

/** 实时预览宿主：layout 一变就在防抖后发一次 render（真实 hook，不 mock）。 */
function PreviewHost({ onRender }: { onRender: (layout: ResumeLayout) => void }) {
  const [layout, setLayout] = useState<ResumeLayout>(LAYOUT);
  const [html, setHtml] = useState("<html></html>");
  useResumeLivePreview({
    enabled: true,
    content: CONTENT,
    layout,
    render: async (_content, next) => {
      onRender(next);
      return "<html></html>";
    },
    onHtml: setHtml,
  });
  return (
    <div>
      <output data-testid="html">{html}</output>
      <TextLevelBar
        layout={layout}
        selected={TARGETS}
        selectedObjectId={null}
        onChange={setLayout}
      />
    </div>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("文字级别 · 撤销/恢复（W03 历史一步）", () => {
  it("应用级别 → 一个历史点；撤销回到应用前；恢复级别回来", () => {
    render(<HistoryHost />);
    expect(screen.getByTestId("past").textContent).toBe("0");

    fireEvent.click(levelButton(t("typography.level.heading1")));
    // 历史按 300ms 合并窗口落地：一次应用 = 一个历史点。
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByTestId("past").textContent).toBe("1");
    expect(objectsOf(screen.getByTestId("layout").textContent)[OBJ_A]).toMatchObject({
      font_scale: 1.4,
      bold: true,
    });
    expect(objectsOf(screen.getByTestId("layout").textContent)[OBJ_B]).toMatchObject({
      font_scale: 1.4,
    });

    fireEvent.click(screen.getByRole("button", { name: "undo" }));
    expect(objectsOf(screen.getByTestId("layout").textContent)).toEqual({});
    expect(screen.getByText(currentText(t("typography.level.currentInherit")))).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "redo" }));
    expect(objectsOf(screen.getByTestId("layout").textContent)[OBJ_A]).toMatchObject({
      font_scale: 1.4,
      bold: true,
    });
  });

  it("恢复跟随模板也是一步历史：撤销能把级别改回来", () => {
    render(<HistoryHost />);
    fireEvent.click(levelButton(t("typography.level.heading2")));
    act(() => {
      vi.advanceTimersByTime(300);
    });
    fireEvent.click(screen.getByRole("button", { name: t("typography.level.restore") }));
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByTestId("past").textContent).toBe("2");
    expect(objectsOf(screen.getByTestId("layout").textContent)).toEqual({});

    fireEvent.click(screen.getByRole("button", { name: "undo" }));
    expect(objectsOf(screen.getByTestId("layout").textContent)[OBJ_A]).toMatchObject({
      font_scale: 1.2,
      bold: true,
    });
  });

  it("字段范围应用 / 恢复也各是一步历史，且只写 object_roles", () => {
    render(<HistoryHost />);
    fireEvent.click(scopeRadios()[2]);
    fireEvent.click(levelButton(t("typography.level.heading1")));
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByTestId("past").textContent).toBe("1");
    const applied = JSON.parse(screen.getByTestId("layout").textContent ?? "{}") as {
      objects?: Record<string, unknown>;
      object_roles?: Record<string, Record<string, unknown>>;
    };
    expect(applied.objects ?? {}).toEqual({});
    expect(applied.object_roles?.[`${OBJ_A}:body`]).toMatchObject({
      font_scale: 1.4,
      bold: true,
    });

    fireEvent.click(screen.getByRole("button", { name: t("typography.level.restore") }));
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByTestId("past").textContent).toBe("2");
    expect(JSON.parse(screen.getByTestId("layout").textContent ?? "{}")).toEqual({});
    expect(screen.getByText(currentText(t("typography.level.currentInherit")))).toBeInTheDocument();

    // 撤销恢复 → 字段范围级别回来（历史里存的是同一份 format_config）。
    fireEvent.click(screen.getByRole("button", { name: "undo" }));
    expect(
      (
        JSON.parse(screen.getByTestId("layout").textContent ?? "{}") as {
          object_roles?: Record<string, Record<string, unknown>>;
        }
      ).object_roles?.[`${OBJ_A}:body`],
    ).toMatchObject({ font_scale: 1.4, bold: true });
  });
});

describe("文字级别 · 预览样式跟随", () => {
  it("应用级别后实时预览用含对象覆盖的新版式重排", async () => {
    const rendered: ResumeLayout[] = [];
    render(<PreviewHost onRender={(next) => rendered.push(next)} />);
    // 首帧只记基线（宿主刚渲染过同一份），不发请求。
    await act(async () => {
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
    });
    expect(rendered).toHaveLength(0);

    fireEvent.click(levelButton(t("typography.level.heading1")));
    await act(async () => {
      vi.advanceTimersByTime(600);
      await Promise.resolve();
    });

    expect(rendered).toHaveLength(1);
    const formatConfig = rendered[0].format_config as unknown as {
      objects?: Record<string, Record<string, unknown>>;
    };
    expect(objectsOf(JSON.stringify(formatConfig))[OBJ_A]).toMatchObject({
      font_scale: 1.4,
      bold: true,
      space_before: 0.4,
      space_after: 0.2,
    });
  });

  it("字段范围应用后实时预览用含 object_roles 的新版式重排", async () => {
    const rendered: ResumeLayout[] = [];
    render(<PreviewHost onRender={(next) => rendered.push(next)} />);
    await act(async () => {
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
    });
    expect(rendered).toHaveLength(0);

    fireEvent.click(scopeRadios()[2]);
    fireEvent.click(levelButton(t("typography.level.heading1")));
    await act(async () => {
      vi.advanceTimersByTime(600);
      await Promise.resolve();
    });

    expect(rendered).toHaveLength(1);
    const formatConfig = rendered[0].format_config as unknown as {
      objects?: Record<string, unknown>;
      object_roles?: Record<string, Record<string, unknown>>;
    };
    expect(formatConfig.objects ?? {}).toEqual({});
    expect(formatConfig.object_roles?.[`${OBJ_A}:body`]).toMatchObject({
      font_scale: 1.4,
      bold: true,
    });
  });
});
