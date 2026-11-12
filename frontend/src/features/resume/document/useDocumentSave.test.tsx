// SPDX-License-Identifier: Apache-2.0
/**
 * W02：整体保存状态机（单飞 / token / 失败保草稿 / 409 冲突）。
 *
 * 这些性质在 UI 层很难钉全：按钮的 disabled 只是"看起来"防住了双击，真正决定"发几次请求、
 * 旧回包会不会改状态"的是这个 hook。所以这里用一个最小 harness 直接驱动它，不渲染制作台。
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDocumentSave, type DocumentSaveApi } from "./useDocumentSave";
import type { SaveOutcome } from "./types";

function Harness({
  perform,
  capture,
}: {
  perform: () => Promise<SaveOutcome>;
  capture: (api: DocumentSaveApi) => void;
}) {
  const api = useDocumentSave({ perform });
  useEffect(() => {
    capture(api);
  }, [api, capture]);
  return <span data-testid="status">{api.status}</span>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/**
 * 返回的是**取值器**而不是快照：hook 每次渲染都会产出新对象，测试必须读"当下这一份"，
 * 否则断言拿到的是首帧那个 `conflict=false`。
 */
function mount(perform: () => Promise<SaveOutcome>) {
  const holder: { api: DocumentSaveApi | null } = { api: null };
  render(<Harness perform={perform} capture={(next) => (holder.api = next)} />);
  return {
    get api(): DocumentSaveApi {
      if (!holder.api) throw new Error("状态机还没挂上");
      return holder.api;
    },
  };
}

function statusText(): string | null {
  return screen.getByTestId("status").textContent;
}

const SAVED: SaveOutcome = { status: "saved", revision: 1 };

// 这个仓库的 vitest 配置没有开 globals 的自动 cleanup：不手动清，用例之间会互相看到
// 上一个 harness 的 DOM（`getByTestId` 直接报 multiple elements）。
afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

// 这个仓库的 vitest 配置没有开 globals 的自动 cleanup：不手动清，用例之间会互相看到
// 上一个 harness 的 DOM（`getByTestId` 直接报 multiple elements）。
afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("useDocumentSave · 单飞", () => {
  it("保存中连点两次：只发一次请求，落地后只补跑一次", async () => {
    const first = deferred<SaveOutcome>();
    const perform = vi.fn(() =>
      perform.mock.calls.length === 1 ? first.promise : Promise.resolve(SAVED),
    );
    const h = mount(perform);

    let running: Promise<void> = Promise.resolve();
    await act(async () => {
      running = h.api.save();
      // 让 perform 真的被调用（await 一次微任务即可，不用等定时器）。
      await Promise.resolve();
    });
    expect(perform).toHaveBeenCalledTimes(1);

    // 保存中再点两次：不排队、不并发，只登记"结束后再来一次"。
    await act(async () => {
      void h.api.save();
      void h.api.save();
    });
    expect(perform).toHaveBeenCalledTimes(1);

    await act(async () => {
      first.resolve(SAVED);
      await running;
    });
    // 补跑只发生一次（点三下不等于写三遍）。
    expect(perform).toHaveBeenCalledTimes(2);
    expect(statusText()).toBe("idle");
  });
});

describe("useDocumentSave · 过时回包", () => {
  it("文档被替换（invalidate）后，旧的冲突回包不再改状态", async () => {
    const first = deferred<SaveOutcome>();
    const h = mount(() => first.promise);
    let running: Promise<void> = Promise.resolve();
    await act(async () => {
      running = h.api.save();
      await Promise.resolve();
    });
    // 文档换了：这次保存已经不是"当前文档"的保存。
    await act(async () => {
      h.api.invalidate();
    });
    await act(async () => {
      first.resolve({ status: "conflict", currentRevision: 9 });
      await running;
    });
    // token 失配 → 回包被丢弃：不能把刚复位的新文档标成冲突。
    expect(statusText()).toBe("idle");
  });
});

describe("useDocumentSave · 失败", () => {
  it("失败不清任何东西：停在 failed，错误可读，再点保存可重试", async () => {
    const error = new Error("network down");
    const perform = vi
      .fn()
      .mockResolvedValueOnce({ status: "failed", error } satisfies SaveOutcome)
      .mockResolvedValueOnce(SAVED);
    const h = mount(perform);
    await act(async () => {
      await h.api.save();
    });
    expect(statusText()).toBe("failed");
    expect(h.api.failure).toBe(error);
    // 失败后不自动重试：perform 只有一次调用。
    expect(perform).toHaveBeenCalledTimes(1);
    // 用户再点保存 = 重试入口。
    await act(async () => {
      await h.api.save();
    });
    expect(perform).toHaveBeenCalledTimes(2);
    expect(statusText()).toBe("idle");
  });
});

describe("useDocumentSave · 409 冲突", () => {
  it("进入冲突态后拒绝再次保存（禁止硬覆盖），处理完才能继续", async () => {
    const perform = vi
      .fn()
      .mockResolvedValueOnce({ status: "conflict", currentRevision: null } satisfies SaveOutcome)
      .mockResolvedValueOnce(SAVED);
    const h = mount(perform);
    await act(async () => {
      await h.api.save();
    });
    expect(statusText()).toBe("conflict");

    // 关键：冲突态下再点保存不发请求。界面上按钮也会禁用，但状态机必须自己拒绝——
    // 否则快捷键 / 程序化入口能绕过界面把冲突硬压过去。
    await act(async () => {
      await h.api.save();
    });
    expect(perform).toHaveBeenCalledTimes(1);

    await act(async () => {
      h.api.settleConflict();
    });
    expect(statusText()).toBe("idle");
    await act(async () => {
      await h.api.save();
    });
    expect(perform).toHaveBeenCalledTimes(2);
  });
});
