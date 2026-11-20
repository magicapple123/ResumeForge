// SPDX-License-Identifier: Apache-2.0
/** 「我的空间」按钮：组内页显示当前项名，组外仍显示分组名，可访问名始终以分组名开头。 */
import { App as AntdApp } from "antd";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import MySpaceMenu from "./MySpaceMenu";
import { selectLocale } from "../../i18n/localeStore";

function renderAt(pathname: string) {
  return render(
    <AntdApp>
      <MemoryRouter initialEntries={[pathname]}>
        <MySpaceMenu hiddenKeys={[]} />
      </MemoryRouter>
    </AntdApp>,
  );
}

afterEach(() => {
  cleanup();
  selectLocale("zh-CN");
});

describe("MySpaceMenu trigger label", () => {
  it("shows the current space item on its own page", () => {
    renderAt("/analytics");
    const button = screen.getByRole("button", { name: "我的空间：求职统计" });
    expect(button).toHaveTextContent("求职统计");
  });

  it("keeps the group name outside the group", () => {
    renderAt("/resumes");
    const button = screen.getByRole("button", { name: "我的空间" });
    expect(button).toHaveTextContent("我的空间");
    expect(button).not.toHaveTextContent("简历中心");
  });

  it("groups sub-pages under their parent entry (/claims/drill → 事实台账)", () => {
    renderAt("/claims/drill");
    const button = screen.getByRole("button", { name: "我的空间：事实台账" });
    expect(button).toHaveTextContent("事实台账");
    expect(button).not.toHaveTextContent("事实核对");
  });

  it("translates both the group name and the current item in English", () => {
    selectLocale("en-US");

    const analytics = renderAt("/analytics");
    expect(screen.getByRole("button", { name: "My space: Analytics" })).toHaveTextContent(
      "Analytics",
    );
    analytics.unmount();

    renderAt("/resumes");
    expect(screen.getByRole("button", { name: "My space" })).toHaveTextContent("My space");
  });
});
