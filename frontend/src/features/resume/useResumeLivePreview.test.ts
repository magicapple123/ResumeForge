// SPDX-License-Identifier: Apache-2.0
/**
 * 制作台实时预览的**节流语义**（`useResumeLivePreview`）。
 *
 * 这一层最容易出的四种错，全都不报错、只在用户手里表现为"卡 / 忽新忽旧 / 白屏"：
 *
 * 1. **每敲一个字发一次请求**：连续输入把后端打满，回来的顺序还乱；
 * 2. **在飞时又变，末版丢了**：用户改完最后一句、看到的是中间某一句的排版；
 * 3. **旧响应盖掉新响应**：画面忽新忽旧（`seq` 判据）；
 * 4. **失败就把预览清空**：用户宁可看上一版，也不要一片空白。
 *
 * 用例用**手动 resolve 的假 render**：只有能精确控制"哪一次请求什么时候回来"，`seq` 与
 * 末版这两条判据才测得出来（真用定时器只能测到"大概发了两次"）。
 *
 * 内容对象是**模块级常量**：hook 按引用判断"内容换没换"，每个用例现造对象会让"什么都没改"
 * 的那一步也变成一次变化，测出来的节流次数就没有意义了。
 *
 * 断言里不出现中文：`cjkRatchet` 的 tests 口径按文件卡中文 `*ByText`，新文件基线为 0。
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResumeDocument, ResumeLayout } from "../../types";
import { makeResumeDocument } from "../../test/documentHarness";
import { nearestScrollableAncestor, useResumeLivePreview } from "./useResumeLivePreview";
import type { UseResumeLivePreviewOptions } from "./useResumeLivePreview";

const LAYOUT: ResumeLayout = {
  template: "classic",
  format_name: "",
  page_limit: 1,
  font_scale: "standard",
  language: "zh-CN",
};

/**
 * 用"个人总结"板块唯一的正文块标识这一版内容（v2 里内容身份是 item，不再是标量字段）。
 * 其余板块用 documentHarness 的默认值：本文件测的是节流/竞态，不是内容结构。
 */
function makeContent(summary: string): ResumeDocument {
  const document = makeResumeDocument();
  return {
    ...document,
    sections: document.sections.map((section) =>
      section.key === "summary"
        ? {
            ...section,
            entries: section.entries.map((entry) => ({
              ...entry,
              items: [
                {
                  kind: "text" as const,
                  id: "live_preview_summary",
                  style: "paragraph" as const,
                  text: summary,
                  hidden: false,
                },
              ],
            })),
          }
        : section,
    ),
  };
}

/** 反过来读那一版内容的标识，供"发的是最后那一版"这类断言使用。 */
function summaryOf(document: ResumeDocument): string {
  const section = document.sections.find((candidate) => candidate.key === "summary");
  const item = section?.entries[0]?.items[0];
  return item?.kind === "text" ? item.text : "";
}

const A = makeContent("a");
const B = makeContent("b");
const C = makeContent("c");
const D = makeContent("d");
const E = makeContent("e");
const F = makeContent("f");

interface PendingCall {
  resolve: (html: string) => void;
  reject: (error: unknown) => void;
  content: ResumeDocument;
  signal: AbortSignal;
}

/** 手动控制每次渲染何时、以什么结果返回。 */
function manualRender() {
  const calls: PendingCall[] = [];
  const render = vi.fn(
    (content: ResumeDocument, _layout: ResumeLayout, signal: AbortSignal) =>
      new Promise<string>((resolve, reject) => {
        calls.push({ resolve, reject, content, signal });
      }),
  );
  return { render, calls };
}

function base(overrides: Partial<UseResumeLivePreviewOptions> = {}): UseResumeLivePreviewOptions {
  return {
    enabled: true,
    content: A,
    layout: LAYOUT,
    render: async () => "<html/>",
    onHtml: () => undefined,
    ...overrides,
  };
}

/** 推进防抖并让微任务落地。 */
async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  });
}

/** 让一次手动的 resolve / reject 走完 React 的更新。 */
async function settle(work: () => void) {
  await act(async () => {
    work();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("制作台实时预览 · 请求节流", () => {
  it("首帧不发请求（宿主刚渲染过同一份内容）", async () => {
    const { render } = manualRender();
    renderHook((props: UseResumeLivePreviewOptions) => useResumeLivePreview(props), {
      initialProps: base({ render }),
    });
    await advance(2000);
    expect(render).not.toHaveBeenCalled();
  });

  it("连续 5 次变化只发 1 次，且发的是最后那一版", async () => {
    const { render, calls } = manualRender();
    const { rerender } = renderHook(
      (props: UseResumeLivePreviewOptions) => useResumeLivePreview(props),
      { initialProps: base({ render }) },
    );
    for (const content of [B, C, D, E, F]) {
      rerender(base({ render, content }));
    }
    await advance(600);

    expect(render).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
    expect(summaryOf(calls[0].content)).toBe("f");
  });

  it("状态依次是 typing → rendering → idle", async () => {
    const { render, calls } = manualRender();
    const states: string[] = [];
    const onStateChange = (state: string) => states.push(state);
    const { rerender, result } = renderHook(
      (props: UseResumeLivePreviewOptions) => useResumeLivePreview(props),
      { initialProps: base({ render }) },
    );
    rerender(base({ render, content: B, onStateChange }));
    await advance(600);
    expect(result.current.state).toBe("rendering");

    await settle(() => calls[0].resolve("<html>done</html>"));
    expect(result.current.state).toBe("idle");
    expect(states).toContain("typing");
    expect(states).toContain("rendering");
    expect(states[states.length - 1]).toBe("idle");
  });

  it("在飞时再变：只记末版，回来后补跑一次（共 2 次）", async () => {
    const { render, calls } = manualRender();
    const { rerender } = renderHook(
      (props: UseResumeLivePreviewOptions) => useResumeLivePreview(props),
      { initialProps: base({ render }) },
    );
    rerender(base({ render, content: B }));
    await advance(600);
    expect(render).toHaveBeenCalledTimes(1);

    // 第一次还在飞：这两次变化都不该发请求。
    rerender(base({ render, content: C }));
    await advance(600);
    rerender(base({ render, content: D }));
    await advance(600);
    expect(render).toHaveBeenCalledTimes(1);

    await settle(() => calls[0].resolve("<html>b</html>"));
    expect(render).toHaveBeenCalledTimes(2);
    expect(summaryOf(calls[1].content)).toBe("d");
  });

  it("这一轮两次用完之后，新的变化重新走防抖（不会无限追）", async () => {
    const { render, calls } = manualRender();
    const { rerender } = renderHook(
      (props: UseResumeLivePreviewOptions) => useResumeLivePreview(props),
      { initialProps: base({ render }) },
    );
    rerender(base({ render, content: B }));
    await advance(600);
    rerender(base({ render, content: C }));
    await settle(() => calls[0].resolve("<html>b</html>"));
    expect(render).toHaveBeenCalledTimes(2);
    // 末版（C）也回来了：这一轮到此为止，没有第三个请求自己冒出来。
    await settle(() => calls[1].resolve("<html>c</html>"));
    expect(render).toHaveBeenCalledTimes(2);

    rerender(base({ render, content: D }));
    await advance(600);
    // 又开了一轮：这才允许第三次。
    expect(render).toHaveBeenCalledTimes(3);
    expect(summaryOf(calls[2].content)).toBe("d");
  });
});

describe("制作台实时预览 · 结果与失败", () => {
  it("成功时把 html 交给宿主", async () => {
    const { render, calls } = manualRender();
    const onHtml = vi.fn();
    const { rerender } = renderHook(
      (props: UseResumeLivePreviewOptions) => useResumeLivePreview(props),
      { initialProps: base({ render, onHtml }) },
    );
    rerender(base({ render, onHtml, content: B }));
    await advance(600);
    await settle(() => calls[0].resolve("<html>live</html>"));
    expect(onHtml).toHaveBeenCalledWith("<html>live</html>");
  });

  it("失败进 error 态，不写 html；retry 重跑最新一版", async () => {
    const { render, calls } = manualRender();
    const onHtml = vi.fn();
    const { rerender, result } = renderHook(
      (props: UseResumeLivePreviewOptions) => useResumeLivePreview(props),
      { initialProps: base({ render, onHtml }) },
    );
    rerender(base({ render, onHtml, content: B }));
    await advance(600);
    await settle(() => calls[0].reject(new Error("boom")));
    expect(result.current.state).toBe("error");
    expect(onHtml).not.toHaveBeenCalled();

    await settle(() => result.current.retry());
    expect(render).toHaveBeenCalledTimes(2);
    await settle(() => calls[1].resolve("<html>retried</html>"));
    expect(onHtml).toHaveBeenCalledWith("<html>retried</html>");
    expect(result.current.state).toBe("idle");
  });

  it("挂起后回来的响应被丢弃（seq 判据），状态归 idle", async () => {
    const { render, calls } = manualRender();
    const onHtml = vi.fn();
    const { rerender, result } = renderHook(
      (props: UseResumeLivePreviewOptions) => useResumeLivePreview(props),
      { initialProps: base({ render, onHtml }) },
    );
    rerender(base({ render, onHtml, content: B }));
    await advance(600);
    expect(calls[0].signal.aborted).toBe(false);

    act(() => result.current.suspend());
    expect(calls[0].signal.aborted).toBe(true);
    expect(result.current.state).toBe("idle");

    await settle(() => calls[0].resolve("<html>stale</html>"));
    expect(onHtml).not.toHaveBeenCalled();

    // 恢复后新的变化照常触发。
    act(() => result.current.resume());
    rerender(base({ render, onHtml, content: C }));
    await advance(600);
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("取消（abort）不算失败，不进 error 态", async () => {
    const { render, calls } = manualRender();
    const { rerender, result } = renderHook(
      (props: UseResumeLivePreviewOptions) => useResumeLivePreview(props),
      { initialProps: base({ render }) },
    );
    rerender(base({ render, content: B }));
    await advance(600);
    act(() => result.current.suspend());
    await settle(() => calls[0].reject(new Error("aborted")));
    expect(result.current.state).toBe("idle");
  });

  it("卸载后回来的响应不写 html（不再 setState）", async () => {
    const { render, calls } = manualRender();
    const onHtml = vi.fn();
    const { rerender, unmount } = renderHook(
      (props: UseResumeLivePreviewOptions) => useResumeLivePreview(props),
      { initialProps: base({ render, onHtml }) },
    );
    rerender(base({ render, onHtml, content: B }));
    await advance(600);
    unmount();
    await settle(() => calls[0].resolve("<html>late</html>"));
    expect(onHtml).not.toHaveBeenCalled();
  });

  it("保存期间（挂起）的变化不发请求，恢复后也不补发（宿主写的 html 是权威的）", async () => {
    const { render } = manualRender();
    const onHtml = vi.fn();
    const { rerender, result } = renderHook(
      (props: UseResumeLivePreviewOptions) => useResumeLivePreview(props),
      { initialProps: base({ render, onHtml }) },
    );
    act(() => result.current.suspend());

    // 保存期间内容会变（宿主 setDetail / overlay 清空）：只更新基线，不发请求。
    rerender(base({ render, onHtml, content: B }));
    await advance(600);
    expect(render).not.toHaveBeenCalled();
    // 挂起时状态必须归 idle，否则状态条会一直写着「预览更新中…」。
    expect(result.current.state).toBe("idle");

    act(() => result.current.resume());
    await advance(600);
    expect(render).not.toHaveBeenCalled();

    // 恢复之后的**新**变化照常触发。
    rerender(base({ render, onHtml, content: C }));
    await advance(600);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("enabled=false 时一个请求都不发", async () => {
    const { render } = manualRender();
    const { rerender } = renderHook(
      (props: UseResumeLivePreviewOptions) => useResumeLivePreview(props),
      { initialProps: base({ render, enabled: false }) },
    );
    rerender(base({ render, enabled: false, content: B }));
    await advance(2000);
    expect(render).not.toHaveBeenCalled();
  });
});

describe("预览刷新后的滚动位置", () => {
  function makeScrollHost(): { host: HTMLDivElement; layout: HTMLDivElement } {
    const host = document.createElement("div");
    host.style.overflowY = "auto";
    Object.defineProperty(host, "scrollHeight", { configurable: true, get: () => 2000 });
    Object.defineProperty(host, "clientHeight", { configurable: true, get: () => 500 });
    const layout = document.createElement("div");
    host.appendChild(layout);
    document.body.appendChild(host);
    return { host, layout };
  }

  it("向上找到真正滚动的祖先；找不到时退回原节点", () => {
    const { host, layout } = makeScrollHost();
    expect(nearestScrollableAncestor(layout)).toBe(host);
    expect(nearestScrollableAncestor(host)).toBe(host);
    const orphan = document.createElement("div");
    expect(nearestScrollableAncestor(orphan)).toBe(orphan);
    host.remove();
  });

  it("ref 指向布局层时，刷新仍把外层滚动容器的位置写回", async () => {
    const { host, layout } = makeScrollHost();
    host.scrollTop = 300;
    const onHtml = vi.fn();
    const options = base({
      render: async () => "<html/>",
      onHtml,
      scrollRef: { current: layout },
    });
    const { rerender } = renderHook(
      (props: UseResumeLivePreviewOptions) => useResumeLivePreview(props),
      { initialProps: options },
    );
    rerender({ ...options, content: B });
    await advance(600);
    await advance(600);
    expect(onHtml).toHaveBeenCalled();
    expect(host.scrollTop).toBe(300);
    host.remove();
  });
});
