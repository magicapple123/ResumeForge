// SPDX-License-Identifier: Apache-2.0
/**
 * R-28 左栏页签吸顶的**可单测那一半**：切页签把整列的 `scrollTop` 归零。
 *
 * 吸顶本身（`position: sticky`）要靠真实布局，jsdom 量不到；能钉住的是"上一页签滚到
 * 一半的位置不许带到下一页签"这条行为——页签条吸顶之后它尤其明显：新页签第一屏
 * 从中间开始，页签条却已经贴在顶上，看起来像内容缺失。
 *
 * jsdom 没有布局，`scrollTop` 的赋值会被夹到 0（scrollHeight/clientHeight 都是 0），
 * 断言不出"到底写没写"。所以这里把该属性换成记录器，直接看组件写了什么。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
});

const LAYOUT: ResumeLayout = {
  template: "classic",
  format_name: "",
  page_limit: 1,
  font_scale: "standard",
  format_config: {} as ResumeLayout["format_config"],
};

function Harness() {
  const [layout, setLayout] = useState<ResumeLayout>(LAYOUT);
  const [document] = useState<ResumeDocument>(() => makeResumeDocument());
  const previewRef = useRef<ResumePreviewHandle>(null);
  return (
    <WorkbenchParamsColumnV2
      layout={layout}
      baseline={layout}
      relayouting={false}
      previewRef={previewRef}
      tier="three"
      editorEnabled
      onChange={setLayout}
      document={document}
      onDocumentChange={vi.fn()}
      pagesNeeded={null}
    />
  );
}

/** #7 / #13 的宿主接线：带记录 id（文档模式才会渲染）的同一份左栏。 */
function RecordHarness() {
  const [layout, setLayout] = useState<ResumeLayout>(LAYOUT);
  const [document] = useState<ResumeDocument>(() => makeResumeDocument());
  const previewRef = useRef<ResumePreviewHandle>(null);
  return (
    <WorkbenchParamsColumnV2
      layout={layout}
      baseline={layout}
      relayouting={false}
      previewRef={previewRef}
      tier="three"
      editorEnabled
      resumeId={1}
      revision={1}
      onChange={setLayout}
      document={document}
      onDocumentChange={vi.fn()}
      pagesNeeded={null}
    />
  );
}

describe("WorkbenchParamsColumnV2 · 分组归属（#7 / #13）", () => {
  it("the standalone typography tools panel is offline in the params tab (#7)", () => {
    const { container } = render(
      <AntdApp>
        <RecordHarness />
      </AntdApp>,
    );
    expect(container.querySelectorAll(".resume-typography-panel")).toHaveLength(0);
    expect(screen.queryByText(t("structure.typographyTools.title"))).toBeNull();
  });

  it("field language lives in the page group, right after document mode (#13)", () => {
    const { container } = render(
      <AntdApp>
        <RecordHarness />
      </AntdApp>,
    );
    const groups = Array.from(container.querySelectorAll<HTMLElement>(".resume-wb-group"));
    const [templateGroup, pageGroup] = groups;
    const language = t("resume.language.label");
    expect(templateGroup.textContent).not.toContain(language);
    const pageText = pageGroup.textContent ?? "";
    expect(pageText).toContain(language);
    // 文档模式在前、字段语言紧随其后（不是"版面组最末"）。
    expect(pageText.indexOf(t("research.mode.label"))).toBeGreaterThanOrEqual(0);
    expect(pageText.indexOf(t("research.mode.label"))).toBeLessThan(pageText.indexOf(language));
    // 联系方式换行只有一个入口。
    expect(within(pageGroup).getAllByText(t("workbench.contactBreak.label"))).toHaveLength(1);
  });
});

describe("WorkbenchParamsColumnV2 · 切页签回到顶部（R-28）", () => {
  it("换页签时把整列 scrollTop 归零", () => {
    const { container } = render(
      <AntdApp>
        <Harness />
      </AntdApp>,
    );
    const column = container.querySelector<HTMLElement>(".resume-wb-v2-params");
    expect(column).not.toBeNull();
    let written: number | null = null;
    Object.defineProperty(column as HTMLElement, "scrollTop", {
      configurable: true,
      get: () => written ?? 0,
      set: (value: number) => {
        written = value;
      },
    });

    fireEvent.click(screen.getByRole("tab", { name: t("structure.panel.title") }));

    expect(written).toBe(0);
  });
});
