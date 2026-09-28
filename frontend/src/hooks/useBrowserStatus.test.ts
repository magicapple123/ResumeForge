import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserStatus } from "../types";
import { useBrowserStatus } from "./useBrowserStatus";

const STATUS: BrowserStatus = {
  state: "running",
  port: 9333,
  profile_dir: "C:/data/browser-profile",
  browser_path: "C:/chrome.exe",
  browser_name: "Google Chrome",
  entry_url: "",
  logged_in_hint: "",
  owned: true,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useBrowserStatus", () => {
  it("首屏读取后持续轮询，让窗口被用户关掉时能及时反映", async () => {
    const fetcher = vi.fn().mockResolvedValue(STATUS);

    renderHook(() => useBrowserStatus(fetcher, 20));

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(fetcher.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("接口比轮询间隔慢时，数据照样能落地", async () => {
    // **这不是假想的边界，是实测到的线上形状**：浏览器状态接口耗时 2.0s，而轮询间隔是
    // 1.5s。固定间隔轮询 + `useApi` 里那个防乱序的版本号守卫，会让**每一个响应都被判为
    // 过期丢掉**——`data` 永远不落地（界面停在初始的「未启动」），`setLoading(false)`
    // 也永远不执行（加载图标一直转）。接口越慢越稳定复现。
    //
    // 这里刻意让耗时（60ms）**远大于**间隔（10ms）。改回 `setInterval` 的话，
    // 下面这条 `data` 断言会超时——那是这个 bug 唯一不靠时序的判据。
    //
    // （不顺手断言 `loading === false`：自定步之后两轮之间只有 10ms 空隙，抓它本身就是
    // 竞态；而"加载图标一直转"是 data 不落地的**副产品**，钉住 data 就钉住了因。）
    const slow = vi.fn(
      () => new Promise<BrowserStatus>((resolve) => window.setTimeout(() => resolve(STATUS), 60)),
    );

    const { result } = renderHook(() => useBrowserStatus(slow, 10));

    await waitFor(() => expect(result.current.data).toEqual(STATUS), { timeout: 3000 });
  });
});
