// SPDX-License-Identifier: Apache-2.0
/**
 * 「简历制作台」列宽交互：参数栏与内容栏都可拖 + 动作条「恢复默认列宽」。
 *
 * 从 `ResumeZoomModal.test.tsx` 拆出（2026-10-25）：外壳结构/窄档/动作条那批用例已经
 * 接近 500 行测试预算，而这一组是**纯拖拽状态机**，共享同一份 `renderModal` 夹具。
 * 两条 `vi.mock` 必须写在这里（按模块提升，只作用于本文件的模块图）。
 */
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import { TEMPLATE_CATALOG } from "../../test/resumeFixtures";
import { body, renderModal } from "./ResumeZoomModal.testkit";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  localStorage.clear();
  vi.restoreAllMocks();
});

// 目录只取一次（组件自己调 hook）；这里直接下发夹具，避免多一次网络桩。
vi.mock("../../hooks/useResumeTemplateCatalog", () => ({
  useResumeTemplateCatalog: () => ({ catalog: TEMPLATE_CATALOG }),
}));
// 画布里的预览是真 iframe + 量高（`ResumePreview` 自有其用例），与列宽断言无关。
vi.mock("../ResumePreview", () => ({
  default: () => <div data-testid="workbench-preview" />,
}));

describe("简历制作台 · 列宽（参数栏与内容栏都可拖）", () => {
  /** 按 data-column 找分隔条：两条（参数栏 / 内容栏），不能靠"第几条"猜。 */
  function resizer(kind: "params" | "editor"): HTMLElement {
    const node = document.querySelector<HTMLElement>(`.resume-wb-resizer[data-column="${kind}"]`);
    expect(node, `没有 ${kind} 分隔条`).not.toBeNull();
    return node as HTMLElement;
  }

  /** 容器宽度量不到时 hook 回落到窗口宽度：给一个够宽的值，clamp 才不会一直压到下限。 */
  function wideWindow(): void {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1800 });
  }

  function cssVar(kind: "params" | "editor"): string {
    return body().style.getPropertyValue(`--resume-wb-${kind}`);
  }

  it("两条分隔条：参数栏 360–640（默认 380）、内容栏 380–760（默认 448）", () => {
    renderModal();

    expect(document.querySelectorAll(".resume-wb-resizer")).toHaveLength(2);
    const params = resizer("params");
    expect(params).toHaveAttribute("role", "separator");
    expect(params).toHaveAttribute("aria-orientation", "vertical");
    expect(params).toHaveAttribute("aria-valuemin", "360");
    expect(params).toHaveAttribute("aria-valuemax", "640");
    expect(params).toHaveAttribute("aria-valuenow", "380");
    expect(params).toHaveAttribute("tabindex", "0");

    const editor = resizer("editor");
    expect(editor).toHaveAttribute("role", "separator");
    expect(editor).toHaveAttribute("aria-valuemin", "380");
    expect(editor).toHaveAttribute("aria-valuemax", "760");
    expect(editor).toHaveAttribute("aria-valuenow", "448");

    // 2026-10-25 用户口径：第一列也支持调整宽度（默认仍是 380）。
    expect(cssVar("params")).toBe("380px");
    expect(cssVar("editor")).toBe("448px");
  });

  it("拖动参数栏分隔条改宽，松手后写进 localStorage", () => {
    wideWindow();
    renderModal();

    const params = resizer("params");
    fireEvent.mouseDown(params, { clientX: 400, button: 0 });
    // 拖动中宽度已经跟着走（只写 CSS 自定义属性，不等 React 渲染）。
    fireEvent.mouseMove(window, { clientX: 460, buttons: 1 });
    expect(cssVar("params")).toBe("440px");
    // 另一栏不受影响。
    expect(cssVar("editor")).toBe("448px");
    expect(localStorage.getItem("resume.wb.widths")).toBeNull();

    fireEvent.mouseUp(window);
    expect(localStorage.getItem("resume.wb.widths")).toBe(
      JSON.stringify({ params: 440, editor: 448 }),
    );
    // 松手后不再跟随鼠标：监听器必须摘掉。
    fireEvent.mouseMove(window, { clientX: 520, buttons: 1 });
    expect(cssVar("params")).toBe("440px");
  });

  it("拖动内容栏分隔条改宽，松手后写进 localStorage", () => {
    wideWindow();
    renderModal();

    const editor = resizer("editor");
    fireEvent.mouseDown(editor, { clientX: 700, button: 0 });
    // `buttons: 1` 不能省：jsdom 的 MouseEvent 默认 `buttons = 0`，而 hook 正是靠
    // `buttons === 0` 判断"松手发生在收不到 mouseup 的地方"。
    fireEvent.mouseMove(window, { clientX: 760, buttons: 1 });
    expect(cssVar("editor")).toBe("508px");
    expect(cssVar("params")).toBe("380px");
    fireEvent.mouseUp(window);
    expect(localStorage.getItem("resume.wb.widths")).toBe(
      JSON.stringify({ params: 380, editor: 508 }),
    );
  });

  it("拖动中左键已经松开（buttons=0）时自动收尾，不会一直保持拖动（用户报的卡死）", () => {
    wideWindow();
    renderModal();

    const editor = resizer("editor");
    fireEvent.mouseDown(editor, { clientX: 700, button: 0 });
    fireEvent.mouseMove(window, { clientX: 760, buttons: 1 });
    expect(cssVar("editor")).toBe("508px");

    // 模拟"松手发生在收不到 mouseup 的地方"：故意不派发 mouseup，只派发 buttons=0 的 mousemove。
    fireEvent.mouseMove(window, { clientX: 820, buttons: 0 });

    expect(cssVar("editor")).toBe("508px");
    expect(document.body).not.toHaveClass("is-resizing");
    expect(localStorage.getItem("resume.wb.widths")).toBe(
      JSON.stringify({ params: 380, editor: 508 }),
    );
  });

  it("键盘 ←/→ 每次 16px 并立即持久化，越界被夹在区间内", () => {
    wideWindow();
    renderModal();

    const params = resizer("params");
    fireEvent.keyDown(params, { key: "ArrowRight" });
    expect(cssVar("params")).toBe("396px");
    fireEvent.keyDown(params, { key: "ArrowRight" });
    expect(cssVar("params")).toBe("412px");
    // 连按到下限：396 → 380 → 364 → 348 会被夹回 360。
    fireEvent.keyDown(params, { key: "ArrowLeft" });
    fireEvent.keyDown(params, { key: "ArrowLeft" });
    fireEvent.keyDown(params, { key: "ArrowLeft" });
    fireEvent.keyDown(params, { key: "ArrowLeft" });
    expect(cssVar("params")).toBe("360px");
    expect(localStorage.getItem("resume.wb.widths")).toBe(
      JSON.stringify({ params: 360, editor: 448 }),
    );

    const editor = resizer("editor");
    fireEvent.keyDown(editor, { key: "ArrowRight" });
    expect(cssVar("editor")).toBe("464px");
    // 上限：连按会停在 760，不会跑到 900。
    for (let index = 0; index < 40; index += 1) fireEvent.keyDown(editor, { key: "ArrowRight" });
    expect(cssVar("editor")).toBe("760px");
  });

  it("双击分隔条：两条都复位默认宽度", () => {
    wideWindow();
    renderModal();

    fireEvent.keyDown(resizer("params"), { key: "ArrowRight" });
    fireEvent.keyDown(resizer("editor"), { key: "ArrowRight" });
    expect(cssVar("params")).not.toBe("380px");
    expect(cssVar("editor")).not.toBe("448px");

    fireEvent.doubleClick(resizer("editor"));
    expect(cssVar("params")).toBe("380px");
    expect(cssVar("editor")).toBe("448px");
    expect(localStorage.getItem("resume.wb.widths")).toBe(
      JSON.stringify({ params: 380, editor: 448 }),
    );
  });

  it("动作条「恢复默认列宽」一键复位两条（全界面一个入口）", () => {
    wideWindow();
    renderModal();

    fireEvent.keyDown(resizer("params"), { key: "ArrowRight" });
    fireEvent.keyDown(resizer("editor"), { key: "ArrowRight" });

    const actionBar = document.querySelector<HTMLElement>(".resume-wb-actionbar");
    expect(actionBar).not.toBeNull();
    const reset = within(actionBar as HTMLElement).getByRole("button", {
      // 图标按钮的可访问名会带图标名（`column-width 恢复默认列宽`），按子串匹配。
      name: new RegExp(t("workbench.widths.reset")),
    });
    fireEvent.click(reset);

    expect(cssVar("params")).toBe("380px");
    expect(cssVar("editor")).toBe("448px");
    expect(localStorage.getItem("resume.wb.widths")).toBe(
      JSON.stringify({ params: 380, editor: 448 }),
    );
  });

  it("读取时 clamp 历史越界值：参数栏夹进 360–640，内容栏夹进 380–760", () => {
    localStorage.setItem("resume.wb.widths", JSON.stringify({ params: 9999, editor: 10 }));
    renderModal();

    expect(cssVar("params")).toBe("640px");
    expect(cssVar("editor")).toBe("380px");
  });

  it("坏数据不炸：解析失败退回默认宽度", () => {
    localStorage.setItem("resume.wb.widths", "{not json");
    renderModal();

    expect(cssVar("params")).toBe("380px");
    expect(cssVar("editor")).toBe("448px");
  });

  it("只读宿主（两栏）同样不给分隔条，也没有列宽复位入口", () => {
    renderModal({ onSaveContent: undefined });

    expect(document.querySelectorAll(".resume-wb-resizer")).toHaveLength(0);
    expect(
      screen.queryByRole("button", { name: new RegExp(t("workbench.widths.reset")) }),
    ).toBeNull();
  });
});
