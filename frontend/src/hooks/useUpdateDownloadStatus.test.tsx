import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdateStatus } from "../types";
import { useUpdateDownloadStatus } from "./useUpdateDownloadStatus";

const api = vi.hoisted(() => ({ getUpdateDownloadStatus: vi.fn() }));
vi.mock("../api/settings", () => api);

function status(state: UpdateStatus["state"]): UpdateStatus {
  return {
    state,
    current_version: "0.18.0",
    target_version: "0.19.0",
    progress: state === "ready" ? 100 : 0,
    downloaded_bytes: 0,
    total_bytes: null,
    background: false,
    installable: true,
    message: "",
  };
}

function deferred() {
  let resolve!: (value: UpdateStatus) => void;
  const promise = new Promise<UpdateStatus>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

beforeEach(() => api.getUpdateDownloadStatus.mockReset());
afterEach(() => vi.useRealTimers());

describe("useUpdateDownloadStatus", () => {
  it("publishing an action result aborts and invalidates an older status read", async () => {
    const initial = deferred();
    api.getUpdateDownloadStatus.mockReturnValue(initial.promise);
    const { result } = renderHook(useUpdateDownloadStatus);
    await act(async () => {
      await Promise.resolve();
    });
    const signal: AbortSignal = api.getUpdateDownloadStatus.mock.calls[0][0];
    act(() => result.current.setStatus(status("ready")));
    expect(signal.aborted).toBe(true);
    await act(async () => initial.resolve(status("idle")));
    expect(result.current.status?.state).toBe("ready");
  });

  it("slow polling stays single-flight and obsolete polling cannot overwrite ready", async () => {
    vi.useFakeTimers();
    const slow = deferred();
    api.getUpdateDownloadStatus
      .mockResolvedValueOnce(status("downloading"))
      .mockReturnValue(slow.promise);
    const { result } = renderHook(useUpdateDownloadStatus);
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(api.getUpdateDownloadStatus).toHaveBeenCalledTimes(2);
    act(() => result.current.setStatus(status("ready")));
    await act(async () => slow.resolve(status("downloading")));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(api.getUpdateDownloadStatus).toHaveBeenCalledTimes(2);
    expect(result.current.status?.state).toBe("ready");
  });

  it("failure-path correction replaces a slow initial snapshot instead of sharing it", async () => {
    const initial = deferred();
    api.getUpdateDownloadStatus
      .mockReturnValueOnce(initial.promise)
      .mockResolvedValue(status("failed"));
    const { result } = renderHook(useUpdateDownloadStatus);
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => result.current.refreshStatus());
    expect(result.current.status?.state).toBe("failed");
    await act(async () => initial.resolve(status("idle")));
    expect(result.current.status?.state).toBe("failed");
  });

  it("read failures are explicit, retry clears them and unmount aborts pending IO", async () => {
    api.getUpdateDownloadStatus.mockRejectedValueOnce(new Error("SYNTHETIC_PRIVATE_ERROR"));
    const { result, unmount } = renderHook(useUpdateDownloadStatus);
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.statusError).toContain("重试读取");
    expect(result.current.statusError).not.toContain("SYNTHETIC_PRIVATE");
    api.getUpdateDownloadStatus.mockResolvedValueOnce(status("ready"));
    await act(async () => result.current.refreshStatus());
    expect(result.current.status?.state).toBe("ready");
    expect(result.current.statusError).toBe("");
    api.getUpdateDownloadStatus.mockReturnValueOnce(deferred().promise);
    act(() => {
      void result.current.refreshStatus();
    });
    await act(async () => {
      await Promise.resolve();
    });
    const calls = api.getUpdateDownloadStatus.mock.calls;
    const signal: AbortSignal = calls[calls.length - 1][0];
    unmount();
    expect(signal.aborted).toBe(true);
  });
});
