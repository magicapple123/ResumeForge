// SPDX-License-Identifier: Apache-2.0
/**
 * 页头动作区：桌面壳里不渲染页内「退出」，浏览器发行版必须保留
 * （问题清单 §18.2-A / §18.5：组件本身不删——浏览器版靠它停掉后端与 Vite）。
 */
import { App as AntdApp } from "antd";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AppHeaderActions from "./AppHeaderActions";
import { t } from "../i18n";

// 只验"退出按钮在不在"，其余动作一律用空桩，避免把整张页头依赖图拖进本用例。
vi.mock("./ThemeSwitch", () => ({ default: () => null }));
vi.mock("./ModelProfileSelect", () => ({ default: () => null }));
vi.mock("./BackgroundTasksIndicator", () => ({ default: () => null }));
vi.mock("./AppHeaderContext", () => ({ default: () => null }));
vi.mock("./navigation/MySpaceMenu", () => ({ default: () => null }));
vi.mock("../features/career-scenarios/ScenarioSelector", () => ({ default: () => null }));

type SplashWindow = Window & { splash?: { isDesktop?: boolean; quitApp?: () => void } };

function renderActions() {
  return render(
    <AntdApp>
      <AppHeaderActions hiddenKeys={[]} onStarClick={() => undefined} />
    </AntdApp>,
  );
}

afterEach(() => {
  cleanup();
  delete (window as SplashWindow).splash;
});

describe("AppHeaderActions", () => {
  it("浏览器（没有 window.splash）：保留页内退出按钮", () => {
    renderActions();
    expect(screen.getByRole("button", { name: t("common.exitApp.aria") })).toBeInTheDocument();
  });

  it("桌面壳（window.splash.isDesktop）：不渲染页内退出按钮，其它动作不变", () => {
    (window as SplashWindow).splash = { isDesktop: true, quitApp: () => undefined };
    renderActions();

    expect(screen.queryByRole("button", { name: t("common.exitApp.aria") })).toBeNull();
    // GitHub 入口仍在（页头其它动作一律不动，§18.2-A）。
    expect(
      screen.getByRole("link", {
        name: t("appConfig.header.repoAria", { name: t("appConfig.brand.name") }),
      }),
    ).toBeInTheDocument();
  });
});
