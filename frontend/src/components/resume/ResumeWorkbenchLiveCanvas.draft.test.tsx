// SPDX-License-Identifier: Apache-2.0
/**
 * 制作台右栏：**草稿优先**的正文优先级（P0-7）。
 *
 * 这个薄壳是整条实时预览链路上唯一"选错就全错"的地方，而它只在两个时刻起作用：
 *
 * 1. **有草稿时用草稿**：中栏改一句措辞、还没保存，右栏就要按新内容重排。选错（仍用宿主
 *    那一版）的表现是"改了半天预览不动"，用户会以为功能没做出来。
 * 2. **没有草稿时用宿主那一版**：保存成功 / 放弃修改之后必须**立刻**回到宿主那份 html，
 *    否则就是 R2 的"保存后闪回旧内容"。
 *
 * 这里把 `useResumeLivePreview` 与画布本体都换成探针：前者让我们读到"最终喂给重排的是哪份
 * 内容"（那是唯一需要断言的东西），后者避免在 jsdom 里挂 iframe 与 ResizeObserver。
 */
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResumeContent, ResumeLayout } from "../../types";
import { createResumeDraftStore } from "../../features/resume/resumeDraftContent";
import { ENTRY_POINT_FIELDS } from "../../features/resume-document/types";
import { isObjectId, resetEntryIdCache } from "../../features/resume-document/identity";
import ResumeWorkbenchLiveCanvas from "./ResumeWorkbenchLiveCanvas";

/** `useResumeLivePreview` 收到的入参（每帧覆盖一份，断言读最后一次）。 */
const live = vi.hoisted(() => ({
  content: null as ResumeContent | null,
  enabled: false,
}));

vi.mock("../../features/resume/useResumeLivePreview", () => ({
  useResumeLivePreview: (options: { content: ResumeContent | null; enabled: boolean }) => {
    live.content = options.content;
    live.enabled = options.enabled;
    return {
      state: "idle",
      retry: () => undefined,
      suspend: () => undefined,
      resume: () => undefined,
    };
  },
}));

vi.mock("./ResumeWorkbenchCanvas", () => ({
  default: ({ html }: { html: string }) => <div data-testid="canvas" data-html={html} />,
}));

const SAVED: ResumeContent = {
  photo: "",
  name: "服务端版本",
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
  campus_projects: [],
  campus_experience: [],
  projects: [],
  skills: [],
  awards: [],
} as unknown as ResumeContent;

const LAYOUT = { template: "classic" } as unknown as ResumeLayout;

/**
 * 一份**带条目但没有 W01 条目 id** 的草稿。
 *
 * 制作台会把草稿交给 `ensureEntryIds` 补齐条目 id（面板的条目下拉 / 对象排版按 id 落点），
 * 所以喂给重排的那一份**必然是新对象**——夹具里放一条真条目，`id` 断言才有内容可查。
 */
function draftWithEntry(): ResumeContent {
  return {
    ...SAVED,
    name: "草稿版本",
    experience: [
      {
        company: "Acme",
        role: "后端工程师",
        start_date: "",
        end_date: "",
        description: ["负责核心链路"],
        highlights: [],
        tech_stack: [],
      },
    ],
  } as unknown as ResumeContent;
}

/** 正文里**全部**条目 id（按 `ENTRY_POINT_FIELDS` 逐分区收集，不写死分区名）。 */
function entryIds(content: ResumeContent | null): string[] {
  if (!content) return [];
  const source = content as unknown as Record<string, unknown>;
  return Object.keys(ENTRY_POINT_FIELDS).flatMap((field) => {
    const entries = source[field];
    if (!Array.isArray(entries)) return [];
    return (entries as Array<Record<string, unknown> | null>).map((entry) =>
      entry && typeof entry === "object" && typeof entry.id === "string" ? entry.id : "",
    );
  });
}

interface CanvasProps {
  draftStore?: ReturnType<typeof createResumeDraftStore>;
  mergeLive?: (content: ResumeContent | null) => ResumeContent | null;
  content?: ResumeContent | null;
  previewMode?: "draft" | "exact";
}

function canvasElement(props: CanvasProps) {
  return (
    <ResumeWorkbenchLiveCanvas
      html="<html>saved</html>"
      warnings={[]}
      pages={1}
      previewRef={{ current: null }}
      content={props.content === undefined ? SAVED : props.content}
      layout={LAYOUT}
      previewMode={props.previewMode}
      draftStore={props.draftStore}
      mergeLive={props.mergeLive}
    />
  );
}

function renderCanvas(props: CanvasProps) {
  return render(canvasElement(props));
}

afterEach(() => {
  cleanup();
  live.content = null;
  live.enabled = false;
  // id 表按内容签名缓存（同一份正文多处补 id 要得到同一批 id）；用例之间必须清掉，
  // 否则上一条的 id 会被下一条同形内容读到。
  resetEntryIdCache();
});

describe("ResumeWorkbenchLiveCanvas · 草稿优先", () => {
  it("没有草稿通道时用宿主那一版正文（只读宿主行为不变）", () => {
    renderCanvas({});

    expect(live.content).toBe(SAVED);
    expect(live.enabled).toBe(true);
  });

  it("草稿一上来就压在宿主正文上面（并把 W01 条目 id 一起补上）", () => {
    const store = createResumeDraftStore(0);
    const draft = draftWithEntry();
    store.set(draft, "sig-1");

    const view = renderCanvas({ draftStore: store });

    // 草稿赢过宿主正文：正文来自草稿（名字 + 那条经历），而不是宿主那一份对象。
    expect(live.content).not.toBe(SAVED);
    expect(live.content).toMatchObject({
      name: "草稿版本",
      experience: [expect.objectContaining({ company: "Acme" })],
    });
    // 喂给重排的草稿必须带 W01 条目 id：面板的条目下拉 / 对象排版都按 id 落点。
    const ids = entryIds(live.content);
    expect(ids).toHaveLength(1);
    expect(isObjectId(ids[0])).toBe(true);

    // 同一份草稿在多次渲染之间必须是**同一引用**：否则每一帧都给实时预览一个"内容变了"的
    // 信号，重排防抖被反复重置，预览永远停在"更新中"（自激）。
    const first = live.content;
    view.rerender(canvasElement({ draftStore: store }));
    expect(live.content).toBe(first);
  });

  it("草稿到达时（挂载之后）也会立刻接管预览", () => {
    const store = createResumeDraftStore(0);
    renderCanvas({ draftStore: store });
    // 还没有草稿：喂给重排的就是宿主那一份引用。
    expect(live.content).toBe(SAVED);

    const draft = draftWithEntry();
    act(() => store.set(draft, "sig-1"));

    expect(live.content).not.toBe(SAVED);
    expect(live.content).toMatchObject({
      name: "草稿版本",
      experience: [expect.objectContaining({ company: "Acme" })],
    });
    expect(entryIds(live.content).every(isObjectId)).toBe(true);
  });

  it("clear 之后回落到宿主那一版（保存成功 / 放弃修改的出口）", () => {
    const store = createResumeDraftStore(0);
    store.set({ ...SAVED, name: "草稿版本" }, "sig-1");
    renderCanvas({ draftStore: store });

    act(() => store.clear());

    expect(live.content).toBe(SAVED);
  });

  it("加粗 overlay 叠在草稿上（mergeLive），而不是叠在宿主那一版上", () => {
    const store = createResumeDraftStore(0);
    const draft = draftWithEntry();
    store.set(draft, "sig-1");
    const merged = { ...draft, summary: "加粗后的总结" };

    renderCanvas({ draftStore: store, mergeLive: () => merged });

    // overlay 真的叠上去了（宿主那一版 summary 是空串）。
    expect(live.content).toMatchObject({ summary: "加粗后的总结" });
    // 底子是**草稿**那一份而不是宿主那一版：宿主没有这条经历。
    expect(live.content).toMatchObject({
      name: "草稿版本",
      experience: [expect.objectContaining({ company: "Acme" })],
    });
    expect(entryIds(live.content).every(isObjectId)).toBe(true);
  });

  it("mergeLive 返回 null 时退回草稿本身（不能把正文变成空）", () => {
    const store = createResumeDraftStore(0);
    const draft = draftWithEntry();
    store.set(draft, "sig-1");

    renderCanvas({ draftStore: store, mergeLive: () => null });

    expect(live.content).not.toBeNull();
    expect(live.content).not.toBe(SAVED);
    // 退回的是草稿本身（名字 + 那条经历都在），不是空正文。
    expect(live.content).toMatchObject({
      name: "草稿版本",
      experience: [expect.objectContaining({ company: "Acme" })],
    });
    expect(entryIds(live.content).every(isObjectId)).toBe(true);
  });

  it("精确模式不发实时重排（enabled=false），即使有草稿", () => {
    const store = createResumeDraftStore(0);
    store.set({ ...SAVED, name: "草稿版本" }, "sig-1");

    renderCanvas({ draftStore: store, previewMode: "exact" });

    expect(live.enabled).toBe(false);
  });

  it("没有正文时也不启用（生成流程的只读预览）", () => {
    renderCanvas({ content: null });

    expect(live.enabled).toBe(false);
  });
});
