// SPDX-License-Identifier: Apache-2.0
/**
 * W08-INT（前端半）：**真实左栏挂载 → 分页域写入 → 保存通道**。
 *
 * 覆盖 wb-core 刚落地的「分页」组（板块级；条目级等 W03 选中状态上提）：
 * 1. 板块级控件真实可达（选板块后出现断页/跟随开关）；
 * 2. 勾「从新页开始」→ 经 useWorkbenchHistory.recordLayout 进宿主 onApplyLayout，
 *    format_config.pagination.sections.<key>.break_before = "page"（PATCH /layout payload 来源）；
 * 3. 脏态后「保存修改」走 W02 统一保存通道。
 *
 * 报告端点（task-12）未就绪：OverflowLocator 不在本测试范围。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import { TEMPLATE_CATALOG } from "../../../test/resumeFixtures";
import type { ResumeLayout } from "../../../types";
import type { ResumeDocumentPipeline } from "../../../features/resume-document/types";
import { DEFAULT_LAYOUT } from "../../ResumeLayoutControls.testkit";
import { CONTENT } from "../ResumeZoomModal.testkit";
import ResumeZoomModal from "../ResumeZoomModal";

vi.mock("../../../hooks/useResumeTemplateCatalog", () => ({
  useResumeTemplateCatalog: () => ({ catalog: TEMPLATE_CATALOG }),
}));
vi.mock("../../ResumePreview", () => ({
  default: () => <iframe title="workbench-preview" />,
}));

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

/** 选板块（antd Select 在 jsdom 里按 .ant-select-item-option 点选）。 */
async function pickSection(label: string) {
  fireEvent.mouseDown(screen.getByRole("combobox", { name: t("pagination.scope.sectionAria") }));
  await waitFor(() => {
    const texts = Array.from(document.querySelectorAll(".ant-select-item-option")).map((el) =>
      el.textContent?.trim(),
    );
    expect(texts).toContain(label);
  });
  const option = Array.from(document.querySelectorAll(".ant-select-item-option")).find(
    (el) => el.textContent?.trim() === label,
  );
  const content = option?.querySelector(".ant-select-item-option-content");
  fireEvent.click((content ?? option) as Element);
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("W08-INT · 分页控件真实挂载与保存通道", () => {
  it("板块级控件真实可达（选板块后出现断页意图开关）", async () => {
    render(<Harness />);
    const select = await screen.findByRole("combobox", {
      name: t("pagination.scope.sectionAria"),
    });
    expect(select).toBeInTheDocument();
    await pickSection("实习/工作经历");
    expect(
      await screen.findByRole("switch", { name: t("pagination.breakBefore") }),
    ).toBeInTheDocument();
  });

  it("勾「从新页开始」→ onApplyLayout 收到 pagination.sections 域", async () => {
    const onApplyLayout = vi.fn();
    render(<Harness onApplyLayout={onApplyLayout} />);
    await screen.findByRole("combobox", { name: t("pagination.scope.sectionAria") });
    await pickSection("实习/工作经历");
    fireEvent.click(await screen.findByRole("switch", { name: t("pagination.breakBefore") }));
    await waitFor(() => expect(onApplyLayout).toHaveBeenCalled());
    const layout = onApplyLayout.mock.calls[onApplyLayout.mock.calls.length - 1][0] as {
      format_config: { pagination?: unknown };
    };
    expect(layout.format_config.pagination).toEqual({
      version: 1,
      sections: { experience: { break_before: "page" } },
    });
  });

  it("有分页改动时顶部进脏态，点「保存修改」走统一保存通道", async () => {
    const { pipeline, saveLayout } = makePipeline();
    render(<Harness pipeline={pipeline} />);
    await screen.findByRole("combobox", { name: t("pagination.scope.sectionAria") });
    await pickSection("实习/工作经历");
    fireEvent.click(await screen.findByRole("switch", { name: t("pagination.breakBefore") }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: new RegExp(t("workbench.action.save-changes")),
      }),
    );
    await waitFor(() => expect(saveLayout).toHaveBeenCalledWith(3));
  });
});
