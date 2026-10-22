// SPDX-License-Identifier: Apache-2.0
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { App as AntdApp } from "antd";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import { useDeleteUndo } from "./useDeleteUndo";

const restoreTrashItems = vi.hoisted(() => vi.fn());

vi.mock("../../api/trash", () => ({ restoreTrashItems }));

afterEach(() => {
  cleanup();
  restoreTrashItems.mockReset();
});

function wrapper({ children }: { children: ReactNode }) {
  return <AntdApp>{children}</AntdApp>;
}

function countOf(text: string): number {
  return (document.body.textContent ?? "").split(text).length - 1;
}

describe("useDeleteUndo", () => {
  it("删除成功后给撤销入口，点它按 type_key + id 调恢复接口", async () => {
    restoreTrashItems.mockResolvedValue({ restored: 1, results: [] });
    const onRestored = vi.fn();
    const remove = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() => useDeleteUndo(), { wrapper });
    const ok = await result.current.run({ type: "job", ids: [12] }, remove, { onRestored });

    expect(ok).toBe(true);
    expect(remove).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(countOf(t("toast.deleted.single"))).toBeGreaterThanOrEqual(1));

    const action = document.querySelector(".rf-toast-action") as HTMLButtonElement;
    expect(action).not.toBeNull();
    action.click();

    await waitFor(() =>
      expect(restoreTrashItems).toHaveBeenCalledWith([{ type_key: "job", id: 12 }]),
    );
    await waitFor(() => expect(onRestored).toHaveBeenCalledTimes(1));
  });

  it("多选时文案带条数", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useDeleteUndo(), { wrapper });
    await result.current.run({ type: "resume", ids: [1, 2, 3] }, remove);
    await waitFor(() =>
      expect(countOf(t("toast.deleted.batch", { count: 3 }))).toBeGreaterThanOrEqual(1),
    );
  });

  it("空 ids 不算删除，也不发提示", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useDeleteUndo(), { wrapper });
    expect(await result.current.run({ type: "job", ids: [] }, remove)).toBe(false);
    expect(remove).not.toHaveBeenCalled();
  });

  it("超过 100 条直接抛错（那一档必须保留二次确认）", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useDeleteUndo(), { wrapper });
    const ids = Array.from({ length: 101 }, (_unused, index) => index + 1);
    await expect(result.current.run({ type: "job", ids }, remove)).rejects.toThrow(/100/);
    expect(remove).not.toHaveBeenCalled();
  });

  it("一条都没恢复时说明去哪手动恢复，而不是静默当成功", async () => {
    restoreTrashItems.mockResolvedValue({ restored: 0, results: [] });
    const { result } = renderHook(() => useDeleteUndo(), { wrapper });
    await result.current.run({ type: "job", ids: [9] }, vi.fn().mockResolvedValue(undefined));

    const action = await waitFor(() => {
      const button = document.querySelector(".rf-toast-action");
      if (!button) throw new Error("action not rendered yet");
      return button as HTMLButtonElement;
    });
    action.click();
    await waitFor(() => expect(countOf(t("toast.restore.failed"))).toBeGreaterThanOrEqual(1));
  });
});
