// SPDX-License-Identifier: Apache-2.0
/**
 * `resumeDraftContent` 的纯逻辑用例：节流 / 签名去重 / clear / 快照引用稳定。
 *
 * 这一组断言的价值：这三个行为**在界面上都看不出来**——节流失灵只是多几次渲染，
 * 去重失灵只是多几次请求，快照引用不稳定则会让整个画布每帧重渲染（React 会警告
 * "getSnapshot should be cached" 并把每键输入变成卡顿）。所以必须用机械断言钉住。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createResumeDraftStore, DRAFT_FLUSH_MS } from "./resumeDraftContent";
import type { ResumeContent } from "../../types";

function content(name: string): ResumeContent {
  return { name } as ResumeContent;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("createResumeDraftStore", () => {
  it("节流窗口内只通知一次，且通知的是窗口内最后一次上报的值", () => {
    vi.useFakeTimers();
    const store = createResumeDraftStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.set(content("a"), "sig-a");
    store.set(content("b"), "sig-b");
    store.set(content("c"), "sig-c");
    // 窗口未到：一次都不通知（尾随），但快照仍是 null。
    expect(listener).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toBeNull();

    vi.advanceTimersByTime(DRAFT_FLUSH_MS);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()?.name).toBe("c");
  });

  it("同一份内容重复上报不通知、也不重排定时器", () => {
    vi.useFakeTimers();
    const store = createResumeDraftStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.set(content("a"), "sig-a");
    vi.advanceTimersByTime(DRAFT_FLUSH_MS);
    expect(listener).toHaveBeenCalledTimes(1);

    // 同签名再来两次（一次输入里 history.push 会触发重复上报）。
    store.set(content("a"), "sig-a");
    store.set(content("a2"), "sig-a");
    vi.advanceTimersByTime(DRAFT_FLUSH_MS);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()?.name).toBe("a");
  });

  it("快照在两次通知之间是同一个引用（useSyncExternalStore 的硬要求）", () => {
    const store = createResumeDraftStore(0);
    store.set(content("a"), "sig-a");

    const first = store.getSnapshot();
    expect(store.getSnapshot()).toBe(first);
  });

  it("clear 把快照置回 null 并只通知一次；再 clear 不通知", () => {
    const store = createResumeDraftStore(0);
    const listener = vi.fn();
    store.subscribe(listener);
    store.set(content("a"), "sig-a");
    expect(listener).toHaveBeenCalledTimes(1);

    store.clear();
    expect(store.getSnapshot()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);

    store.clear();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("没有草稿时 clear 不产生通知（避免保存后多一轮空渲染）", () => {
    const store = createResumeDraftStore(0);
    const listener = vi.fn();
    store.subscribe(listener);

    store.clear();

    expect(listener).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toBeNull();
  });

  it("clear 之后同一份内容可以再次上报（签名去重被重置）", () => {
    const store = createResumeDraftStore(0);
    const listener = vi.fn();
    store.subscribe(listener);

    store.set(content("a"), "sig-a");
    store.clear();
    store.set(content("a"), "sig-a");

    expect(listener).toHaveBeenCalledTimes(3);
    expect(store.getSnapshot()?.name).toBe("a");
  });

  it("clear 会取消还没到点的节流窗口", () => {
    vi.useFakeTimers();
    const store = createResumeDraftStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.set(content("a"), "sig-a");
    store.clear();
    vi.advanceTimersByTime(DRAFT_FLUSH_MS * 4);

    expect(listener).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toBeNull();
  });

  it("取消订阅之后不再收到通知", () => {
    const store = createResumeDraftStore(0);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    unsubscribe();
    store.set(content("a"), "sig-a");

    expect(listener).not.toHaveBeenCalled();
  });
});
