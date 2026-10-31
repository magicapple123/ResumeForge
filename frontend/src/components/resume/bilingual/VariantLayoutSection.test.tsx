// SPDX-License-Identifier: Apache-2.0
/** W16 变体排版容器：export-input 取有效排版、PATCH layout、恢复继承。 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bt } from "../../../features/resume-bilingual/i18n";
import type { VariantDetailOut } from "../../../features/resume-bilingual/api";
import { MOCK_PRIMARY } from "../../../test/bilingualMock";
import VariantLayoutSection from "./VariantLayoutSection";

const apiMocks = vi.hoisted(() => ({
  fetchVariantExportInput: vi.fn(),
  patchVariantLayout: vi.fn(),
}));
vi.mock("../../../features/resume-bilingual/api", () => apiMocks);

const VARIANT: VariantDetailOut = {
  id: 8,
  resume_id: 5,
  name: "English version",
  language: "en-US",
  variant_group_id: 1,
  created_at: "2026-10-01T00:00:00Z",
  content: MOCK_PRIMARY,
  render_context: { template: "scholar" },
  layout: null,
};

function exportInput(layoutSource: string) {
  return {
    resume_id: 5,
    variant_id: 8,
    name: "English version",
    language: "en-US",
    content: MOCK_PRIMARY,
    layout: { template: "scholar", page_limit: 2, font_scale: "standard" },
    layout_source: layoutSource,
    content_sha256: "sha",
  };
}

beforeEach(() => {
  apiMocks.fetchVariantExportInput.mockResolvedValue(exportInput("render_context"));
  apiMocks.patchVariantLayout.mockResolvedValue({ ...VARIANT, layout: { page_limit: 3 } });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderSection() {
  render(
    <AntdApp>
      <VariantLayoutSection resumeId={5} variant={VARIANT} />
    </AntdApp>,
  );
}

describe("VariantLayoutSection", () => {
  it("用 export-input 的生效排版初始化，并显示继承状态", async () => {
    renderSection();
    expect(await screen.findByText(bt("bilingual.layout.inherited"))).toBeTruthy();
    expect(apiMocks.fetchVariantExportInput).toHaveBeenCalledWith(5, 8);
    expect(screen.getByText("scholar")).toBeTruthy();
  });

  it("保存只发 layout 覆盖（含改动后的页数）", async () => {
    renderSection();
    await screen.findByText(bt("bilingual.layout.inherited"));
    fireEvent.mouseDown(screen.getByRole("combobox", { name: bt("bilingual.layout.pages") }));
    fireEvent.click(screen.getByTitle("3"));
    fireEvent.click(screen.getByRole("button", { name: bt("bilingual.layout.save") }));
    await waitFor(() =>
      expect(apiMocks.patchVariantLayout).toHaveBeenCalledWith(5, 8, {
        layout: { template: "scholar", page_limit: 3, font_scale: "standard" },
      }),
    );
  });

  it("独立排版时恢复继承 = PATCH layout null", async () => {
    apiMocks.fetchVariantExportInput.mockResolvedValue(exportInput("variant"));
    renderSection();
    await screen.findByText(bt("bilingual.layout.own"));
    fireEvent.click(screen.getByRole("button", { name: bt("bilingual.layout.reset") }));
    await waitFor(() =>
      expect(apiMocks.patchVariantLayout).toHaveBeenCalledWith(5, 8, { layout: null }),
    );
  });

  it("加载失败给出重试入口", async () => {
    apiMocks.fetchVariantExportInput.mockRejectedValueOnce(new Error("boom"));
    renderSection();
    expect(await screen.findByText("boom")).toBeTruthy();
    expect(screen.getByRole("button", { name: bt("bilingual.layout.retry") })).toBeTruthy();
  });
});
