// SPDX-License-Identifier: Apache-2.0
/** 设置页「批量操作」：两张独立卡、首次打开自动启用、改动即保存。 */

import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import { TEMPLATE_CATALOG } from "../../test/resumeFixtures";
import BatchOperationCard from "./BatchOperationCard";

const settingsMocks = vi.hoisted(() => ({
  getBatchOperationConfig: vi.fn(),
  saveBatchGenerationConfig: vi.fn(),
  saveBatchExportConfig: vi.fn(),
}));
const resumeMocks = vi.hoisted(() => ({ fetchResumeTemplates: vi.fn() }));

vi.mock("../../api/settingsBatch", () => settingsMocks);
vi.mock("../../api/resumes", () => resumeMocks);

const GENERATION = {
  template: "classic",
  format_name: "",
  font_scale: "standard",
  page_limit: 1,
  language: "zh-CN",
  enhance: false,
  enhancement_level: "balanced",
  custom_instruction: "",
};

const EXPORT = {
  template: "classic",
  format_name: "",
  font_scale: "standard",
  page_limit: 1,
  language: "zh-CN",
  export_format: "pdf",
};

function sections(generationConfigured = true, exportConfigured = true) {
  return {
    generation: {
      ...GENERATION,
      configured: generationConfigured,
      updated_at: generationConfigured ? "2026-10-28T12:00:00" : null,
    },
    export: {
      ...EXPORT,
      configured: exportConfigured,
      updated_at: exportConfigured ? "2026-10-28T12:00:00" : null,
    },
  };
}

beforeEach(() => {
  resumeMocks.fetchResumeTemplates.mockResolvedValue(TEMPLATE_CATALOG);
  settingsMocks.getBatchOperationConfig.mockResolvedValue(sections());
  settingsMocks.saveBatchGenerationConfig.mockImplementation(async (payload) => ({
    ...payload,
    configured: true,
    updated_at: "2026-10-28T12:01:00",
  }));
  settingsMocks.saveBatchExportConfig.mockImplementation(async (payload) => ({
    ...payload,
    configured: true,
    updated_at: "2026-10-28T12:01:00",
  }));
});

afterEach(cleanup);

function renderCard() {
  return render(
    <AntdApp>
      <BatchOperationCard />
    </AntdApp>,
  );
}

describe("BatchOperationCard", () => {
  it("生成与导出各自一张卡，参数互不影响", async () => {
    renderCard();

    expect(await screen.findByText(t("batchOperation.generation.title"))).toBeInTheDocument();
    expect(screen.getByText(t("batchOperation.export.title"))).toBeInTheDocument();

    // 只改「批量生成」的页数：只保存生成这一节。
    fireEvent.change(screen.getAllByRole("spinbutton")[0]!, { target: { value: "2" } });

    await waitFor(
      () =>
        expect(settingsMocks.saveBatchGenerationConfig).toHaveBeenCalledWith(
          expect.objectContaining({ page_limit: 2 }),
        ),
      { timeout: 2500 },
    );
    expect(settingsMocks.saveBatchExportConfig).not.toHaveBeenCalled();
  });

  it("首次打开且未配置：用默认值自动启用两节，无需保存按钮", async () => {
    settingsMocks.getBatchOperationConfig.mockResolvedValue(sections(false, false));
    renderCard();

    await waitFor(
      () =>
        expect(settingsMocks.saveBatchGenerationConfig).toHaveBeenCalledWith(
          expect.objectContaining({ template: "classic" }),
        ),
      { timeout: 2500 },
    );
    await waitFor(
      () =>
        expect(settingsMocks.saveBatchExportConfig).toHaveBeenCalledWith(
          expect.objectContaining({ export_format: "pdf" }),
        ),
      { timeout: 2500 },
    );
    expect((await screen.findAllByText(t("batchOperation.status.saved"))).length).toBe(2);
  });
});
