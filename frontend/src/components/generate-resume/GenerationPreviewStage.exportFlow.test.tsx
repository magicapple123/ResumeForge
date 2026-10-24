// SPDX-License-Identifier: Apache-2.0
/** 生成流程预览必须显式声明走旧导出链路（exportFlow="legacy"）。 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import type { ResumeDetail } from "../../types";
import GenerationPreviewStage from "./GenerationPreviewStage";

const captured = vi.hoisted(() => ({ exportFlow: undefined as string | undefined }));
vi.mock("../resume/ResumeDetailPreview", () => ({
  default: (props: { exportFlow?: string }) => {
    captured.exportFlow = props.exportFlow;
    return <div data-testid="detail-preview" />;
  },
}));

afterEach(() => {
  cleanup();
  captured.exportFlow = undefined;
});

function renderStage() {
  const props: ComponentProps<typeof GenerationPreviewStage> = {
    result: { detail: { id: 42 } as unknown as ResumeDetail },
    previewHtml: "<html></html>",
    layout: {
      template: "classic",
      format_name: "",
      page_limit: 1,
      font_scale: "standard",
      format_config: {},
    },
    layoutStatus: null,
    measure: null,
    pdfDirectAvailable: true,
    relayouting: false,
    previewRef: { current: null },
    setLayoutStatus: vi.fn(),
    setMeasure: vi.fn(),
    applyLayout: vi.fn(),
    applyFittedFormat: vi.fn(),
    saveEditedResume: vi.fn(async () => undefined),
    applyRevisedDetail: vi.fn(async () => undefined),
    suggestionsGenerated: false,
    suggestionsResetKey: 0,
    setSuggestionsGenerated: vi.fn(),
    onGoResumes: vi.fn(),
    onRegenerate: vi.fn(),
    onClose: vi.fn(),
  };
  return render(<GenerationPreviewStage {...props} />);
}

describe("生成流程导出入口", () => {
  it("GenerationPreviewStage 给 ResumeDetailPreview 传 exportFlow=legacy", () => {
    renderStage();
    expect(captured.exportFlow).toBe("legacy");
  });
});
