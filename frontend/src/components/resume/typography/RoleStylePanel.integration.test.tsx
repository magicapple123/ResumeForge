// SPDX-License-Identifier: Apache-2.0
/**
 * W07-INT（前端半）：**真实挂载 → 文档状态 → 保存通道**的端到端证据。
 *
 * 组件单测只证明面板自己会算；这里补三根线：
 * 1. 左栏「局部排版」组真的挂在 shell 里（wb-core 落笔的挂载点）；
 * 2. 改一个角色属性会经 `useWorkbenchHistory.recordLayout` 调宿主的 `onApplyLayout`
 *    （= 真实保存 PATCH /layout 的 payload 来源）；
 * 3. 改完变脏、点顶部「保存修改」会走 W02 的统一保存通道（`documentPipeline.saveLayout`）。
 *
 * 后端 PATCH 落库与三渲染器对拍属 task-11/BE（本测试只覆盖前端链路）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import { TEMPLATE_CATALOG } from "../../../test/resumeFixtures";
import type { ResumeLayout, ResumeTemplateCatalog } from "../../../types";
import type { ResumeDocumentPipeline } from "../../../features/resume-document/types";
import { DEFAULT_LAYOUT } from "../../ResumeLayoutControls.testkit";
import { CONTENT, renderModal } from "../ResumeZoomModal.testkit";
import ResumeZoomModal from "../ResumeZoomModal";

const STYLE_CATALOG = {
  ...TEMPLATE_CATALOG,
  role_fields: [
    { role: "name", label_key: "typography.role.name", props: ["font_scale", "color"] },
    { role: "body", label_key: "typography.role.body", props: ["line_height", "bullet"] },
  ],
  template_role_defaults: {
    classic: {
      name: { font_scale: 1.86 },
      body: { font_scale: 1, line_height: 1.7 },
    },
  },
} as unknown as ResumeTemplateCatalog;

vi.mock("../../../hooks/useResumeTemplateCatalog", () => ({
  useResumeTemplateCatalog: () => ({ catalog: STYLE_CATALOG }),
}));
// 画布桩：局部排版与画布渲染无关，用空 iframe 让 shell 正常挂载。
vi.mock("../../ResumePreview", () => ({
  default: () => <iframe title="workbench-preview" />,
}));

/** 真实宿主的最小替身：`onApplyLayout` 回写 layout state（与 ResumeDetailPreview 同形）。 */
function Harness({
  pipeline,
  onApplyLayout,
}: {
  pipeline?: ResumeDocumentPipeline;
  onApplyLayout?: (next: ResumeLayout) => void;
}) {
  const [layout, setLayout] = useState<ResumeLayout>({ ...DEFAULT_LAYOUT, format_config: {} });
  const applyLayout = (next: ResumeLayout) => {
    onApplyLayout?.(next);
    setLayout(next);
  };
  return (
    <AntdApp>
      <ResumeZoomModal
        open
        html="<html></html>"
        warnings={[]}
        pages={1}
        onClose={vi.fn()}
        layout={layout}
        resumeId={42}
        content={CONTENT}
        onApplyLayout={applyLayout}
        onSaveContent={vi.fn(async () => undefined)}
        documentPipeline={pipeline}
      />
    </AntdApp>
  );
}

function makePipeline() {
  const saveLayout = vi.fn(async () => ({ status: "saved" as const, revision: 4 }));
  const pipeline: ResumeDocumentPipeline = {
    revision: 3,
    saveLayout,
    saveContent: vi.fn(async () => 4),
    publishDraft: vi.fn(async () => ({ status: "saved" as const, revision: 4 })),
    fetchLatest: vi.fn(async () => {
      throw new Error("not used");
    }),
    adoptLatest: vi.fn(),
    saveAsCopy: vi.fn(async () => {
      throw new Error("not used");
    }),
  };
  return { pipeline, saveLayout };
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("W07-INT · 局部排版真实挂载与保存通道", () => {
  it("改角色属性 → onApplyLayout 收到 roles 域（保存 payload 来源）", async () => {
    const onApplyLayout = vi.fn();
    renderModal({ onApplyLayout });
    // 左栏「局部排版」组：name 角色默认展开。
    const row = await screen.findByTestId("style-row-name-font_scale");
    fireEvent.click(
      within(row).getByRole("button", {
        name: t("typography.row.increaseAria", { label: t("typography.prop.font_scale") }),
      }),
    );
    await waitFor(() => expect(onApplyLayout).toHaveBeenCalled());
    const layout = onApplyLayout.mock.calls[onApplyLayout.mock.calls.length - 1][0] as {
      format_config: { roles?: { name?: { font_scale?: number } } };
    };
    // 模板基准 1.86、显示值 +0.02 → 落库系数 1.0108（不是 1.88，后端会再乘基准）。
    expect(layout.format_config.roles?.name).toEqual({ font_scale: 1.0108 });
  });

  it("有版式改动时顶部进入脏态，点「保存修改」走统一保存通道", async () => {
    const { pipeline, saveLayout } = makePipeline();
    render(<Harness pipeline={pipeline} />);
    const row = await screen.findByTestId("style-row-name-font_scale");
    fireEvent.click(
      within(row).getByRole("button", {
        name: t("typography.row.increaseAria", { label: t("typography.prop.font_scale") }),
      }),
    );
    const saveButton = await screen.findByRole("button", {
      name: new RegExp(t("workbench.action.save-changes")),
    });
    fireEvent.click(saveButton);
    await waitFor(() => expect(saveLayout).toHaveBeenCalledWith(3));
  });
  it("恢复继承（↺）：roles 域被删掉，不写默认值", async () => {
    const onApplyLayout = vi.fn();
    render(<Harness onApplyLayout={onApplyLayout} />);
    const row = await screen.findByTestId("style-row-name-font_scale");
    fireEvent.click(
      within(row).getByRole("button", {
        name: t("typography.row.increaseAria", { label: t("typography.prop.font_scale") }),
      }),
    );
    await waitFor(() => expect(onApplyLayout).toHaveBeenCalled());
    // 改过之后该行出现 ↺；点它 = 删键回继承（不是把基准值写进去）。
    fireEvent.click(
      within(screen.getByTestId("style-row-name-font_scale")).getByRole("button", {
        name: t("workbench.param.restoreToOpenedAria", { label: t("typography.prop.font_scale") }),
      }),
    );
    await waitFor(() => {
      const layout = onApplyLayout.mock.calls[onApplyLayout.mock.calls.length - 1][0] as {
        format_config: Record<string, unknown>;
      };
      expect(layout.format_config.roles).toBeUndefined();
    });
  });

  it("放弃修改：版式退回打开时的快照（试用/改动不污染文档）", async () => {
    const onApplyLayout = vi.fn();
    render(<Harness onApplyLayout={onApplyLayout} />);
    const row = await screen.findByTestId("style-row-name-font_scale");
    fireEvent.click(
      within(row).getByRole("button", {
        name: t("typography.row.increaseAria", { label: t("typography.prop.font_scale") }),
      }),
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: new RegExp(t("workbench.action.cancel-changes")),
      }),
    );
    // 动作条上的就地确认条（不再开第二个弹窗）。
    fireEvent.click(await screen.findByRole("button", { name: t("common.action.discard") }));
    await waitFor(() => {
      const layout = onApplyLayout.mock.calls[onApplyLayout.mock.calls.length - 1][0] as {
        format_config: Record<string, unknown>;
      };
      expect(layout.format_config.roles).toBeUndefined();
    });
  });
});
