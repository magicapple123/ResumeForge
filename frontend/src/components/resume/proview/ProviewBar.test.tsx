// SPDX-License-Identifier: Apache-2.0
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import type { PageNavigation } from "../../../features/resume-proview/usePageNavigation";
import ProviewBar from "./ProviewBar";

function navigation(overrides: Partial<PageNavigation> = {}): PageNavigation {
  return {
    currentPage: 1,
    totalPages: 2,
    goToPage: vi.fn(),
    nextPage: vi.fn(),
    previousPage: vi.fn(),
    scrollable: true,
    ...overrides,
  };
}

function renderBar(props: Partial<Parameters<typeof ProviewBar>[0]> = {}) {
  const base: Parameters<typeof ProviewBar>[0] = {
    zoomMode: "page",
    onZoomModeChange: vi.fn(),
    scale: 0.8,
    navigation: navigation(),
    guides: { margins: false, columns: false, baselines: false, paragraphs: false },
    onGuidesChange: vi.fn(),
    proof: false,
    onProofChange: vi.fn(),
    viewportRef: { current: null },
    showPhotoCrop: false,
    onOpenPhotoCrop: vi.fn(),
    onOpenPalette: vi.fn(),
    paletteShortcut: "Ctrl+Shift+P",
  };
  const merged = { ...base, ...props };
  return {
    ...render(
      <AntdApp>
        <ProviewBar {...merged} />
      </AntdApp>,
    ),
    props: merged,
  };
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("专业视图工具条（D04/D05/D10 入口 + 键盘）", () => {
  it("工具条有 aria 名；三个缩放档位与比例读数可见", () => {
    renderBar();
    expect(screen.getByRole("toolbar", { name: t("proview.bar.label") })).toBeInTheDocument();
    expect(screen.getByText(t("proview.zoom.page"))).toBeInTheDocument();
    expect(screen.getByText(t("proview.zoom.width"))).toBeInTheDocument();
    expect(screen.getByText(t("proview.zoom.actual"))).toBeInTheDocument();
    expect(screen.getByText(t("proview.zoom.percent", { value: 80 }))).toBeInTheDocument();
  });

  it("选择「适宽」回传 width；100% 档显示系统缩放声明", () => {
    const onZoomModeChange = vi.fn();
    renderBar({ onZoomModeChange });
    fireEvent.click(screen.getByText(t("proview.zoom.width")));
    expect(onZoomModeChange).toHaveBeenCalledWith("width");
    cleanup();
    renderBar({ zoomMode: "actual", scale: 1 });
    expect(screen.getByText(t("proview.zoom.actualNote"))).toBeInTheDocument();
  });

  it("PageUp / PageDown 在工具条上翻页；输入框里不抢键", () => {
    const nextPage = vi.fn();
    const previousPage = vi.fn();
    renderBar({ navigation: navigation({ nextPage, previousPage }) });
    const toolbar = screen.getByRole("toolbar", { name: t("proview.bar.label") });
    fireEvent.keyDown(toolbar, { key: "PageDown" });
    expect(nextPage).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(toolbar, { key: "PageUp" });
    expect(previousPage).toHaveBeenCalledTimes(1);
    const input = screen.getByRole("spinbutton", {
      name: t("proview.pageNav.inputAria", { total: 2 }),
    });
    fireEvent.keyDown(input, { key: "PageDown" });
    expect(nextPage).toHaveBeenCalledTimes(1);
  });

  it("灰度校样是开关（aria-pressed 随状态变化），辅助线弹层有四类勾选", () => {
    const onProofChange = vi.fn();
    const { rerender } = renderBar({ onProofChange });
    const proofButton = screen.getByRole("button", { name: t("proview.proof.label") });
    expect(proofButton).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(proofButton);
    expect(onProofChange).toHaveBeenCalledWith(true);
    rerender(
      <AntdApp>
        <ProviewBar
          {...{
            zoomMode: "page",
            onZoomModeChange: vi.fn(),
            scale: 0.8,
            navigation: navigation(),
            guides: { margins: true, columns: false, baselines: false, paragraphs: false },
            onGuidesChange: vi.fn(),
            proof: true,
            onProofChange,
            viewportRef: { current: null },
            showPhotoCrop: false,
            onOpenPhotoCrop: vi.fn(),
            onOpenPalette: vi.fn(),
            paletteShortcut: "Ctrl+Shift+P",
          }}
        />
      </AntdApp>,
    );
    expect(screen.getByRole("button", { name: t("proview.proof.label") })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const guidesButton = screen.getByRole("button", {
      name: t("proview.guides.count", { count: 1 }),
    });
    fireEvent.click(guidesButton);
    expect(screen.getByText(t("proview.guides.margins"))).toBeInTheDocument();
    expect(screen.getByText(t("proview.guides.baselines"))).toBeInTheDocument();
    expect(screen.getByText(t("proview.guides.hint"))).toBeInTheDocument();
  });

  it("页导航上的问题位置标记可点击跳页（W08 传入，缺省零变化）", () => {
    const goToPage = vi.fn();
    renderBar({
      navigation: navigation({ goToPage }),
      markers: [{ page: 2, severity: "blocker", count: 3 }],
    });
    const marker = screen.getByRole("button", {
      name: t("proview.pageNav.markerTip", { page: 2, count: 3 }),
    });
    fireEvent.click(marker);
    expect(goToPage).toHaveBeenCalledWith(2);
  });

  it("照片裁剪入口按有无照片出现；命令面板按钮有快捷键无障碍名", () => {
    const onOpenPalette = vi.fn();
    const onOpenPhotoCrop = vi.fn();
    renderBar({ onOpenPalette, onOpenPhotoCrop, showPhotoCrop: true });
    fireEvent.click(screen.getByRole("button", { name: t("proview.photo.button") }));
    expect(onOpenPhotoCrop).toHaveBeenCalledTimes(1);
    fireEvent.click(
      screen.getByRole("button", {
        name: t("proview.command.buttonAria", { shortcut: "Ctrl+Shift+P" }),
      }),
    );
    expect(onOpenPalette).toHaveBeenCalledTimes(1);
  });
});
