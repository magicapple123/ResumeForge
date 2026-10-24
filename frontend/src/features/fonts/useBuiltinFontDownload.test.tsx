// SPDX-License-Identifier: Apache-2.0
/**
 * 共享下载状态机（`useBuiltinFontDownload`）：设置页那一行与制作台字体下拉共用的那一份。
 *
 * 这里钉的不是"能不能下"，而是四条**安静失败**的分支——它们错了界面都不会报错：
 *
 * 1. 轮询必须能被清掉（离开 `downloading` / 卸载后不许再打接口）；
 * 2. `onDownloaded` 只对**本次点击**触发一次（重复触发 = 把用户后来换掉的字体改回来）；
 * 3. `409`（已在下载）**不算失败**：把进度接上、不重复 POST、不弹错；
 * 4. 删除的 `404`（本来就没下载）在幂等视角下是"已经没有了"，不该报错。
 */
import { App as AntdApp } from "antd";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/client";
import type { BuiltinFontStatus } from "../../api/fonts";
import { t } from "../../i18n";
import { BUILTIN_POLL_INTERVAL_MS, useBuiltinFontDownload } from "./useBuiltinFontDownload";

const apiMocks = vi.hoisted(() => ({
  getBuiltinFont: vi.fn(),
  startBuiltinFontDownload: vi.fn(),
  cancelBuiltinFontDownload: vi.fn(),
  deleteBuiltinFont: vi.fn(),
}));

vi.mock("../../api/fonts", () => apiMocks);

const BASE: BuiltinFontStatus = {
  id: "source-han-sans-sc",
  label: "Source Han Sans",
  size_total: 33493260,
  downloaded: false,
  downloaded_bytes: 0,
  total_bytes: 33493260,
  state: "idle",
  error: "",
};

const DOWNLOADING: BuiltinFontStatus = {
  ...BASE,
  state: "downloading",
  downloaded_bytes: 8 * 1024 * 1024,
};
const DONE: BuiltinFontStatus = {
  ...BASE,
  state: "done",
  downloaded: true,
  downloaded_bytes: BASE.total_bytes,
};

/** 探针组件：把 hook 的返回摊成可断言的节点 + 三颗按钮（英文 aria-label，避开中文断言）。 */
function Probe({
  onDownloaded,
  manual = true,
}: {
  onDownloaded?: (status: BuiltinFontStatus) => void;
  manual?: boolean;
}) {
  const { state, status, startError, refresh, start, cancel, remove } = useBuiltinFontDownload({
    manual,
    onDownloaded,
  });
  return (
    <div>
      <span data-testid="state">{state}</span>
      <span data-testid="error">{startError}</span>
      <span data-testid="bytes">{status?.downloaded_bytes ?? -1}</span>
      <button onClick={() => void refresh()}>refresh</button>
      <button onClick={() => void start()}>start</button>
      <button onClick={() => void cancel()}>cancel</button>
      <button onClick={() => void remove()}>remove</button>
    </div>
  );
}

/**
 * 默认 `manual = true`：这些用例都在测"宿主自己掌握时机"的那条路（制作台）。
 * 设置页那种"挂载即读"的默认行为单独有一条用例（`manual 未设时…`）。
 */
function renderProbe(onDownloaded?: (status: BuiltinFontStatus) => void, manual = true) {
  return render(
    <AntdApp>
      <Probe onDownloaded={onDownloaded} manual={manual} />
    </AntdApp>,
  );
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

function advance(ms: number): Promise<void> {
  return act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  apiMocks.getBuiltinFont.mockReset().mockResolvedValue(DONE);
  apiMocks.startBuiltinFontDownload.mockReset().mockResolvedValue(DOWNLOADING);
  apiMocks.cancelBuiltinFontDownload.mockReset().mockResolvedValue(BASE);
  apiMocks.deleteBuiltinFont.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("useBuiltinFontDownload", () => {
  it("manual 未设时挂载读一次（设置页那种开箱即用用法）", async () => {
    renderProbe(undefined, false);
    await flush();

    expect(apiMocks.getBuiltinFont).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("state").textContent).toBe("done");
  });

  it("manual: true 时挂载不发任何请求（宿主不调 refresh 就零网络）", async () => {
    renderProbe();
    await flush();

    // 这条不是洁癖：制作台的字体控件会被字号滑杆所在参数栏反复渲染，而"拖动全程零网络"
    // 是那条控件的既有契约（`ResumeLayoutControls.font.test.tsx` 钉着它）。
    expect(apiMocks.getBuiltinFont).not.toHaveBeenCalled();
    expect(screen.getByTestId("state").textContent).toBe("idle");
  });

  it("宿主调 refresh() 时才读状态，并把进度显示出来", async () => {
    renderProbe();
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "refresh" }));
    await flush();

    expect(apiMocks.getBuiltinFont).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("bytes").textContent).toBe(String(DONE.downloaded_bytes));
    expect(screen.getByTestId("state").textContent).toBe("done");
  });

  it("下载 → 轮询到 done 只回调一次 onDownloaded，之后停掉定时器", async () => {
    const onDownloaded = vi.fn();
    apiMocks.getBuiltinFont.mockResolvedValue(DONE);
    renderProbe(onDownloaded);
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "start" }));
    await flush();
    expect(apiMocks.startBuiltinFontDownload).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("state").textContent).toBe("downloading");

    const before = apiMocks.getBuiltinFont.mock.calls.length;
    await advance(BUILTIN_POLL_INTERVAL_MS);
    await flush();
    expect(apiMocks.getBuiltinFont.mock.calls.length).toBe(before + 1);
    expect(onDownloaded).toHaveBeenCalledTimes(1);
    expect(onDownloaded.mock.calls[0][0]).toMatchObject({ state: "done" });

    // 状态已离开 downloading：再走几拍不该再打接口，也不该再回调。
    const settled = apiMocks.getBuiltinFont.mock.calls.length;
    await advance(BUILTIN_POLL_INTERVAL_MS * 3);
    expect(apiMocks.getBuiltinFont.mock.calls.length).toBe(settled);
    expect(onDownloaded).toHaveBeenCalledTimes(1);
  });

  it("轮询到 done 之后：再取一次状态仍是 done，且不会第二次接管", async () => {
    const onDownloaded = vi.fn();
    renderProbe(onDownloaded);
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "start" }));
    await flush();
    await advance(BUILTIN_POLL_INTERVAL_MS);
    await flush();
    expect(onDownloaded).toHaveBeenCalledTimes(1);

    // 关键：轮询**必须停在"看到 done 的那一次 GET"之后**，不能按进度百分比提前收手——
    // 后端 `_ensure_active` 是在"`downloaded` 为真的那次响应"里把「下载完成后是否接管
    // 全局字体」的开关取走并复位的（`activate=false` 靠它落地），提前收手会让开关空转到
    // 下一次 `start_download`。那次 GET 已经发生（就是上面让 `onDownloaded` 触发的那次），
    // 所以这里再手工读一次 = 又轮询了一拍：状态必须仍是 done，且**不能**再触发一次接管。
    fireEvent.click(screen.getByRole("button", { name: "refresh" }));
    await flush();

    expect(screen.getByTestId("state").textContent).toBe("done");
    expect(onDownloaded).toHaveBeenCalledTimes(1);
  });

  it("卸载后停掉轮询", async () => {
    apiMocks.getBuiltinFont.mockResolvedValue(DOWNLOADING);
    const { unmount } = renderProbe();
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "start" }));
    await flush();
    await advance(BUILTIN_POLL_INTERVAL_MS);
    const before = apiMocks.getBuiltinFont.mock.calls.length;
    unmount();
    await advance(BUILTIN_POLL_INTERVAL_MS * 3);
    expect(apiMocks.getBuiltinFont.mock.calls.length).toBe(before);
  });

  it("409「已在下载」不算失败：接上进度、不重复提交、不弹错", async () => {
    const onDownloaded = vi.fn();
    renderProbe(onDownloaded);
    await flush();

    apiMocks.startBuiltinFontDownload.mockRejectedValueOnce(new ApiError("字体正在下载中", 409));
    apiMocks.getBuiltinFont.mockResolvedValue(DOWNLOADING);

    fireEvent.click(screen.getByRole("button", { name: "start" }));
    await flush();

    // 不落到 startError（宿主也就不会渲染行内失败态），而是把已有进度接上。
    expect(screen.getByTestId("error").textContent).toBe("");
    expect(screen.getByTestId("state").textContent).toBe("downloading");
    expect(screen.getByTestId("bytes").textContent).toBe(String(DOWNLOADING.downloaded_bytes));
    expect(apiMocks.startBuiltinFontDownload).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain(t("fontDownload.alreadyDownloading"));
  });

  it("其它启动失败（磁盘满）落到 startError，由宿主渲染原因", async () => {
    apiMocks.getBuiltinFont.mockResolvedValue(BASE);
    renderProbe();
    await flush();

    apiMocks.startBuiltinFontDownload.mockRejectedValueOnce(
      new ApiError("磁盘空间不足，无法保存字体", 507),
    );
    fireEvent.click(screen.getByRole("button", { name: "start" }));
    await flush();

    expect(screen.getByTestId("error").textContent).toBe("磁盘空间不足，无法保存字体");
    expect(screen.getByTestId("state").textContent).toBe("idle");
  });

  it("取消：状态回到 idle，并且不再触发 onDownloaded", async () => {
    const onDownloaded = vi.fn();
    apiMocks.startBuiltinFontDownload.mockResolvedValue(DOWNLOADING);
    apiMocks.cancelBuiltinFontDownload.mockResolvedValue(BASE);
    renderProbe(onDownloaded);
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "start" }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "cancel" }));
    await flush();

    expect(apiMocks.cancelBuiltinFontDownload).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("state").textContent).toBe("idle");
    expect(onDownloaded).not.toHaveBeenCalled();
  });

  it("删除成功：回到未下载态并请宿主重拉清单", async () => {
    const onChanged = vi.fn();
    function RemoveProbe() {
      const { state, remove } = useBuiltinFontDownload({ initial: DONE, onChanged });
      return (
        <div>
          <span data-testid="state">{state}</span>
          <button onClick={() => void remove()}>remove</button>
        </div>
      );
    }
    render(
      <AntdApp>
        <RemoveProbe />
      </AntdApp>,
    );
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "remove" }));
    await flush();

    expect(apiMocks.deleteBuiltinFont).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("state").textContent).toBe("idle");
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("删除的 404（本来就没下载）当成功：不弹错，状态回 idle", async () => {
    apiMocks.deleteBuiltinFont.mockRejectedValueOnce(new ApiError("not downloaded", 404));
    renderProbe();
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "remove" }));
    await flush();

    expect(screen.getByTestId("state").textContent).toBe("idle");
    // 幂等分支不该弹失败提示（`deleteFailed` 的定长前缀就是不出现）。
    expect(document.body.textContent).not.toContain(t("fontDownload.deleteFailed", { error: "" }));
  });

  it("删除失败（文件被占用）弹原因，状态保持", async () => {
    function DoneProbe() {
      const { state, remove } = useBuiltinFontDownload({ initial: DONE });
      return (
        <div>
          <span data-testid="state">{state}</span>
          <button onClick={() => void remove()}>remove</button>
        </div>
      );
    }
    apiMocks.deleteBuiltinFont.mockRejectedValueOnce(
      new ApiError("字体文件正被占用，无法删除", 500),
    );
    render(
      <AntdApp>
        <DoneProbe />
      </AntdApp>,
    );
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "remove" }));
    await flush();

    expect(document.body.textContent).toContain(
      t("fontDownload.deleteFailed", { error: "字体文件正被占用，无法删除" }),
    );
    // 故意不刷新清单：文件还在，界面不该假装它没了。
    expect(screen.getByTestId("state").textContent).toBe("done");
  });
});
