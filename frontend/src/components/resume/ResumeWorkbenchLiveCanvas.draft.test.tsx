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

function renderCanvas(props: {
  draftStore?: ReturnType<typeof createResumeDraftStore>;
  mergeLive?: (content: ResumeContent | null) => ResumeContent | null;
  content?: ResumeContent | null;
  previewMode?: "draft" | "exact";
}) {
  return render(
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
    />,
  );
}

afterEach(() => {
  cleanup();
  live.content = null;
  live.enabled = false;
});

describe("ResumeWorkbenchLiveCanvas · 草稿优先", () => {
  it("没有草稿通道时用宿主那一版正文（只读宿主行为不变）", () => {
    renderCanvas({});

    expect(live.content).toBe(SAVED);
    expect(live.enabled).toBe(true);
  });

  it("草稿一上来就压在宿主正文上面", () => {
    const store = createResumeDraftStore(0);
    const draft = { ...SAVED, name: "草稿版本" };
    store.set(draft, "sig-1");

    renderCanvas({ draftStore: store });

    expect(live.content).toBe(draft);
  });

  it("草稿到达时（挂载之后）也会立刻接管预览", () => {
    const store = createResumeDraftStore(0);
    renderCanvas({ draftStore: store });
    expect(live.content).toBe(SAVED);

    const draft = { ...SAVED, name: "草稿版本" };
    act(() => store.set(draft, "sig-1"));

    expect(live.content).toBe(draft);
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
    const draft = { ...SAVED, name: "草稿版本" };
    store.set(draft, "sig-1");
    const merged = { ...draft, summary: "加粗后的总结" };

    renderCanvas({ draftStore: store, mergeLive: () => merged });

    expect(live.content).toBe(merged);
  });

  it("mergeLive 返回 null 时退回草稿本身（不能把正文变成空）", () => {
    const store = createResumeDraftStore(0);
    const draft = { ...SAVED, name: "草稿版本" };
    store.set(draft, "sig-1");

    renderCanvas({ draftStore: store, mergeLive: () => null });

    expect(live.content).toBe(draft);
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
