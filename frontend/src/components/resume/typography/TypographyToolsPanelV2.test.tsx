// SPDX-License-Identifier: Apache-2.0
/**
 * v2 局部排版工具容器：条目选择（自管/受控）/ 对象级 / 文字级别 / 格式刷 / 多选批量 /
 * 同类段落；以及「只改 format_config，不动正文」的不变量。
 */
import { App as AntdApp } from "antd";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import type { RefObject } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { t } from "../../../i18n";
import type { ResumeLayout } from "../../../types";
import type { ResumePreviewHandle } from "../../ResumePreview";
import { makeDocument } from "../../../features/resume-document/documentFixtures";
import { emptyDocument } from "../../../features/resume-document/defaults";
import TypographyToolsPanelV2, { type TypographyToolsPanelV2Props } from "./TypographyToolsPanelV2";

afterEach(cleanup);

function baseLayout(format_config: Record<string, unknown> = {}): ResumeLayout {
  return {
    template: "classic",
    format_name: "",
    page_limit: 1,
    font_scale: "standard",
    format_config: format_config as unknown as ResumeLayout["format_config"],
  };
}

interface HarnessResult {
  onLayoutChange: ReturnType<typeof vi.fn>;
  onDocumentChange: ReturnType<typeof vi.fn>;
  onObjectStyleChange: ReturnType<typeof vi.fn>;
  onRoleStyleChange: ReturnType<typeof vi.fn>;
}

function renderPanel(
  props: Partial<TypographyToolsPanelV2Props> = {},
  initialLayout: ResumeLayout = baseLayout(),
): HarnessResult {
  const onLayoutChange = vi.fn();
  const onDocumentChange = vi.fn();
  const onObjectStyleChange = vi.fn();
  const onRoleStyleChange = vi.fn();
  const document = props.document ?? makeDocument();
  const previewRef = { current: null } as RefObject<ResumePreviewHandle | null>;

  function Harness() {
    const [layout, setLayout] = useState<ResumeLayout>(initialLayout);
    return (
      <>
        <TypographyToolsPanelV2
          document={document}
          layout={layout}
          previewRef={previewRef}
          onLayoutChange={(next) => {
            onLayoutChange(next);
            setLayout(next);
          }}
          onDocumentChange={onDocumentChange}
          onObjectStyleChange={onObjectStyleChange}
          onRoleStyleChange={onRoleStyleChange}
          {...props}
        />
        <output data-testid="layout">{JSON.stringify(layout.format_config)}</output>
      </>
    );
  }

  render(
    <AntdApp>
      <Harness />
    </AntdApp>,
  );
  return { onLayoutChange, onDocumentChange, onObjectStyleChange, onRoleStyleChange };
}

function readConfig(): Record<string, unknown> {
  return JSON.parse(screen.getByTestId("layout").textContent ?? "{}") as Record<string, unknown>;
}

describe("TypographyToolsPanelV2", () => {
  it("渲染选择列表与四个小节（默认含同类段落）", () => {
    renderPanel();
    expect(screen.getByText(t("typography.tools.selectionTitle"))).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: t("typography.tools.selectionAria") }),
    ).toBeInTheDocument();
    expect(screen.getByText(t("typography.tools.sectionLevel"))).toBeInTheDocument();
    expect(screen.getByText(t("typography.tools.sectionPainter"))).toBeInTheDocument();
    expect(screen.getByText(t("typography.tools.sectionBatch"))).toBeInTheDocument();
    expect(screen.getByText(t("typography.tools.sectionRole"))).toBeInTheDocument();
  });

  it("selectedPath 指向条目：显示当前条目并渲染对象级面板", () => {
    renderPanel({ selectedPath: "education.ob_entry001" });
    expect(
      screen.getByText(
        t("typography.tools.focused", { name: "Tsinghua University · Computer Science" }),
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(t("typography.tools.sectionObject"))).toBeInTheDocument();
  });

  it("未选中条目时给引导文案", () => {
    renderPanel();
    expect(screen.getAllByText(t("typography.tools.noFocused")).length).toBeGreaterThan(0);
  });

  it("文字级别按聚焦条目写入 objects[entry.id]，且绝不改正文", () => {
    const harness = renderPanel({ selectedPath: "education.ob_entry001" });
    fireEvent.click(screen.getByRole("button", { name: t("typography.level.heading2") }));
    const objects = readConfig().objects as Record<string, unknown>;
    expect(objects.ob_entry001).toMatchObject({ font_scale: 1.2 });
    expect(harness.onLayoutChange).toHaveBeenCalledTimes(1);
    expect(harness.onDocumentChange).not.toHaveBeenCalled();
    expect(harness.onObjectStyleChange).toHaveBeenCalled();
    expect(harness.onObjectStyleChange.mock.calls[0][0]).toContain("ob_entry001");
  });

  it("聚焦条目的字段路径把作用范围推到「条目标题」→ object_roles", () => {
    renderPanel({ selectedPath: "education.ob_entry001.ob_item0001" });
    fireEvent.click(screen.getByRole("button", { name: t("typography.level.heading3") }));
    const objectRoles = readConfig().object_roles as Record<string, unknown>;
    expect(objectRoles["ob_entry001:entry_title"]).toMatchObject({ font_scale: 1.08 });
  });

  it("格式刷：复制来源局部调整，应用到受控多选目标（Q14 文案带条目名与项数）", () => {
    const harness = renderPanel(
      {
        selectedPath: "education.ob_entry001",
        multiSelectedPaths: ["education.ob_entry002"],
      },
      baseLayout({ objects: { ob_entry001: { space_after: 0.4 } } }),
    );
    expect(screen.getByText(t("typography.painter.hint"))).toBeInTheDocument();
    const copyLabel = t("typography.painter.copy", {
      name: "Tsinghua University · Computer Science",
    });
    expect(
      screen.getByText(
        t("typography.painter.copyProps", {
          count: 1,
          props: t("typography.prop.space_after"),
        }),
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: copyLabel }));
    expect(screen.getByText(t("typography.tools.targets", { count: 1 }))).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: t("typography.painter.apply", { count: 1 }) }),
    );
    const objects = readConfig().objects as Record<string, Record<string, unknown>>;
    expect(objects.ob_entry002).toMatchObject({ space_after: 0.4 });
    expect(harness.onObjectStyleChange).toHaveBeenCalled();
    expect(harness.onDocumentChange).not.toHaveBeenCalled();
  });

  it("「固定这条的当前样式」在条目排版面板底部，按当前作用范围写覆盖（Q14）", () => {
    renderPanel({ selectedPath: "education.ob_entry001" });
    fireEvent.click(screen.getByRole("button", { name: t("typography.painter.freeze") }));
    const objects = readConfig().objects as Record<string, Record<string, unknown>>;
    expect(objects.ob_entry001).toBeDefined();
    expect(objects.ob_entry001).toHaveProperty("font_scale");
    // 整条范围不写 object_roles。
    expect(readConfig().object_roles).toBeUndefined();
  });

  it("切到「条目头」再固定：写 object_roles，不动 objects", () => {
    renderPanel({ selectedPath: "education.ob_entry001" });
    fireEvent.click(screen.getByText(t("typography.entryStyle.scope.entry_title")));
    fireEvent.click(screen.getByRole("button", { name: t("typography.painter.freeze") }));
    const objectRoles = readConfig().object_roles as Record<string, Record<string, unknown>>;
    expect(objectRoles["ob_entry001:entry_title"]).toBeDefined();
    expect(readConfig().objects).toBeUndefined();
  });

  it("行内/单段板块的条目不进选择列表（无对象样式落点）", () => {
    renderPanel();
    fireEvent.mouseDown(
      screen.getByRole("combobox", { name: t("typography.tools.selectionAria") }),
    );
    // summary（text kind）的条目不在列表里；education 的两条在。
    expect(screen.queryByText(/Personal summary paragraph/)).toBeNull();
    expect(screen.getByText("education · Peking University")).toBeInTheDocument();
  });

  it("多选列表自管：选择第二条后批量目标生效（不依赖结构面板）", async () => {
    renderPanel();
    fireEvent.mouseDown(
      screen.getByRole("combobox", { name: t("typography.tools.selectionAria") }),
    );
    const option = await screen.findByText("education · Peking University");
    fireEvent.click(option);
    await waitFor(() =>
      expect(screen.getByText(t("typography.multi.count", { count: 1 }))).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: t("typography.level.caption") }));
    const objects = readConfig().objects as Record<string, unknown>;
    expect(objects.ob_entry002).toMatchObject({ font_scale: 0.9 });
  });

  it("includeRoleStyles=false 时不重复渲染同类段落（宿主已有该分组）", () => {
    renderPanel({ includeRoleStyles: false });
    expect(screen.queryByText(t("typography.tools.sectionRole"))).toBeNull();
  });

  it("空文档给出空态，但仍保留同类段落设置", () => {
    renderPanel({ document: emptyDocument() });
    expect(screen.getByText(t("typography.tools.selectionEmpty"))).toBeInTheDocument();
    expect(screen.getByText(t("typography.tools.sectionRole"))).toBeInTheDocument();
  });

  it("disabled 时级别按钮不可点", () => {
    renderPanel({ selectedPath: "education.ob_entry001", disabled: true });
    expect(screen.getByRole("button", { name: t("typography.level.heading2") })).toBeDisabled();
  });
});
