// SPDX-License-Identifier: Apache-2.0
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { App as AntdApp } from "antd";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n";
import { ERROR_TOAST_MS, RESULT_TOAST_MS, UNDO_TOAST_MS, useToast } from "./useToast";

// 没开 vitest 的 `globals`，RTL 不会自动清理；而且 `message` 是命令式创建的，
// 卡片不随组件卸载消失——所以每个用例用**互不相同的文案**，只在各自的那张卡片里查找。
afterEach(cleanup);

function wrapper({ children }: { children: ReactNode }) {
  return <AntdApp>{children}</AntdApp>;
}

function countOf(text: string): number {
  return (document.body.textContent ?? "").split(text).length - 1;
}

/** 在包含 `text` 的那张卡片里找元素：避免命中别的用例留下的卡片。 */
async function withinNotice(text: string, selector: string): Promise<HTMLElement> {
  const found = await waitFor(() => {
    const notices = Array.from(document.querySelectorAll(".ant-message-notice"));
    const notice = notices.find((item) => item.textContent?.includes(text));
    if (!notice) throw new Error("notice not found");
    return notice;
  });
  const target = found.querySelector(selector);
  expect(target).not.toBeNull();
  return target as HTMLElement;
}

describe("Toast 时长口径", () => {
  it("结果类 2.5 秒、错误类 4 秒、撤销窗口 5 秒", () => {
    expect(RESULT_TOAST_MS).toBe(2500);
    expect(ERROR_TOAST_MS).toBe(4000);
    expect(UNDO_TOAST_MS).toBe(5000);
  });
});

describe("useToast", () => {
  it("success 渲染文案", async () => {
    const { result } = renderHook(() => useToast(), { wrapper });
    result.current.success("已保存甲");
    await waitFor(() => expect(countOf("已保存甲")).toBe(1));
  });

  it("同 key 连点只留一张卡片", async () => {
    const { result } = renderHook(() => useToast(), { wrapper });
    result.current.success("已删除乙", { key: "undo-job-12" });
    result.current.success("已删除乙", { key: "undo-job-12" });
    await waitFor(() => expect(countOf("已删除乙")).toBe(1));
  });

  it("undo 带动作按钮；点它调回调", async () => {
    const onClick = vi.fn();
    const { result } = renderHook(() => useToast(), { wrapper });
    result.current.undo("已删除丙", { label: t("toast.undo.label"), onClick });

    const action = await withinNotice("已删除丙", ".rf-toast-action");
    action.click();
    // 动作回调在微任务里跑（先把卡片关掉），断言要等一拍。
    await waitFor(() => expect(onClick).toHaveBeenCalledTimes(1));
  });

  it("撤销失败时补一条 error，不吞异常", async () => {
    const onClick = vi.fn(() => Promise.reject(new Error("boom")));
    const { result } = renderHook(() => useToast(), { wrapper });
    result.current.undo("已删除丁", { label: t("toast.undo.label"), onClick });

    const action = await withinNotice("已删除丁", ".rf-toast-action");
    action.click();
    await waitFor(() => expect(countOf(t("toast.restore.failed"))).toBeGreaterThanOrEqual(1));
  });
});
