// SPDX-License-Identifier: Apache-2.0
/**
 * I-16 的**回归护栏**（2026-11-18）。
 *
 * 取证结论（`deliverables/execution/evidence/I-16/verify.md`）：在当前代码上"调参数后
 * 左栏自己跳到结构页签"**不复现**——参数提交路径（`onChange` / `onDocumentChange`）从不
 * 调用 `changeTab`。既然现象不复现，本文件钉住的就不是"修好了什么"，而是**不许再坏**：
 *
 * 1. 提交一次参数（点参数行的「增加」）→ 页签仍是「排版参数」、整列 `scrollTop` 不被写 0；
 * 2. 提交不得重置分组折叠态（`ResumeParamGroup` 的 `storageKey` 记忆）；
 * 3. 回归：断页汇总芯片仍是**唯一合法**的"切到结构页签"入口，点它必须照样能用。
 *
 * jsdom 没有布局、`scrollTop` 的赋值会被夹到 0，所以这里把该属性换成记录器：看组件
 * **写了什么**，而不是看它最后读到什么（与 `WorkbenchParamsColumnV2.tabs.test.tsx` 同法）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import type { ResumeLayout } from "../../../types";
import type { ResumeDocument } from "../../../types/resumeDocument";
import { makeResumeDocument } from "../../../test/documentHarness";
import type { ResumePreviewHandle } from "../preview/ResumePreview";
import WorkbenchParamsColumnV2 from "./WorkbenchParamsColumnV2";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  window.sessionStorage.clear();
});

const LAYOUT: ResumeLayout = {
  template: "classic",
  format_name: "",
  page_limit: 1,
  font_scale: "standard",
  format_config: {} as ResumeLayout["format_config"],
};

/** 第一板块带「从新页开始」：断页汇总里会出现一枚可点芯片。 */
function documentWithBreak(): ResumeDocument {
  const base = makeResumeDocument();
  return {
    ...base,
    sections: base.sections.map((section, index) =>
      index === 0
        ? { ...section, layout: { ...section.layout, start_on_new_page: true } }
        : section,
    ),
  };
}

function Harness({
  document: doc,
  onLayoutChange,
  onSelectPath,
}: {
  document: ResumeDocument;
  onLayoutChange?: (next: ResumeLayout) => void;
  onSelectPath?: (path: string | null) => void;
}) {
  const [layout, setLayout] = useState<ResumeLayout>(LAYOUT);
  const [document] = useState<ResumeDocument>(() => doc);
  const previewRef = useRef<ResumePreviewHandle>(null);
  return (
    <WorkbenchParamsColumnV2
      layout={layout}
      baseline={layout}
      relayouting={false}
      previewRef={previewRef}
      tier="three"
      editorEnabled
      onChange={(next) => {
        setLayout(next);
        onLayoutChange?.(next);
      }}
      document={document}
      onDocumentChange={vi.fn()}
      onSelectPath={onSelectPath}
      pagesNeeded={null}
    />
  );
}

/** 整列的 scrollTop 换成记录器：初值 640（模拟"用户已经滚到中部"）。 */
function recordScroll(container: HTMLElement): { written: () => number[] } {
  const column = container.querySelector<HTMLElement>(".resume-wb-v2-params");
  expect(column).not.toBeNull();
  const writes: number[] = [];
  Object.defineProperty(column as HTMLElement, "scrollTop", {
    configurable: true,
    get: () => 640,
    set: (value: number) => {
      writes.push(value);
    },
  });
  return { written: () => writes };
}

/** 参数行上的「增加」按钮（读数 +1）。 */
function increaseButtons(): HTMLElement[] {
  return screen
    .getAllByRole("button")
    .filter((button) => (button.getAttribute("aria-label") ?? "").includes("增加"))
    .filter((button) => !(button as HTMLButtonElement).disabled);
}

function selectedTab(container: HTMLElement): string | null {
  const active = container.querySelector('[data-tab][aria-selected="true"]');
  return active ? active.getAttribute("data-tab") : null;
}

describe("WorkbenchParamsColumnV2 · 参数提交不导航（I-16）", () => {
  it("点「增加」提交一次版式后：页签仍是排版参数，整列 scrollTop 没有被写", async () => {
    const onLayoutChange = vi.fn();
    const { container } = render(
      <AntdApp>
        <Harness document={makeResumeDocument()} onLayoutChange={onLayoutChange} />
      </AntdApp>,
    );
    const scroll = recordScroll(container);
    expect(selectedTab(container)).toBe("params");

    const buttons = increaseButtons();
    expect(buttons.length).toBeGreaterThan(0);
    fireEvent.click(buttons[0]);

    // 参数行有 120ms 提交防抖（`COMMIT_DEBOUNCE_MS`），必须等它到点
    await waitFor(() => expect(onLayoutChange).toHaveBeenCalledTimes(1));
    expect(selectedTab(container)).toBe("params");
    // 一次写入都不该有：清零是 changeTab 的副作用，提交路径不该走到那里
    expect(scroll.written()).toEqual([]);
  });

  it("连续 10 次提交：页签与滚动位置都不动（对齐验收第 1 条）", async () => {
    const onLayoutChange = vi.fn();
    const { container } = render(
      <AntdApp>
        <Harness document={makeResumeDocument()} onLayoutChange={onLayoutChange} />
      </AntdApp>,
    );
    const scroll = recordScroll(container);
    for (let i = 0; i < 10; i += 1) {
      const buttons = increaseButtons();
      if (buttons.length === 0) break;
      fireEvent.click(buttons[0]);
    }
    await waitFor(() => expect(onLayoutChange.mock.calls.length).toBeGreaterThan(0));
    expect(selectedTab(container)).toBe("params");
    expect(scroll.written()).toEqual([]);
  });

  it("提交不重置分组折叠态（通用约束 3）", async () => {
    const onLayoutChange = vi.fn();
    const { container } = render(
      <AntdApp>
        <Harness document={makeResumeDocument()} onLayoutChange={onLayoutChange} />
      </AntdApp>,
    );
    const templateToggle = screen.getByRole("button", { name: t("workbench.group.template") });
    expect(templateToggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(templateToggle);
    expect(templateToggle.getAttribute("aria-expanded")).toBe("false");

    const buttons = increaseButtons();
    expect(buttons.length).toBeGreaterThan(0);
    fireEvent.click(buttons[0]);
    await waitFor(() => expect(onLayoutChange).toHaveBeenCalled());

    // 折叠态是 localStorage 记忆的长期偏好，不能因为"提交了一次"就弹开
    expect(
      screen
        .getByRole("button", { name: t("workbench.group.template") })
        .getAttribute("aria-expanded"),
    ).toBe("false");
    expect(container.querySelectorAll(".resume-wb-group-body").length).toBeLessThan(
      container.querySelectorAll(".resume-wb-group").length,
    );
  });
});

describe("WorkbenchParamsColumnV2 · 断页芯片仍是唯一合法切页签入口（I-16 回归）", () => {
  it("点汇总芯片切到结构页签并选中该节点", async () => {
    const onSelectPath = vi.fn();
    const { container } = render(
      <AntdApp>
        <Harness document={documentWithBreak()} onSelectPath={onSelectPath} />
      </AntdApp>,
    );
    const newPageToggle = container.querySelector<HTMLElement>(".resume-wb-newpage-toggle");
    expect(newPageToggle).not.toBeNull();
    fireEvent.click(newPageToggle as HTMLElement);

    const chip = container.querySelector<HTMLElement>(
      "[data-break-chip] .resume-pagination-break-label",
    );
    expect(chip).not.toBeNull();
    fireEvent.click(chip as HTMLElement);

    expect(onSelectPath).toHaveBeenCalledTimes(1);
    expect(selectedTab(container)).toBe("structure");
  });
});
