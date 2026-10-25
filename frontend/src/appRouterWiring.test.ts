// SPDX-License-Identifier: Apache-2.0
/**
 * 生产路由装配守卫（2026-10-25 崩溃回归）：
 * 资料页的未保存离开守卫用 react-router 的 `useBlocker`，它要求 **data router**；
 * 生产入口若退回声明式 `<BrowserRouter>`，点「我的资料」就会抛
 * "useBlocker must be used within a data router" 并落到错误屏。
 * 本测试钉住两件事：main.tsx 使用 createBrowserRouter + RouterProvider；
 * 共用路由表里确实有 /profile。
 */
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import mainSource from "./main.tsx?raw";
import { APP_ROOT_ROUTE } from "./appRoutes";

function collectPaths(
  element: ReactElement | ReactElement[] | string | number | null | undefined,
): string[] {
  if (
    element === null ||
    element === undefined ||
    typeof element === "string" ||
    typeof element === "number"
  )
    return [];
  if (Array.isArray(element)) return element.flatMap(collectPaths);
  const props = element.props as { path?: string; children?: ReactElement | ReactElement[] };
  const own = typeof props.path === "string" ? [props.path] : [];
  return [...own, ...collectPaths(props.children)];
}

describe("production router wiring", () => {
  it("uses a data router at the app entry (useBlocker requirement)", () => {
    // 注释里会提到旧写法（解释为什么不能再用），判定只看代码本体。
    const mainCode = mainSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(mainCode).toMatch(/createBrowserRouter/);
    expect(mainCode).toMatch(/createRoutesFromElements/);
    expect(mainCode).toMatch(/<RouterProvider\b/);
    expect(mainCode).not.toMatch(/<BrowserRouter\b/);
  });

  it("keeps the shared route table complete (profile route included)", () => {
    const paths = collectPaths(APP_ROOT_ROUTE);
    expect(paths).toContain("/profile");
    expect(paths).toContain("/");
    expect(paths).toContain("*");
  });
});
