// SPDX-License-Identifier: Apache-2.0
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import WorkspacePresetControl from "./WorkspacePresetControl";

function renderControl(props: Partial<Parameters<typeof WorkspacePresetControl>[0]> = {}) {
  const base = {
    value: "default" as const,
    onChange: vi.fn(),
    onReset: vi.fn(),
  };
  return {
    ...render(
      <AntdApp>
        <WorkspacePresetControl {...base} {...props} />
      </AntdApp>,
    ),
    ...base,
    ...props,
  };
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("工作区预设切换（D14）", () => {
  it("四个预设选项都可见，分段控件有 aria 名", () => {
    renderControl();
    expect(
      screen.getByRole("radiogroup", { name: t("proview.workspace.label") }),
    ).toBeInTheDocument();
    for (const key of [
      "proview.workspace.default",
      "proview.workspace.writing",
      "proview.workspace.typography",
      "proview.workspace.delivery",
    ] as const) {
      expect(screen.getByText(t(key))).toBeInTheDocument();
    }
  });

  it("选择预设回传 onChange，并给出带名字的提示", async () => {
    const onChange = vi.fn();
    renderControl({ onChange });
    fireEvent.click(screen.getByText(t("proview.workspace.typography")));
    expect(onChange).toHaveBeenCalledWith("typography");
    expect(
      await screen.findByText(
        t("proview.workspace.switched", { name: t("proview.workspace.typography") }),
      ),
    ).toBeInTheDocument();
  });

  it("悬停预设选项不再弹提示；只有「恢复默认布局」保留一条（2026-10-29 用户要求）", async () => {
    renderControl();
    const visibleTip = () =>
      [...document.querySelectorAll(".ant-tooltip")].filter(
        (node) => !node.classList.contains("ant-tooltip-hidden"),
      );

    // 预设那一段：撤掉了外层提示，也不许给选项各套一层——悬停必须是**零**浮层。
    fireEvent.mouseEnter(screen.getByText(t("proview.workspace.default")));
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(visibleTip()).toHaveLength(0);

    // 恢复默认这颗按钮仍在提示里说明它是干什么的（用户点名保留的三条之一）。
    fireEvent.mouseEnter(screen.getByRole("button", { name: t("proview.workspace.reset") }));
    await waitFor(() => expect(visibleTip()).toHaveLength(1), { timeout: 2000 });
    expect(visibleTip()[0]?.textContent ?? "").toContain(t("proview.workspace.reset"));
  });

  it("恢复默认布局是独立入口（不占预设列表一格）", async () => {
    const onReset = vi.fn();
    renderControl({ onReset });
    fireEvent.click(screen.getByRole("button", { name: t("proview.workspace.reset") }));
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(t("proview.workspace.resetToast"))).toBeInTheDocument();
  });
});
