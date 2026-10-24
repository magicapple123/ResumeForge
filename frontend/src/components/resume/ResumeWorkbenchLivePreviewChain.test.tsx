// SPDX-License-Identifier: Apache-2.0
/**
 * 制作台实时预览的**端到端链路**：编辑器输入 → store → 画布 → `renderResume`。
 *
 * ## 为什么必须有这一条（本批缺陷的直接教训）
 *
 * 相邻的两组单测各自都是绿的，却都没能抓住"右栏永不更新"：
 *
 * - `ResumeWorkbenchEditorColumn.draft.test.tsx`：只到「输入 → store」；
 * - `ResumeWorkbenchLiveCanvas.draft.test.tsx`：把 `useResumeLivePreview` 整个换成探针，
 *   只看「store → 喂进去的是哪份内容」，一次请求都不发。
 *
 * 于是链路上任何**夹具**（这个 hook 自己）挂掉都不会变红。这里把三截接成一条真链路，
 * 只把两处不可避免的东西换成替身：`renderResume`（真发 POST）与画布本体（真挂 iframe）。
 *
 * ## 两个刻意为之的形态
 *
 * 1. **套 `StrictMode`**：缺陷正是"effect 被 cleanup 过一次之后 `disposedRef` 永远是 true"，
 *    而 StrictMode 的「挂载 → 清理 → 再挂载」就是触发它的最短路径（这一轮 cleanup 之后 ref
 *    是被复用的，闸门于是关着进来）。不套 StrictMode，这条用例在坏代码上照样是绿的——
 *    真实卸载会连同 ref 一起销毁，只有这串时序才踩得到。
 * 2. **假定时器推进，而不是 `waitFor`**：要抓的形态是"每次渲染都把 600ms 防抖重新计时"。
 *    `waitFor` 会一轮轮让路给真实计时器，反而给自激链路留出机会；一次性推进 1100ms
 *    （store 的 150ms 尾随节流 + 600ms 防抖，留足余量）之后断言"已经发过请求"，
 *    任何把计时器重置掉的实现都过不了。
 */
import { App as AntdApp } from "antd";
import { StrictMode } from "react";
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import type { ResumeContent, ResumeLayout } from "../../types";
import { createResumeDraftStore } from "../../features/resume/resumeDraftContent";
import ResumeWorkbenchEditorColumn from "./ResumeWorkbenchEditorColumn";
import ResumeWorkbenchLiveCanvas from "./ResumeWorkbenchLiveCanvas";

/**
 * 服务端重排（真实现会发 `POST /api/resumes/render`）。
 *
 * 记录**每一次**调用：链路的产出就是"这条调用发生过、且带的是新内容"。
 */
const renderResume = vi.hoisted(() =>
  vi.fn<(content: ResumeContent, layout: ResumeLayout, signal: AbortSignal) => Promise<string>>(
    async () => "<html>live</html>",
  ),
);

vi.mock("../../api/resumeLayout", () => ({ renderResume }));

/** 画布本体挂 iframe + ResizeObserver，jsdom 里换成一个能读出 `html` / `status` 的壳。 */
vi.mock("./ResumeWorkbenchCanvas", () => ({
  default: ({ html, status }: { html: string; status?: ReactNode }) => (
    <div data-testid="canvas" data-html={html}>
      {status}
    </div>
  ),
}));

const CONTENT: ResumeContent = {
  photo: "data:image/png;base64,AAAA",
  name: "张三",
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

const LAYOUT = { template: "classic", page_limit: 1 } as unknown as ResumeLayout;

/**
 * 把中栏与右栏装进**同一个** store（与 `ResumeZoomModal` 里那一份等价）。
 *
 * 外面套 `StrictMode`：见文件头第 1 条。
 */
function renderChain(previewMode: "draft" | "exact" = "draft") {
  const draftStore = createResumeDraftStore();
  const utils = render(
    <StrictMode>
      <AntdApp>
        <ResumeWorkbenchEditorColumn
          active
          content={CONTENT}
          resumeId={42}
          onSave={vi.fn(async () => undefined)}
          draftStore={draftStore}
          hideActions
        />
        <ResumeWorkbenchLiveCanvas
          html="<html>saved</html>"
          warnings={[]}
          pages={1}
          previewRef={{ current: null }}
          content={CONTENT}
          layout={LAYOUT}
          previewMode={previewMode}
          draftStore={draftStore}
        />
      </AntdApp>
    </StrictMode>,
  );
  return { ...utils, draftStore };
}

/** 姓名输入框：antd 给 `Form.Item name="name"` 生成的 id 就是字段名。 */
function nameInput(): HTMLInputElement {
  const input = document.getElementById("name");
  expect(input).not.toBeNull();
  return input as HTMLInputElement;
}

/** 一次性推进定时器（`Async` 变体会在每个定时器之间让出微任务，Promise 链才能跑完）。 */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  sessionStorage.clear();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("制作台实时预览 · 编辑器 → store → 画布 → 重排", () => {
  it("中栏改一次姓名：600ms 内至少要真发一次重排，且带的是新内容", async () => {
    renderChain();

    fireEvent.change(nameInput(), { target: { value: "周验收" } });

    // 150ms 是 store 的尾随节流，600ms 是实时预览的防抖；1100ms 覆盖两者还有余量。
    await advance(1100);

    expect(renderResume).toHaveBeenCalled();
    const [content, layout] = renderResume.mock.calls[0];
    expect(content.name).toBe("周验收");
    // 合并口径与保存同一句：照片不在表单里，必须原样带上（否则预览里照片会消失）。
    expect(content.photo).toBe(CONTENT.photo);
    // 版式按同一次渲染的入参下传（否则预览会按默认版式重排）。
    expect(layout).toBe(LAYOUT);
  });

  it("重排回来之后：状态条离开「预览更新中…」，画布换成新 html", async () => {
    renderChain();

    fireEvent.change(nameInput(), { target: { value: "周验收" } });
    await advance(1100);

    expect(screen.queryByText(t("rich.preview.updating"))).toBeNull();
    expect(screen.getByTestId("canvas").getAttribute("data-html")).toBe("<html>live</html>");
  });

  it("精确模式一次都不发（那一栏显示的是服务端 PDF）", async () => {
    renderChain("exact");

    fireEvent.change(nameInput(), { target: { value: "周验收" } });
    await advance(1100);

    expect(renderResume).not.toHaveBeenCalled();
  });
});
