// SPDX-License-Identifier: Apache-2.0
/** 侧栏手动折叠：状态持久化 + 窄档由外层强制折叠（这里只测 hook 自己的语义）。 */

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useSiderCollapse } from "./useSiderCollapse";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(cleanup);

describe("useSiderCollapse", () => {
  it("默认展开；toggle 后收起并写入本地偏好", () => {
    const { result } = renderHook(() => useSiderCollapse());

    expect(result.current.collapsed).toBe(false);
    act(() => result.current.toggle());
    expect(result.current.collapsed).toBe(true);
    expect(window.localStorage.getItem("rf_sider_collapsed")).toBe("1");
  });

  it("重新挂载时读回上次的选择", () => {
    window.localStorage.setItem("rf_sider_collapsed", "1");

    const { result } = renderHook(() => useSiderCollapse());

    expect(result.current.collapsed).toBe(true);
    act(() => result.current.toggle());
    expect(window.localStorage.getItem("rf_sider_collapsed")).toBe("0");
  });
});
