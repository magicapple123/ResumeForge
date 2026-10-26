// SPDX-License-Identifier: Apache-2.0
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Suspense } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AppErrorBoundary from "./AppErrorBoundary";
import { lazyPage } from "../pages/registry";
import { t } from "../i18n";

function BrokenView(): never {
  throw new Error("render failed");
}

/** 懒加载的页面代码没取到时的真实报错文案（Chromium）。 */
function ModuleLoadFailureView(): never {
  throw new TypeError(
    "Failed to fetch dynamically imported module: http://127.0.0.1:5173/src/pages/ApplyPage.tsx",
  );
}

/** 渲染一个必然抛错的子树，并压掉 React/jsdom 转发到控制台与 window 的报错。
 *
 * 参数必须是**组件**而不是调用结果：`child()` 在测试自己的作用域里求值的话，
 * 异常根本不会经过错误边界。
 */
function renderBroken(View: () => never, onReload = vi.fn()): ReturnType<typeof vi.fn> {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const preventJsdomReport = (event: ErrorEvent) => event.preventDefault();
  window.addEventListener("error", preventJsdomReport);
  try {
    render(
      <AppErrorBoundary onReload={onReload}>
        <View />
      </AppErrorBoundary>,
    );
  } finally {
    window.removeEventListener("error", preventJsdomReport);
  }
  return onReload;
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("AppErrorBoundary", () => {
  it("shows a recoverable fallback when a child crashes", () => {
    const reload = renderBroken(BrokenView);

    expect(screen.getByText("页面暂时无法显示")).toBeInTheDocument();
    // 两字中文按钮 antd 会自动插空格（"刷 新"），按正则匹配。
    fireEvent.click(screen.getByRole("button", { name: /刷\s*新/ }));
    expect(reload).toHaveBeenCalledOnce();
  });

  it("把原始报错显示出来，便于定位而不是只给一句「运行时异常」", () => {
    renderBroken(BrokenView);

    expect(screen.getByText(/原因：render failed/)).toBeInTheDocument();
  });

  it("动态 import 失败时给出「重启 dev server」的可执行指引", () => {
    renderBroken(ModuleLoadFailureView);

    // 这一类刷新无用（是 dev server 缓存了旧模块解析），所以不能只说"刷新"。
    expect(screen.getByText("页面代码没能加载完整")).toBeInTheDocument();
    expect(screen.getByText(/重启前端开发服务器/)).toBeInTheDocument();
    expect(screen.queryByText("页面暂时无法显示")).not.toBeInTheDocument();
  });

  it("模块加载失败后点「重试」会真的重新取一次页面（渲染层证明，不只清提示）", async () => {
    // React 会把边界捕获的异常转发到 console.error；这里只关心可恢复性。
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let calls = 0;
    // 用显式开关而不是"第一次失败、第二次成功"：React 在错误路径上可能重渲染不止一次，
    // 按调用次数判断会让用例的成败取决于框架内部重试了几次。
    let allowSuccess = false;
    const Page = lazyPage(async () => {
      calls += 1;
      if (!allowSuccess) {
        // 与浏览器里 chunk 取不到时的文案一致，错误边界才会认成"模块加载失败"。
        throw new TypeError(
          "Failed to fetch dynamically imported module: http://127.0.0.1:5173/src/pages/ApplyPage.tsx",
        );
      }
      return { default: () => <div>page-ready</div> };
    });

    render(
      <AppErrorBoundary>
        <Suspense fallback={<div>loading</div>}>
          <Page />
        </Suspense>
      </AppErrorBoundary>,
    );

    // antd 会在两个汉字之间插一个空格（"重 试"），所以比较前先把空格去掉。
    // 先等错误边界落屏（懒加载的 reject 要走完一轮微任务），再放开重试。
    const retryButton = await waitFor(() => {
      return screen.getByRole("button", {
        name: new RegExp(t("common.retry").split("").join("\\s*")),
      });
    });
    const before = calls;
    allowSuccess = true;
    fireEvent.click(retryButton);

    // 关键断言：页面真的出现了，且 factory 在点击之后又被执行过——只重置 failed 状态
    // 是不够的，React.lazy 自己会永久缓存第一次的 rejection（这条用例就是那次回归的证据）。
    expect(await screen.findByText("page-ready")).toBeInTheDocument();
    expect(calls).toBeGreaterThan(before);
  });
});
