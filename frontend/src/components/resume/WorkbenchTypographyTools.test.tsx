// SPDX-License-Identifier: Apache-2.0
/**
 * W07 多选批量调整 + 格式刷在**参数栏真实挂载**（fe-mount B）：
 * 多选来自大纲、经 shell 上提后从 props 进来；每次应用只提交**一次** layout
 * （= W03 历史一步），格式刷的 armed 状态由组件自己持有。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import type { ResumeLayout } from "../../types";
import type { ResumePreviewHandle } from "../ResumePreview";
import type { OutlineMultiEntry } from "./outline/OutlinePanel";
import WorkbenchParamsColumn from "./WorkbenchParamsColumn";

const SOURCE = "exp_source01";
const TARGETS: OutlineMultiEntry[] = [
  { id: "exp_target01", label: "Beta Corp", meta: "2021", field: "experience" },
  { id: "exp_target02", label: "Gamma Corp", meta: "2022", field: "experience" },
];

function baseLayout(): ResumeLayout {
  return {
    template: "classic",
    format_name: "",
    page_limit: 1,
    font_scale: "standard",
    format_config: {
      objects: {
        version: 1,
        [SOURCE]: { space_after: 0.4 },
        exp_target01: { line_height: 1.5 },
      },
    } as unknown as ResumeLayout["format_config"],
  };
}

function renderColumn(onChange: (next: ResumeLayout) => void) {
  const layout = baseLayout();
  render(
    <AntdApp>
      <WorkbenchParamsColumn
        layout={layout}
        baseline={layout}
        relayouting={false}
        previewRef={createRef<ResumePreviewHandle>()}
        tier="three"
        editorEnabled
        onChange={onChange}
        selectedObjectId={SOURCE}
        selectedObjectLabel="Alpha Corp"
        multiSelectedEntries={TARGETS}
        onMultiSelectionChange={vi.fn()}
        multiSelectionApiRef={createRef()}
        onClearMultiSelect={vi.fn()}
      />
    </AntdApp>,
  );
}

function objectsOf(layout: ResumeLayout): Record<string, Record<string, unknown>> {
  const config = layout.format_config as unknown as {
    objects?: Record<string, Record<string, unknown>>;
  };
  return config.objects ?? {};
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("参数栏 · 局部排版的批量动作", () => {
  it("多选批量调整 → 一次 layout 提交；随后格式刷 → 再一次提交", () => {
    const onChange = vi.fn();
    renderColumn(onChange);

    // 多选集合来自 props（大纲上报后由 shell 透传），条数写在工具条上。
    expect(screen.getByText(t("typography.multi.title"))).toBeInTheDocument();
    expect(screen.getByText(t("typography.multi.count", { count: 2 }))).toBeInTheDocument();

    const lineHeight = screen.getByRole("spinbutton", { name: t("typography.prop.line_height") });
    fireEvent.change(lineHeight, { target: { value: "1.6" } });
    fireEvent.blur(lineHeight);
    fireEvent.click(screen.getByRole("button", { name: t("typography.multi.apply") }));

    expect(onChange).toHaveBeenCalledTimes(1);
    let objects = objectsOf(onChange.mock.calls[0][0] as ResumeLayout);
    expect(objects.exp_target01).toMatchObject({ line_height: 1.6 });
    expect(objects.exp_target02).toMatchObject({ line_height: 1.6 });

    // 格式刷：复制来源对象的局部调整 → 应用到两条目标，仍是一次提交。
    fireEvent.click(screen.getByRole("button", { name: t("typography.painter.copy") }));
    expect(screen.getByText(t("typography.painter.armed"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("typography.painter.apply") }));

    expect(onChange).toHaveBeenCalledTimes(2);
    objects = objectsOf(onChange.mock.calls[1][0] as ResumeLayout);
    expect(objects.exp_target01).toMatchObject({ line_height: 1.5, space_after: 0.4 });
    expect(objects.exp_target02).toMatchObject({ space_after: 0.4 });
    // 来源对象不被写坏。
    expect(objects[SOURCE]).toEqual({ space_after: 0.4 });
  });
});
