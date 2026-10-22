// SPDX-License-Identifier: Apache-2.0
import { act, cleanup, renderHook } from "@testing-library/react";
import { App as AntdApp } from "antd";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n";
import { draftStorageKey, readDraft, writeDraft } from "../utils/formDraftStorage";
import { useFormDraft } from "./useFormDraft";

const SCOPE = "tracker.create";

function wrapper({ children }: { children: ReactNode }) {
  return <AntdApp>{children}</AntdApp>;
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useFormDraft", () => {
  it("values 变化后防抖 450ms 才写", () => {
    const { rerender } = renderHook(({ values }) => useFormDraft({ scope: SCOPE, values }), {
      initialProps: { values: { title: "a" } },
      wrapper,
    });
    act(() => {
      vi.advanceTimersByTime(449);
    });
    expect(readDraft(SCOPE)).toBeNull();

    rerender({ values: { title: "ab" } });
    act(() => {
      vi.advanceTimersByTime(450);
    });
    expect(readDraft(SCOPE)?.values).toEqual({ title: "ab" });
  });

  it("卸载时同步 flush（关弹窗不该丢掉刚敲的字）", () => {
    const { unmount } = renderHook(() => useFormDraft({ scope: SCOPE, values: { title: "x" } }), {
      wrapper,
    });
    unmount();
    expect(readDraft(SCOPE)?.values).toEqual({ title: "x" });
  });

  it("空表单不写草稿（避免下次恢复出一份全空表单）", () => {
    renderHook(
      () =>
        useFormDraft({
          scope: SCOPE,
          values: { title: "" },
          isEmpty: (values) => values.title === "",
        }),
      { wrapper },
    );
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(window.sessionStorage.getItem(draftStorageKey(SCOPE))).toBeNull();
  });

  it("打开时读到已有草稿，但**不自动应用**", () => {
    writeDraft(SCOPE, { title: "draft" });
    const { result } = renderHook(
      () => useFormDraft({ scope: SCOPE, values: { title: "" }, open: true }),
      { wrapper },
    );
    expect(result.current.pending?.values).toEqual({ title: "draft" });
    act(() => {
      expect(result.current.adopt()).toEqual({ title: "draft" });
    });
    expect(result.current.pending).toBeNull();
  });

  it("discard 清 pending 与存储", () => {
    writeDraft(SCOPE, { title: "draft" });
    const { result } = renderHook(() => useFormDraft({ scope: SCOPE, values: {} }), { wrapper });
    act(() => result.current.discard());
    expect(result.current.pending).toBeNull();
    expect(readDraft(SCOPE)).toBeNull();
  });

  it("提交成功后 clear 只清存储，不动当前表单", () => {
    const { result } = renderHook(
      () => useFormDraft({ scope: SCOPE, values: { title: "typed" } }),
      { wrapper },
    );
    act(() => {
      vi.advanceTimersByTime(450);
    });
    expect(readDraft(SCOPE)).not.toBeNull();
    act(() => result.current.clear());
    expect(readDraft(SCOPE)).toBeNull();
  });

  it("too-large 一次会话只提示一次", () => {
    const huge = "字".repeat(12000);
    const { rerender } = renderHook(({ values }) => useFormDraft({ scope: SCOPE, values }), {
      initialProps: { values: { body: huge } },
      wrapper,
    });
    act(() => {
      vi.advanceTimersByTime(450);
    });
    const tip = t("draft.too-large");
    const countOf = (): number => document.body.textContent?.split(tip).length ?? 0;
    expect(countOf()).toBe(2);

    rerender({ values: { body: `${huge}!` } });
    act(() => {
      vi.advanceTimersByTime(450);
    });
    expect(countOf()).toBe(2);
  });
});
